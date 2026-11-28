import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Agent, request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createDefinition, loadActiveDefinition } from "../../packages/config/src/index.js";
import type { Definition } from "../../packages/game-core/src/types.js";
import type { CommandAck, CommandEnvelope, RoomSnapshot, ServerMessage, WireCommand } from "../../packages/protocol/src/index.js";
import { connectDatabase, migrate } from "../../apps/server/src/database.js";
import { startServer } from "../../apps/server/src/http.js";
import { SESSION_COOKIE } from "../../apps/server/src/session.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:4173";
let expectedOrigin = origin;
const network = describe.skipIf(!databaseUrl);
const sockets = new Set<WebSocket>();
const agent = new Agent({ keepAlive: true, maxSockets: 6 });
let admin: ReturnType<typeof connectDatabase> | undefined;
let db: ReturnType<typeof connectDatabase> | undefined;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let definition: Definition;
let scope: string;
let createdScope = false;
let isolatedUrl: URL;

function address(path: string): string {
  return `http://127.0.0.1:${server?.port}${path}`;
}

function matchPath(snapshot: RoomSnapshot): string {
  return `/api/rooms/${snapshot.room.roomId}`;
}

function openTestServer(activeDefinition = definition, hosted?: { origin: string; hostKey: string }) {
  db = connectDatabase(isolatedUrl.toString());
  expectedOrigin = hosted?.origin ?? origin;
  return startServer({ db, definition: activeDefinition, origin: expectedOrigin, playtest: true, host: "127.0.0.1", port: 0, hostKey: hosted?.hostKey });
}

async function stopTestServer(): Promise<void> {
  const running = server;
  const pool = db;
  server = undefined;
  db = undefined;
  try {
    await running?.close();
  } finally {
    await pool?.end();
  }
}

async function request(path: string, cookie?: string, payload?: unknown, requestOrigin = expectedOrigin) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (payload !== undefined) {
    headers.Origin = requestOrigin;
    headers["Content-Type"] = "application/json";
  }
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(body));
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(address(path), {
      agent, headers, method: payload === undefined ? "GET" : "POST",
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        }
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500, headers }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function responseCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Response cookie was omitted");
  return cookie;
}

async function guest(name = "Тестовый игрок", hostCookie?: string): Promise<string> {
  const response = await request("/api/session/guest", hostCookie, { name });
  expect(response.status).toBe(201);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
  if (!cookie) throw new Error("Guest session cookie was omitted");
  return cookie;
}

async function identityCounts() {
  if (!db) throw new Error("Test database is unavailable");
  const result = await db.query<{ profiles: number; sessions: number }>(`
    SELECT (SELECT count(*)::int FROM profiles) AS profiles,
           (SELECT count(*)::int FROM guest_sessions) AS sessions
  `);
  return result.rows[0];
}

async function room(cookie: string): Promise<RoomSnapshot> {
  const response = await request("/api/rooms", cookie, {});
  expect(response.status).toBe(201);
  return response.json() as Promise<RoomSnapshot>;
}

async function snapshot(previous: RoomSnapshot, cookie: string): Promise<RoomSnapshot> {
  const response = await request(matchPath(previous), cookie);
  expect(response.status).toBe(200);
  return response.json() as Promise<RoomSnapshot>;
}

function envelope(snapshot: RoomSnapshot, command: WireCommand, commandId: string = randomUUID()): CommandEnvelope {
  return {
    roomId: snapshot.room.roomId,
    matchId: snapshot.match?.matchId ?? null,
    expectedRevision: snapshot.match?.revision ?? 0,
    commandId,
    command,
  };
}

async function httpCommand(previous: RoomSnapshot, cookie: string, payload: CommandEnvelope): Promise<CommandAck> {
  const response = await request(`${matchPath(previous)}/commands`, cookie, payload);
  expect(response.status).toBe(200);
  return response.json() as Promise<CommandAck>;
}

async function command(previous: RoomSnapshot, cookie: string, move: WireCommand): Promise<RoomSnapshot> {
  const ack = await httpCommand(previous, cookie, envelope(previous, move));
  expect(ack).toMatchObject({ type: "ACK", ok: true });
  return snapshot(previous, cookie);
}

async function startHumanMatch(timer: number | null = null) {
  const cookies = await Promise.all([guest("Хозяин"), guest("Второй"), guest("Третий")]);
  let current = await room(cookies[0]);
  const bySeat = new Map([[current.room.mySeatId, cookies[0]]]);
  for (const cookie of cookies.slice(1)) {
    const response = await request("/api/rooms/join", cookie, { code: current.room.code });
    expect(response.status).toBe(200);
    const joined = await response.json() as RoomSnapshot;
    bySeat.set(joined.room.mySeatId, cookie);
  }
  if (timer) current = await command(current, cookies[0], { type: "SET_TIMER", seconds: timer });
  for (const cookie of cookies) current = await command(current, cookie, { type: "SET_READY", ready: true });
  current = await command(current, cookies[0], { type: "START_MATCH" });
  return { current, cookies, bySeat };
}

async function advanceRoleReveal(current: RoomSnapshot, cookies: readonly string[]): Promise<RoomSnapshot> {
  for (const cookie of cookies) current = await command(current, cookie, { type: "ACK_ROLE" });
  expect(current.match?.phase).toBe("TURN");
  return current;
}

function firstDiscard(view: RoomSnapshot): WireCommand {
  const discard = view.match?.moves.find((move) => move.type === "DISCARD");
  if (!discard || discard.type !== "DISCARD") throw new Error("Turn owner must be able to discard");
  return discard;
}

function websocket(cookie?: string, requestOrigin = expectedOrigin) {
  const socket = new WebSocket(address("/ws").replace("http", "ws"), {
    origin: requestOrigin,
    headers: cookie ? { Cookie: cookie } : {},
  });
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  const inbox: ServerMessage[] = [];
  socket.on("message", (raw) => inbox.push(JSON.parse(raw.toString()) as ServerMessage));
  return {
    socket,
    send(message: unknown) { socket.send(JSON.stringify(message)); },
    async next<T extends ServerMessage>(filter: (message: ServerMessage) => message is T): Promise<T> {
      let next: T | undefined;
      await expect.poll(() => {
        const index = inbox.findIndex(filter);
        if (index >= 0) next = inbox.splice(index, 1)[0] as T;
        return next !== undefined;
      }, { timeout: 4000, interval: 15 }).toBe(true);
      if (!next) throw new Error("Expected WebSocket message was omitted");
      return next;
    },
  };
}

const isSnapshot = (message: ServerMessage): message is Extract<ServerMessage, { type: "SNAPSHOT" }> => message.type === "SNAPSHOT";
const isError = (message: ServerMessage): message is Extract<ServerMessage, { type: "ERROR" }> => message.type === "ERROR";

network("Network / PostgreSQL", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    const base = new URL(databaseUrl);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new Error("TEST_DATABASE_URL must point to a loopback PostgreSQL instance");
    if (base.searchParams.has("options")) throw new Error("Test pool owns its PostgreSQL search_path");
    scope = `network_test_${randomUUID().replaceAll("-", "")}`;
    isolatedUrl = new URL(base);
    isolatedUrl.searchParams.set("options", `-c search_path=${scope}`);
    admin = connectDatabase(base.toString());
    await admin.query(`CREATE SCHEMA "${scope}"`);
    createdScope = true;
    definition = await loadActiveDefinition();
    const migrations = connectDatabase(isolatedUrl.toString());
    try {
      await migrate(migrations);
      await migrate(migrations);
    } finally {
      await migrations.end();
    }
    server = await openTestServer();
  }, 15_000);

  afterAll(async () => {
    agent.destroy();
    for (const socket of sockets) socket.terminate();
    await stopTestServer();
    if (admin) {
      try {
        if (createdScope) await admin.query(`DROP SCHEMA "${scope}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  });

  it("N01 isolates room membership and transfers the lobby host", async () => {
    expect((await request("/health/live")).status).toBe(200);
    expect((await request("/health/ready")).status).toBe(200);
    expect((await request("/api/session")).status).toBe(401);
    const owner = await guest();
    const stranger = await guest();
    const initial = await room(owner);
    expect((await request(matchPath(initial), stranger)).status).toBe(403);
    const deniedCommand = await request(`${matchPath(initial)}/commands`, stranger, envelope(initial, { type: "ADD_BOT" }));
    expect(deniedCommand.status).toBe(403);

    const outsider = websocket(stranger);
    await once(outsider.socket, "open");
    outsider.send({ type: "SUBSCRIBE", roomId: initial.room.roomId });
    expect(await outsider.next(isError)).toMatchObject({ code: "NOT_MEMBER" });
    outsider.socket.close();

    const code = initial.room.code.toLowerCase();
    const joined = await (await request("/api/rooms/join", stranger, { code })).json() as RoomSnapshot;
    const repeat = await (await request("/api/rooms/join", stranger, { code })).json() as RoomSnapshot;
    expect(repeat.room.mySeatId).toBe(joined.room.mySeatId);
    const hostOnly = await httpCommand(joined, stranger, envelope(joined, { type: "ADD_BOT" }));
    expect(hostOnly).toMatchObject({ ok: false, code: "HOST_REQUIRED" });
    expect((await request(`${matchPath(initial)}/leave`, owner, {})).status).toBe(200);
    expect((await snapshot(joined, stranger)).room.hostSeatId).toBe(joined.room.mySeatId);
    expect((await request(matchPath(initial), owner)).status).toBe(403);
  });

  it("N02 serializes simultaneous turns through HTTP and WebSocket", async () => {
    const { current, cookies, bySeat } = await startHumanMatch();
    const turn = await advanceRoleReveal(current, cookies);
    const seat = turn.match?.turnSeatId ?? "";
    const actor = bySeat.get(seat) ?? "";
    const actorView = await snapshot(turn, actor);
    const connection = websocket(actor);
    await once(connection.socket, "open");
    connection.send({ type: "SUBSCRIBE", roomId: turn.room.roomId });
    await connection.next(isSnapshot);

    const move = firstDiscard(actorView);
    const left = envelope(actorView, move);
    const right = envelope(actorView, move);
    const httpAck = httpCommand(actorView, actor, left);
    connection.send({ type: "COMMAND", ...right });
    const acknowledgements = [await httpAck, await connection.next((message): message is CommandAck =>
      message.type === "ACK" && message.commandId === right.commandId)];
    expect(acknowledgements.filter(({ ok }) => ok)).toHaveLength(1);
    expect(acknowledgements.find(({ ok }) => !ok)).toMatchObject({ code: "STALE_REVISION" });
    const resulting = await snapshot(turn, actor);
    expect(resulting.match?.revision).toBe((turn.match?.revision ?? 0) + 1);
    expect(resulting.journal.filter((event) => event.type === "DISCARD")).toHaveLength(1);
    connection.socket.close();
  });

  it("N03 returns the original receipt before checking revision and rejects a changed digest", async () => {
    const { current, cookies, bySeat } = await startHumanMatch();
    const turn = await advanceRoleReveal(current, cookies);
    const actor = bySeat.get(turn.match?.turnSeatId ?? "") ?? "";
    const view = await snapshot(turn, actor);
    const original = envelope(view, firstDiscard(view));
    const ack = await httpCommand(view, actor, original);
    expect(ack.ok).toBe(true);
    expect(await httpCommand(view, actor, original)).toEqual(ack);
    const changed = { ...original, command: { type: "ACK_SUMMARY" } as const };
    expect(await httpCommand(view, actor, changed)).toMatchObject({ ok: false, code: "COMMAND_ID_REUSED" });
    const invalid = envelope(await snapshot(view, actor), { type: "DISCARD", instanceId: "unknown-instance" });
    expect((await httpCommand(view, actor, invalid)).ok).toBe(false);
    expect((await snapshot(view, actor)).match?.revision).toBe(ack.revision);
  });

  it("N04 exposes private information only to its owner through all phases and starts a new replay", async () => {
    const initial = await startHumanMatch();
    const { cookies, bySeat } = initial;
    let current = initial.current;
    expect(current.match?.phase).toBe("ROLE_REVEAL");
    const views = await Promise.all(cookies.map((cookie) => snapshot(current, cookie)));
    for (const view of views) {
      expect(view.match).toMatchObject({ requiredOre: 1, maxTurns: null, deckCount: 49 });
      expect(view.match?.self.hand).toHaveLength(6);
      expect(view.match?.self.role).toMatch(/prospector|traitor/);
      expect(view.match?.seats.every((seat) => seat.role === undefined)).toBe(true);
      const hiddenGoals = view.match?.board.filter((tile) => tile.kind === "goal");
      expect(hiddenGoals).toHaveLength(3);
      expect(hiddenGoals?.map(({ x, y }) => [x, y])).toEqual([[8, -2], [8, 0], [8, 2]]);
      expect(new Set(hiddenGoals?.map(({ assetId }) => assetId)).size).toBe(1);
      expect(view.match?.finalScores).toBeUndefined();
      const raw = JSON.stringify(view);
      for (const other of views.filter((candidate) => candidate !== view)) {
        for (const item of other.match?.self.hand ?? []) expect(raw).not.toContain(item.instanceId);
      }
      expect(raw).not.toMatch(/"rngSecret"|"rng_secret"|"definition"|"discard"|"rewards"|"deck":/);
    }

    const initialMatchId = current.match?.matchId;
    const summaries: number[] = [];
    let scouted = false;
    let placed = false;
    const limit = definition.ruleset.rounds * (definition.ruleset.deck.total + 2) + 1;
    for (let steps = 0; steps < limit; steps++) {
      switch (current.match?.phase) {
        case "ROLE_REVEAL":
          current = await advanceRoleReveal(current, cookies);
          break;
        case "TURN": {
          const actor = bySeat.get(current.match.turnSeatId ?? "") ?? "";
          const actorView = await snapshot(current, actor);
          const scout = scouted ? undefined : actorView.match?.moves.find((move) => move.type === "PLAY_SCOUT");
          const tunnel = placed || scout ? undefined : actorView.match?.moves.find((move) => move.type === "PLAY_TUNNEL");
          current = await command(actorView, actor, scout ?? tunnel ?? firstDiscard(actorView));
          if (tunnel?.type === "PLAY_TUNNEL") {
            placed = true;
            const spectator = await snapshot(current, cookies.find((cookie) => cookie !== actor) ?? "");
            const tile = (view: RoomSnapshot) => view.match?.board.find(({ x, y }) => x === tunnel.x && y === tunnel.y);
            expect(tile(current)).toMatchObject({ kind: "tunnel", placedBySeatId: actorView.room.mySeatId });
            expect(tile(spectator)).toEqual(tile(current));
            expect(spectator.match?.board.filter(({ kind }) => kind !== "tunnel").some(({ placedBySeatId }) => placedBySeatId)).toBe(false);
          }
          if (scout && current.match?.phase === "TURN") {
            scouted = true;
            expect(current.match.self.scoutResults).toHaveLength(1);
            const spectator = await snapshot(current, cookies.find((cookie) => cookie !== actor) ?? "");
            expect(spectator.match?.self.scoutResults).toEqual([]);
            expect(spectator.journal.findLast(({ type }) => type === "PLAY_SCOUT")).not.toHaveProperty("data");
          }
          expect(current.journal.filter(({ type }) => type === "DISCARD").every((entry) => entry.data === undefined)).toBe(true);
          break;
        }
        case "ROUND_SUMMARY":
          summaries.push(current.match.roundNo);
          expect(current.match.seats.every((seat) => seat.role !== undefined)).toBe(true);
          expect(current.match.seats.every((seat) => seat.handCount === 0)).toBe(true);
          expect(current.match).toMatchObject({ deckCount: 0, turnNumber: 67, outcome: { reason: "exhaustion" } });
          expect(current.match.board.filter((tile) => tile.kind === "goal").every((tile) => tile.revealed)).toBe(true);
          expect(current.match.board.filter((tile) => tile.kind === "goal" && tile.assetId === "goal-gold")).toHaveLength(1);
          expect(current.match.finalScores).toBeUndefined();
          expect(current.match.self.roundScore).toBeGreaterThanOrEqual(0);
          for (const cookie of cookies) current = await command(current, cookie, { type: "ACK_SUMMARY" });
          break;
        case "MATCH_FINISHED":
          steps = limit;
          break;
        default: throw new Error("Unexpected phase");
      }
    }

    expect(scouted).toBe(true);
    expect(placed).toBe(true);
    expect(summaries).toEqual([1, 2, 3]);
    expect(current.match?.phase).toBe("MATCH_FINISHED");
    const finalScores = current.match?.finalScores ?? [];
    expect(finalScores).toHaveLength(3);
    const highestScore = Math.max(...finalScores.map(({ score }) => score));
    expect(current.match?.winnerSeatIds).toEqual(highestScore > 0
      ? finalScores.filter(({ score }) => score === highestScore).map(({ seatId }) => seatId)
      : []);
    const replay = envelope(current, { type: "REPLAY" });
    const ack = await httpCommand(current, cookies[0], replay);
    expect(ack.ok).toBe(true);
    const next = await snapshot(current, cookies[0]);
    expect(next.match?.matchId).not.toBe(initialMatchId);
    expect(next.match?.phase).toBe("ROLE_REVEAL");
    expect(next.match?.self.score).toBe(0);
    expect(await httpCommand(current, cookies[0], replay)).toEqual(ack);
  }, 60_000);

  it("N05 reconnects to the same private seat and resyncs chat without a gameplay revision", async () => {
    const { current, cookies } = await startHumanMatch();
    const hostView = await snapshot(current, cookies[0]);
    const first = websocket(cookies[0]);
    await once(first.socket, "open");
    first.send({ type: "SUBSCRIBE", roomId: current.room.roomId });
    const before = await first.next(isSnapshot);
    expect(before.room.seats.find(({ seatId }) => seatId === before.room.mySeatId)?.present).toBe(true);
    first.socket.close();
    await once(first.socket, "close");

    const sent = await request(`${matchPath(current)}/chat`, cookies[1], { text: "  Передаю привет  " });
    expect(sent.status).toBe(200);
    const second = websocket(cookies[0]);
    await once(second.socket, "open");
    second.send({ type: "SUBSCRIBE", roomId: current.room.roomId });
    const rejoined = await second.next(isSnapshot);
    expect(rejoined.room.mySeatId).toBe(hostView.room.mySeatId);
    expect(rejoined.match?.self).toEqual(hostView.match?.self);
    expect(rejoined.match?.revision).toBe(hostView.match?.revision);
    expect(rejoined.chat.at(-1)?.text).toBe("Передаю привет");
    expect(rejoined.sequence).toBeGreaterThan(before.sequence);
    second.send({ type: "RESYNC", roomId: current.room.roomId });
    const resynced = await second.next(isSnapshot);
    expect(resynced.sequence).toBe(rejoined.sequence);
    second.socket.close();

    expect((await request(`${matchPath(current)}/leave`, cookies[0], {})).status).toBe(200);
    expect((await snapshot(current, cookies[0])).room.mySeatId).toBe(hostView.room.mySeatId);
    const newGuest = await guest();
    expect((await request("/api/rooms/join", newGuest, { code: current.room.code })).status).toBe(409);
  });

  it("N06 preserves a pinned legacy match through restart, then replays with the active rules", async () => {
    const legacyRuleset = JSON.parse(await readFile(new URL("../../data/rulesets/playtest-expedition-v0.json", import.meta.url), "utf8"));
    await stopTestServer();
    server = await openTestServer(createDefinition(definition.catalog, legacyRuleset));
    const { current, cookies } = await startHumanMatch(5);
    let role = current;
    const firstAck = envelope(role, { type: "ACK_ROLE" });
    const recorded = await httpCommand(role, cookies[0], firstAck);
    role = await snapshot(role, cookies[0]);
    for (const cookie of cookies.slice(1)) role = await command(role, cookie, { type: "ACK_ROLE" });
    expect(role.match?.phase).toBe("TURN");
    expect(role.room.deadlineAt).toBeTruthy();
    const before = await snapshot(role, cookies[0]);
    expect(before.match).toMatchObject({ requiredOre: 2, maxTurns: 24 });
    expect(before.match?.self.hand).toHaveLength(5);
    await stopTestServer();
    server = await openTestServer();
    const after = await snapshot(role, cookies[0]);
    expect(after.match).toEqual(before.match);
    expect(after.journal).toEqual(before.journal);
    expect(after.room.deadlineAt).toBe(before.room.deadlineAt);
    expect(await httpCommand(after, cookies[0], firstAck)).toEqual(recorded);
    await expect.poll(async () => (await snapshot(after, cookies[0])).match?.revision, { timeout: 7000, interval: 100 })
      .toBe((before.match?.revision ?? 0) + 1);
    const timed = await snapshot(after, cookies[0]);
    expect(timed.journal.findLast(({ type }) => type === "DISCARD")?.data).toBeUndefined();
    const abandoned = await command(timed, cookies[0], { type: "ABANDON" });
    const replay = await command(abandoned, cookies[0], { type: "REPLAY" });
    expect(replay.match?.matchId).not.toBe(before.match?.matchId);
    expect(replay.match).toMatchObject({ requiredOre: 1, maxTurns: null });
    expect(replay.match?.self.hand).toHaveLength(6);
  }, 25_000);

  it("N07 checks origin, strict fields, body sizes, cookie attributes and rate limits", async () => {
    const denied = await request("/api/session/guest", undefined, { name: "Блок" }, "https://other.invalid");
    expect(denied.status).toBe(403);
    const missingOrigin = await fetch(address("/api/session/guest"), { method: "POST" });
    expect(missingOrigin.status).toBe(403);
    const valid = await request("/api/session/guest", undefined, { name: "  Два  Слова " });
    const cookie = valid.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(await valid.json()).toEqual({ name: "Два Слова", avatarId: expect.any(String) });
    const owner = cookie.split(";")[0];
    const wrongOrigin = websocket(owner, "https://other.invalid");
    const [originError] = await once(wrongOrigin.socket, "error");
    expect(String(originError)).toContain("403");
    const noIdentity = websocket();
    const [identityError] = await once(noIdentity.socket, "error");
    expect(String(identityError)).toContain("401");

    const initial = await room(owner);
    const existing = envelope(initial, { type: "SET_READY", ready: true });
    const invalid = await request(`${matchPath(initial)}/commands`, owner, {
      ...existing, command: { ...existing.command, playerId: initial.room.hostSeatId },
    });
    expect(invalid.status).toBe(400);
    const overlong = await request(`${matchPath(initial)}/chat`, owner, { text: "a".repeat(4096) });
    expect(overlong.status).toBe(413);
    const invalidCode = await request("/api/rooms/join", owner, { code: "no" });
    expect(invalidCode.status).toBe(400);
    const offRoom = await request(`${matchPath(initial)}/commands`, owner, { ...existing, roomId: randomUUID() });
    expect(offRoom.status).toBe(400);
    const flood = await Promise.all(Array.from({ length: 14 }, () =>
      request(`${matchPath(initial)}/chat`, owner, { text: "Сообщение" })));
    expect(flood.some((response) => response.status === 429)).toBe(true);
    expect(flood.some((response) => response.status === 200)).toBe(true);
  });

  it.each([[2, 8], [3, 7]])("fills a mixed room with %i humans and %i bots", async (humans, bots) => {
    const cookies = await Promise.all(Array.from({ length: humans }, (_, index) => guest(`Игрок ${index + 1}`)));
    const [owner, teammate] = cookies;
    let current = await room(owner);
    for (const cookie of cookies.slice(1)) {
      const response = await request("/api/rooms/join", cookie, { code: current.room.code });
      expect(response.status).toBe(200);
    }
    for (const cookie of cookies) current = await command(current, cookie, { type: "SET_READY", ready: true });

    const addBot = { type: "ADD_BOT" } as const;
    const startMatch = { type: "START_MATCH" } as const;
    expect(await httpCommand(current, teammate, envelope(current, addBot))).toMatchObject({ ok: false, code: "HOST_REQUIRED" });
    if (humans === 2) {
      expect(await httpCommand(current, owner, envelope(current, startMatch))).toMatchObject({ ok: false, code: "NOT_ENOUGH_PLAYERS" });
    }
    for (let count = 0; count < bots; count++) current = await command(current, owner, addBot);
    expect(await httpCommand(current, owner, envelope(current, addBot))).toMatchObject({ ok: false, code: "ROOM_FULL" });

    const bot = current.room.seats.find((seat) => seat.bot);
    if (!bot) throw new Error("Expected a bot to remove");
    const removeBot = { type: "REMOVE_BOT", seatId: bot.seatId } as const;
    expect(await httpCommand(current, teammate, envelope(current, removeBot))).toMatchObject({ ok: false, code: "HOST_REQUIRED" });
    current = await command(current, owner, removeBot);
    expect(current.room.seats).toHaveLength(9);
    expect(current.room.seats.some((seat) => seat.seatId === bot.seatId)).toBe(false);
    current = await command(current, owner, addBot);

    current = await command(current, owner, startMatch);
    const teammateView = await snapshot(current, teammate);
    expect(teammateView.room.seats.filter((seat) => seat.bot)).toHaveLength(bots);
    expect(teammateView.room.seats.filter((seat) => !seat.bot)).toHaveLength(humans);
    expect(teammateView.match).toMatchObject({ matchId: current.match?.matchId, phase: "ROLE_REVEAL" });
    expect(teammateView.match?.seats).toHaveLength(10);
  });

  it("runs bot confirmations automatically and lets only the host abandon an unattended match", async () => {
    const owner = await guest();
    const teammate = await guest();
    let current = await room(owner);
    expect((await request("/api/rooms/join", teammate, { code: current.room.code })).status).toBe(200);
    current = await command(current, owner, { type: "ADD_BOT" });
    current = await command(current, teammate, { type: "SET_READY", ready: true });
    current = await command(current, owner, { type: "SET_READY", ready: true });
    current = await command(current, owner, { type: "START_MATCH" });
    current = await command(await snapshot(current, owner), owner, { type: "ACK_ROLE" });
    current = await command(await snapshot(current, teammate), teammate, { type: "ACK_ROLE" });
    await expect.poll(async () => (await snapshot(current, owner)).match?.phase, { timeout: 3500, interval: 50 }).toBe("TURN");
    current = await snapshot(current, owner);
    if (current.match?.turnSeatId === current.room.seats.find(({ bot }) => bot)?.seatId) {
      await expect.poll(async () => (await snapshot(current, owner)).match?.revision, { timeout: 3500, interval: 50 })
        .toBeGreaterThan(current.match?.revision ?? 0);
    }
    current = await snapshot(current, teammate);
    expect(await httpCommand(current, teammate, envelope(current, { type: "ABANDON" }))).toMatchObject({ code: "HOST_REQUIRED" });
    current = await command(await snapshot(current, owner), owner, { type: "ABANDON" });
    expect(current.match?.phase).toBe("ABANDONED");
    expect(current.match?.seats.every(({ role }) => role === undefined)).toBe(true);
  });

  it("serializes the last anonymous invitation seat and restores the admitted guest after start", async () => {
    const owner = await guest("Ведущий");
    let current = await room(owner);
    for (let count = 0; count < 8; count++) current = await command(current, owner, { type: "ADD_BOT" });

    const before = await identityCounts();
    const invitation = { code: current.room.code };
    const candidates = await Promise.all(Array.from({ length: 2 }, () => request("/api/rooms/join", undefined, invitation)));
    expect(candidates.map(({ status }) => status).sort()).toEqual([200, 409]);
    const rejected = candidates.find(({ status }) => status === 409)!;
    expect(await rejected.json()).toMatchObject({ code: "ROOM_FULL" });
    expect(rejected.headers.has("set-cookie")).toBe(false);
    expect(await identityCounts()).toEqual({ profiles: before.profiles + 1, sessions: before.sessions + 1 });

    const admitted = candidates.find(({ status }) => status === 200)!;
    const cookie = responseCookie(admitted);
    const joined = await admitted.json() as RoomSnapshot;
    expect(joined.room.seats).toHaveLength(10);
    expect(joined.room.seats.find(({ seatId }) => seatId === joined.room.mySeatId)?.name).toMatch(/^Гость/u);
    expect((await snapshot(joined, cookie)).room.mySeatId).toBe(joined.room.mySeatId);

    current = await command(current, cookie, { type: "SET_READY", ready: true });
    current = await command(current, owner, { type: "SET_READY", ready: true });
    current = await command(current, owner, { type: "START_MATCH" });
    const after = await identityCounts();
    const late = await request("/api/rooms/join", undefined, invitation);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: "MATCH_STARTED" });
    expect(late.headers.has("set-cookie")).toBe(false);
    const repeated = await request("/api/rooms/join", cookie, invitation);
    expect(repeated.status).toBe(200);
    const restored = await repeated.json() as RoomSnapshot;
    expect(restored.room.mySeatId).toBe(joined.room.mySeatId);
    expect(restored.match?.matchId).toBe(current.match?.matchId);
    expect((await request(`${matchPath(current)}/name`, cookie, { name: "Позднее имя" })).status).toBe(409);
    expect(await (await request("/api/session", cookie)).json()).not.toMatchObject({ name: "Позднее имя" });
    expect(await identityCounts()).toEqual(after);
  });

  it("grants hosting by private key and broadcasts a passwordless guest's lobby rename", async () => {
    const hostKey = randomBytes(32).toString("hex");
    await stopTestServer();
    server = await openTestServer(definition, { hostKey, origin: "https://invite-playtest.invalid" });

    const entry = () => request("/api/entry");
    expect(await (await entry()).json()).toEqual({ canCreateRooms: false });
    const noHost = await request("/api/session/guest", undefined, { name: "Гость с главной" });
    expect(noHost.status).toBe(403);
    expect(noHost.headers.has("set-cookie")).toBe(false);
    const offOrigin = await request("/api/session/host", undefined, { key: hostKey }, "https://other.invalid");
    expect(offOrigin.status).toBe(403);
    expect(offOrigin.headers.has("set-cookie")).toBe(false);
    const wrongKey = await request("/api/session/host", undefined, { key: "0".repeat(64) });
    expect(wrongKey.status).toBe(403);
    expect(wrongKey.headers.has("set-cookie")).toBe(false);

    const granted = await request("/api/session/host", undefined, { key: hostKey });
    expect(granted.ok).toBe(true);
    expect(granted.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(granted.headers.get("set-cookie")).toMatch(/\bSecure\b/i);
    expect(granted.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    const grantCookie = responseCookie(granted);
    expect(await (await request("/api/entry", grantCookie)).json()).toEqual({ canCreateRooms: true });
    expect(await (await request("/api/entry", grantCookie.replace(/=.+$/, "=invalid"))).json()).toEqual({ canCreateRooms: false });
    expect((await request("/api/session", grantCookie)).status).toBe(401);
    const host = await guest("Ведущий", grantCookie);
    const owner = `${host}; ${grantCookie}`;
    expect((await request("/api/rooms", host, {})).status).toBe(403);
    const created = await room(owner);

    const before = await identityCounts();
    const malformed = await request("/api/rooms/join", undefined, { code: `${created.room.code}2` });
    expect(malformed.status).toBe(400);
    const unknown = `${created.room.code.slice(0, -1)}${created.room.code.endsWith("2") ? "3" : "2"}`;
    const missing = await request("/api/rooms/join", undefined, { code: unknown });
    expect(missing.status).toBe(404);
    const foreign = await request("/api/rooms/join", undefined, { code: created.room.code }, "https://other.invalid");
    expect(foreign.status).toBe(403);
    for (const result of [malformed, missing, foreign]) expect(result.headers.has("set-cookie")).toBe(false);
    expect(await identityCounts()).toEqual(before);

    const admitted = await request("/api/rooms/join", undefined, { code: created.room.code });
    expect(admitted.status).toBe(200);
    expect(admitted.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(admitted.headers.get("set-cookie")).toMatch(/\bSecure\b/i);
    expect(admitted.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    const friend = responseCookie(admitted);
    const joined = await admitted.json() as RoomSnapshot;
    expect(await (await request("/api/entry", friend)).json()).toEqual({ canCreateRooms: false });
    expect((await request("/api/rooms", friend, {})).status).toBe(403);

    const spectator = websocket(owner);
    try {
      await once(spectator.socket, "open");
      spectator.send({ type: "SUBSCRIBE", roomId: created.room.roomId });
      await spectator.next(isSnapshot);
      const renamed = await request(`${matchPath(created)}/name`, friend, { name: "  Артём  Игрок " });
      expect(renamed.status).toBe(200);
      const renameView = await renamed.json() as RoomSnapshot;
      expect(renameView.room.seats.find(({ seatId }) => seatId === joined.room.mySeatId)?.name).toBe("Артём Игрок");
      const published = await spectator.next((message): message is Extract<ServerMessage, { type: "SNAPSHOT" }> =>
        isSnapshot(message) && message.room.seats.some(({ seatId, name }) => seatId === joined.room.mySeatId && name === "Артём Игрок"));
      expect(published.room.mySeatId).toBe(created.room.mySeatId);
      expect(await (await request("/api/session", friend)).json()).toMatchObject({ name: "Артём Игрок" });
    } finally {
      spectator.socket.close();
    }
  });
});
