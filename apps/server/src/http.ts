import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Pool } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { z } from "zod";
import {
  chatSchema, clientMessageSchema, emptySchema, guestSchema, httpCommandSchema, joinSchema, roomIdSchema,
} from "../../../packages/protocol/src/index.js";
import type { CommandEnvelope, ServerMessage } from "../../../packages/protocol/src/index.js";
import type { Definition } from "../../../packages/game-core/src/types.js";
import { Rooms, RoomError } from "./rooms.js";
import { activeSessions, createSession, readSession, SESSION_AGE_SECONDS, SESSION_COOKIE } from "./session.js";
import type { Identity } from "./session.js";

const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 20_000;

type Options = { db: Pool; definition: Definition; origin: string; playtest: boolean; host: string; port: number };
type Subscription = { roomId: string; seatId: string; lastSequence: number };
type Connection = {
  socket: WebSocket;
  token: string;
  userId: string;
  subscription?: Subscription;
  alive: boolean;
  pending: number;
};

function clockRateLimit() {
  const windows = new Map<string, { resetsAt: number; count: number }>();
  return (key: string, max: number) => {
    const now = Date.now();
    const window = windows.get(key);
    if (window && window.resetsAt > now) {
      if (window.count >= max) throw new RoomError("RATE_LIMITED", 429);
      window.count++;
      return;
    }
    if (windows.size >= MAX_RATE_KEYS) {
      for (const [id, value] of windows) if (value.resetsAt <= now) windows.delete(id);
      if (windows.size >= MAX_RATE_KEYS && !window) throw new RoomError("RATE_LIMITED", 429);
    }
    windows.set(key, { resetsAt: now + RATE_WINDOW_MS, count: 1 });
  };
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RoomError("INVALID_PAYLOAD", 400);
  return parsed.data;
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>, allowEmpty = false): Promise<T> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new RoomError("PAYLOAD_TOO_LARGE", 413);
  if (!request.body && allowEmpty) return validate(schema, {});
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw new RoomError("INVALID_PAYLOAD", 400);
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RoomError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new RoomError("INVALID_PAYLOAD", 400);
  }
  return validate(schema, value);
}

function requireOrigin(origin: string | null | undefined, expected: string): void {
  if (origin !== expected) throw new RoomError("ORIGIN_DENIED", 403);
}

function socketToken(request: IncomingMessage): string {
  const matches = request.headers.cookie?.split(";").map((value) => value.trim())
    .filter((value) => value.startsWith(`${SESSION_COOKIE}=`));
  return matches?.length === 1 ? matches[0].slice(SESSION_COOKIE.length + 1) : "";
}

function safeError(error: unknown): { code: string; status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 } {
  if (error instanceof RoomError) return error;
  const cause = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  const systemCode = cause && /^(?:[0-9A-Z]{5}|EADDRINUSE|ECONNREFUSED|ETIMEDOUT|ECONNRESET)$/.test(cause) ? cause : undefined;
  console.error(JSON.stringify({ event: "request_failed", systemCode }));
  return { code: "INTERNAL_ERROR", status: 500 };
}

function send(socket: WebSocket, event: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 512 * 1024) {
    socket.close(1013);
    return;
  }
  socket.send(JSON.stringify(event));
}

function rejectUpgrade(socket: Duplex, status: number, code: string) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ code });
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

export async function startServer({ db, definition, origin, playtest, host, port }: Options) {
  const app = new Hono<{ Bindings: { incoming: IncomingMessage } }>();
  const http = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, getRequestListener(app.fetch));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES, perMessageDeflate: false });
  const connections = new Set<Connection>();
  const subscriptions = new Map<string, Set<Connection>>();
  const pendingBroadcasts = new Set<string>();
  const broadcasts = new Map<string, Promise<void>>();
  const rateLimit = clockRateLimit();
  let commands = 0;
  let commandDurationMs = 0;
  let resyncs = 0;
  let closing = false;

  const present = (roomId: string, seatId: string) =>
    [...(subscriptions.get(roomId) ?? [])].some((connection) => connection.subscription?.seatId === seatId);
  const rooms = new Rooms(db, definition, playtest, present);

  async function authenticate(token?: string): Promise<Identity> {
    const identity = await readSession(db, token);
    if (!identity) throw new RoomError("UNAUTHENTICATED", 401);
    return identity;
  }

  function publish(roomId: string): void {
    if (closing || !subscriptions.has(roomId)) return;
    pendingBroadcasts.add(roomId);
    if (broadcasts.has(roomId)) return;
    const process = async () => {
      while (pendingBroadcasts.delete(roomId)) {
        const audience = [...(subscriptions.get(roomId) ?? [])];
        if (audience.length === 0) continue;
        try {
          const active = await activeSessions(db, audience.map(({ token }) => token));
          const members = audience.filter((connection) => {
            if (active.has(connection.token)) return true;
            connection.socket.close(1008);
            return false;
          });
          if (members.length === 0) continue;
          const snapshots = await rooms.snapshots(roomId, members.map(({ userId }) => userId));
          for (const connection of members) {
            const subscription = connection.subscription;
            if (subscription?.roomId !== roomId) continue;
            const snapshot = snapshots.get(connection.userId);
            if (!snapshot) {
              send(connection.socket, { type: "ERROR", code: "NOT_MEMBER" });
              connection.socket.close(1008);
            } else if (snapshot.sequence > subscription.lastSequence) {
              subscription.lastSequence = snapshot.sequence;
              send(connection.socket, { type: "SNAPSHOT", ...snapshot });
            }
          }
        } catch (error) {
          const failure = safeError(error);
          for (const { socket } of audience) {
            send(socket, { type: "ERROR", code: failure.code });
            if (failure.status === 404) socket.close(1008);
          }
        }
      }
    };
    const task = process().finally(() => {
      broadcasts.delete(roomId);
      if (pendingBroadcasts.has(roomId)) publish(roomId);
    });
    broadcasts.set(roomId, task);
  }

  async function detach(connection: Connection): Promise<void> {
    const previous = connection.subscription;
    if (!previous) return;
    connection.subscription = undefined;
    const clients = subscriptions.get(previous.roomId);
    clients?.delete(connection);
    if (clients?.size === 0) subscriptions.delete(previous.roomId);
    if (!closing && !present(previous.roomId, previous.seatId)) {
      await rooms.presenceChanged(previous.roomId);
      publish(previous.roomId);
    }
  }

  async function subscribe(connection: Connection, roomId: string, resync: boolean): Promise<void> {
    if (resync && connection.subscription?.roomId !== roomId) throw new RoomError("NOT_MEMBER", 403);
    if (connection.subscription?.roomId !== roomId) {
      const seatId = await rooms.seatId(roomId, connection.userId);
      await detach(connection);
      if (connection.socket.readyState !== WebSocket.OPEN) return;
      const changed = !present(roomId, seatId);
      connection.subscription = { roomId, seatId, lastSequence: -1 };
      const clients = subscriptions.get(roomId) ?? new Set<Connection>();
      clients.add(connection);
      subscriptions.set(roomId, clients);
      if (changed) {
        await rooms.presenceChanged(roomId);
        publish(roomId);
      }
    }
    const current = connection.subscription;
    const snapshot = await rooms.snapshot(roomId, connection.userId);
    if (connection.subscription === current && current && (resync ? snapshot.sequence >= current.lastSequence : snapshot.sequence > current.lastSequence)) {
      current.lastSequence = snapshot.sequence;
      send(connection.socket, { type: "SNAPSHOT", ...snapshot });
    }
    if (resync) resyncs++;
  }

  async function command(identity: Identity, envelope: CommandEnvelope) {
    rateLimit(`command:${identity.userId}`, 120);
    const started = performance.now();
    try {
      return await rooms.command(identity.userId, envelope);
    } finally {
      commands++;
      commandDurationMs += performance.now() - started;
    }
  }

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST") requireOrigin(c.req.header("Origin"), origin);
    await next();
  });
  app.onError((error, c) => {
    const { code, status } = safeError(error);
    return c.json({ code }, status);
  });
  app.notFound((c) => c.json({ code: "NOT_FOUND" }, 404));

  app.get("/health/live", (c) => c.json({ ok: true }));
  app.get("/health/ready", async (c) => {
    if (closing) return c.json({ ok: false }, 503);
    try {
      await db.query("SELECT 1 FROM rooms LIMIT 0");
    } catch {
      return c.json({ ok: false }, 503);
    }
    return c.json({ ok: true });
  });
  app.get("/health/metrics", async (c) => {
    const result = await db.query<{ count: number }>("SELECT count(*)::int FROM rooms WHERE expires_at IS NULL OR expires_at > now()");
    return c.json({ rooms: result.rows[0].count, sockets: connections.size, commands, commandDurationMs, resyncs });
  });

  app.post("/api/session/guest", async (c) => {
    rateLimit(`guest:${c.env.incoming.socket.remoteAddress}`, 60);
    const { name } = await parseBody(c.req.raw, guestSchema);
    const existing = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (existing) {
      if (existing.name !== name) await db.query("UPDATE profiles SET name = $2 WHERE user_id = $1", [existing.userId, name]);
      return c.json({ name, avatarId: existing.avatarId });
    }
    const { token, identity } = await createSession(db, name);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "Strict", secure: origin.startsWith("https://"), path: "/", maxAge: SESSION_AGE_SECONDS,
    });
    return c.json({ name: identity.name, avatarId: identity.avatarId }, 201);
  });

  app.get("/api/session", async (c) => {
    const { name, avatarId } = await authenticate(getCookie(c, SESSION_COOKIE));
    return c.json({ name, avatarId });
  });

  app.post("/api/rooms", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    rateLimit(`create:${identity.userId}`, 10);
    await parseBody(c.req.raw, emptySchema, true);
    return c.json(await rooms.create(identity), 201);
  });

  app.post("/api/rooms/join", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    rateLimit(`join:${c.env.incoming.socket.remoteAddress}`, 120);
    rateLimit(`join-seat:${identity.userId}`, 12);
    const { code } = await parseBody(c.req.raw, joinSchema);
    const snapshot = await rooms.join(code, identity);
    publish(snapshot.room.roomId);
    return c.json(snapshot);
  });

  app.get("/api/rooms/:roomId", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    return c.json(await rooms.snapshot(validate(roomIdSchema, c.req.param("roomId")), identity.userId));
  });

  app.post("/api/rooms/:roomId/leave", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    rateLimit(`leave:${identity.userId}`, 20);
    const roomId = validate(roomIdSchema, c.req.param("roomId"));
    await parseBody(c.req.raw, emptySchema, true);
    const seatId = await rooms.leave(roomId, identity.userId);
    const clients = [...(subscriptions.get(roomId) ?? [])].filter((connection) => connection.subscription?.seatId === seatId);
    await Promise.all(clients.map(async (connection) => {
      await detach(connection);
      connection.socket.close(1000);
    }));
    publish(roomId);
    return c.json({ ok: true });
  });

  app.post("/api/rooms/:roomId/chat", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    const roomId = validate(roomIdSchema, c.req.param("roomId"));
    rateLimit(`chat:${identity.userId}`, 12);
    const { text } = await parseBody(c.req.raw, chatSchema);
    await rooms.chat(roomId, identity.userId, text);
    const snapshot = await rooms.snapshot(roomId, identity.userId);
    publish(roomId);
    return c.json(snapshot);
  });

  app.post("/api/rooms/:roomId/commands", async (c) => {
    const identity = await authenticate(getCookie(c, SESSION_COOKIE));
    const roomId = validate(roomIdSchema, c.req.param("roomId"));
    const envelope = await parseBody(c.req.raw, httpCommandSchema);
    if (envelope.roomId && envelope.roomId !== roomId) throw new RoomError("INVALID_PAYLOAD", 400);
    const { ack, changed } = await command(identity, { ...envelope, roomId });
    if (changed) publish(roomId);
    return c.json(ack);
  });

  async function handleMessage(connection: Connection, data: RawData, isBinary: boolean) {
    rateLimit(`ws:${connection.userId}`, 180);
    const identity = await authenticate(connection.token);
    let decoded: unknown;
    try {
      if (isBinary || !Buffer.isBuffer(data)) throw new Error();
      decoded = JSON.parse(data.toString("utf8"));
    } catch {
      throw new RoomError("INVALID_PAYLOAD", 400);
    }
    const message = validate(clientMessageSchema, decoded);
    if (message.type === "COMMAND") {
      if (connection.subscription?.roomId !== message.roomId) throw new RoomError("NOT_MEMBER", 403);
      const { ack, changed } = await command(identity, message);
      send(connection.socket, ack);
      if (changed) publish(message.roomId);
    } else {
      await subscribe(connection, message.roomId, message.type === "RESYNC");
    }
  }

  http.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const upgrade = async () => {
      const path = request.url?.split("?", 1)[0];
      if (path !== "/ws" || request.url?.includes("?")) throw new RoomError("NOT_FOUND", 404);
      requireOrigin(request.headers.origin, origin);
      rateLimit(`upgrade:${request.socket.remoteAddress}`, 300);
      const token = socketToken(request);
      const identity = await authenticate(token);
      if (closing || connections.size >= 1000) throw new RoomError("RATE_LIMITED", 429);
      const tokenKey = createHash("sha256").update(token).digest("hex");
      rateLimit(`socket-session:${tokenKey}`, 40);
      wss.handleUpgrade(request, socket, head, (ws) => {
        const connection: Connection = { socket: ws, token, userId: identity.userId, alive: true, pending: 0 };
        connections.add(connection);
        let messages = Promise.resolve();
        ws.on("message", (data, isBinary) => {
          if (connection.pending >= 16) {
            ws.close(1008);
            return;
          }
          connection.pending++;
          messages = messages.then(async () => {
            if (!closing && ws.readyState === WebSocket.OPEN) await handleMessage(connection, data, isBinary);
          }).catch((error: unknown) => {
            const failure = safeError(error);
            send(ws, { type: "ERROR", code: failure.code });
            if (failure.status === 401 || failure.status === 429) ws.close(1008);
          }).finally(() => {
            connection.pending--;
          });
        });
        ws.on("pong", () => { connection.alive = true; });
        ws.on("error", () => ws.terminate());
        ws.on("close", () => {
          connections.delete(connection);
          void detach(connection).catch(safeError);
        });
      });
    };
    void upgrade().catch((error: unknown) => {
      const { status, code } = safeError(error);
      rejectUpgrade(socket, status, code);
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      http.off("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address");

  let automation: Promise<void> | undefined;
  const interval = setInterval(() => {
    if (closing || automation) return;
    automation = (async () => {
      const due = await rooms.dueRooms();
      await Promise.all(due.map(async (roomId) => {
        if (await rooms.automate(roomId)) publish(roomId);
      }));
    })().catch(safeError).then(() => { automation = undefined; });
  }, 250);
  let checkingSessions: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (closing || checkingSessions || connections.size === 0) return;
    const audience = [...connections];
    checkingSessions = (async () => {
      const active = await activeSessions(db, audience.map(({ token }) => token));
      for (const connection of audience) {
        if (!connection.alive || !active.has(connection.token)) connection.socket.terminate();
        else {
          connection.alive = false;
          connection.socket.ping();
        }
      }
    })().catch(safeError).then(() => { checkingSessions = undefined; });
  }, 10_000);

  let closeTask: Promise<void> | undefined;
  function close() {
    closeTask ??= (async () => {
      closing = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      const stopped = new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
      for (const connection of connections) connection.socket.terminate();
      wss.close();
      await stopped;
      await automation;
      await checkingSessions;
      await Promise.all(broadcasts.values());
    })();
    return closeTask;
  }

  return { port: address.port, close };
}
