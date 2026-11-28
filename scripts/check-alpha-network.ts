import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import { connectDatabase, migrate } from "../apps/server/src/database.js";
import { startServer } from "../apps/server/src/http.js";
import { Rooms } from "../apps/server/src/rooms.js";
import { createSession, SESSION_COOKIE } from "../apps/server/src/session.js";
import { loadActiveDefinition } from "../packages/config/src/index.js";
import type { CommandAck, RoomSnapshot, ServerMessage, WireCommand } from "../packages/protocol/src/index.js";

const origin = "http://127.0.0.1:4173";
const commandsMs: number[] = [];
let drops = 0;
let closing = false;
const sockets = new Set<WebSocket>();

function requireValue<T>(value: T | null | undefined, detail: string): T {
  if (value == null) throw new Error(detail);
  return value;
}

async function openPeer(address: string, roomId: string, token: string) {
  const socket = new WebSocket(`${address}/ws`, { origin, headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  sockets.add(socket);
  const changes = new EventEmitter();
  let current: RoomSnapshot | undefined;
  let ack: CommandAck | undefined;
  let failure: string | undefined;
  socket.on("error", () => { failure = "socket error"; changes.emit("change"); });
  socket.on("close", () => {
    if (!closing) drops++;
    failure = "socket closed";
    changes.emit("change");
  });
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === "ERROR") failure = message.code;
    if (message.type === "ACK") ack = message;
    if (message.type === "SNAPSHOT") current = message;
    changes.emit("change");
  });

  async function wait<T>(read: () => T | undefined): Promise<T> {
    const signal = AbortSignal.timeout(15_000);
    while (!failure) {
      const value = read();
      if (value !== undefined) return value;
      await once(changes, "change", { signal });
    }
    throw new Error(failure);
  }

  await once(socket, "open", { signal: AbortSignal.timeout(15_000) });
  socket.send(JSON.stringify({ type: "SUBSCRIBE", roomId }));
  await wait(() => current);

  return {
    view: () => requireValue(current, "missing snapshot"),
    sync: (revision: number) => wait(() => (current?.match?.revision ?? 0) >= revision ? current : undefined),
    async send(command: WireCommand, measure: boolean) {
      const match = current?.match;
      const commandId = randomUUID();
      const started = performance.now();
      socket.send(JSON.stringify({ type: "COMMAND", roomId, commandId,
        expectedRevision: match?.revision ?? 0, matchId: match?.matchId ?? null, command }));
      const result = await wait(() => ack?.commandId === commandId ? ack : undefined);
      if (!result.ok) throw new Error(`${command.type}: ${result.code ?? "missing ACK"}`);
      if (measure) commandsMs.push(performance.now() - started);
      return requireValue(result.revision, "missing revision");
    },
    ready: () => wait(() => current?.room.seats.every((seat) => seat.present) ? current : undefined),
  };
}

type Peer = Awaited<ReturnType<typeof openPeer>>;

async function advance(peers: Peer[], command: WireCommand, actor: Peer, measure = false) {
  const revision = await actor.send(command, measure);
  await Promise.all(peers.map((peer) => peer.sync(revision)));
}

async function play(peers: Peer[], steps: number, measure: boolean) {
  await advance(peers, { type: "START_MATCH" }, peers[0], measure);
  for (let step = 0; step < steps; step++) {
    const match = requireValue(peers[0].view().match, "missing active match");
    if (match.phase === "MATCH_FINISHED") return match.roundNo;
    if (match.phase === "ROLE_REVEAL" || match.phase === "ROUND_SUMMARY") {
      const action = match.phase === "ROLE_REVEAL" ? "ACK_ROLE" : "ACK_SUMMARY";
      const actor = requireValue(peers.find((peer) => peer.view().match?.moves.some(({ type }) => type === action)), "missing acknowledgement actor");
      await advance(peers, { type: action }, actor, measure);
      continue;
    }
    const actor = requireValue(peers.find((peer) => peer.view().room.mySeatId === match.turnSeatId), "missing turn owner");
    const moves = requireValue(actor.view().match, "missing personal snapshot").moves;
    const move = moves.find(({ type }) => type === "PLAY_TUNNEL") ?? moves.find(({ type }) => type === "DISCARD");
    if (move?.type !== "PLAY_TUNNEL" && move?.type !== "DISCARD") throw new Error("missing turn move");
    await advance(peers, move, actor, measure);
  }
  return 0;
}

function p95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1] * 10) / 10;
}

async function run() {
  const mode = process.argv[2] ?? "load";
  if (mode !== "load" && mode !== "matches") throw new Error("Choose load or matches");
  const databaseUrl = requireValue(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required");
  const isolatedUrl = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(isolatedUrl.hostname)) {
    throw new Error("TEST_DATABASE_URL must point to a loopback PostgreSQL instance");
  }
  if (isolatedUrl.searchParams.has("options")) throw new Error("The benchmark owns its PostgreSQL search_path");
  const schema = `alpha_acceptance_${randomUUID().replaceAll("-", "")}`;
  isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const admin = connectDatabase(databaseUrl);
  const db = connectDatabase(isolatedUrl.toString());
  let created = false;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrate(db);
    const definition = await loadActiveDefinition();
    const rooms = new Rooms(db, definition, true, () => false);
    const sizes = mode === "load" ? Array<number>(20).fill(10) : [3, 6, 10];
    server = await startServer({ db, definition, origin, playtest: true, host: "127.0.0.1", port: 0 });
    const address = `http://127.0.0.1:${server.port}`;
    const version = await db.query<{ server_version: string }>("SHOW server_version");
    const ready = await fetch(`${address}/health/ready`);
    if (!ready.ok) throw new Error(`readiness HTTP ${ready.status}`);
    const groups = [];
    for (const size of sizes) {
      const sessions = await Promise.all(Array.from({ length: size }, (_, index) => createSession(db, `Участник ${index + 1}`)));
      const host = await rooms.create(sessions[0].identity);
      for (const session of sessions.slice(1)) await rooms.join(host.room.code, session.identity);
      const roomId = host.room.roomId;
      await db.query("UPDATE seats SET ready = TRUE WHERE room_id = $1", [roomId]);
      const peers = await Promise.all(sessions.map(({ token }) => openPeer(address.replace("http", "ws"), roomId, token)));
      await Promise.all(peers.map((peer) => peer.ready()));
      groups.push(peers);
    }
    const started = performance.now();
    const completedRounds = await Promise.all(groups.map((peers) => play(peers, mode === "load" ? 35 : 300, mode === "load")));
    const response = await fetch(`${address}/health/metrics`);
    if (!response.ok) throw new Error(`metrics HTTP ${response.status}`);
    const metrics = await response.json() as { rooms: number; sockets: number; commands: number; commandDurationMs: number; resyncs: number };
    const expectedSockets = sizes.reduce((sum, size) => sum + size, 0);
    if (drops || metrics.rooms !== sizes.length || metrics.sockets !== expectedSockets) throw new Error("A room or socket was lost");
    const localAckP95Ms = mode === "load" ? p95(commandsMs) : undefined;
    console.log(JSON.stringify({ mode, node: process.version, postgres: version.rows[0].server_version,
      roomSizes: sizes, sockets: metrics.sockets, droppedSockets: drops, commands: metrics.commands,
      localAckP95Ms, meanServerCommandMs: Math.round(metrics.commandDurationMs / metrics.commands * 10) / 10,
      elapsedMs: Math.round(performance.now() - started), completedRounds: mode === "matches" ? completedRounds : undefined }));
    if (mode === "matches" && completedRounds.some((rounds) => rounds !== 3)) throw new Error("A match did not finish all three rounds");
    if (mode === "load" && (metrics.commands !== 720 || commandsMs.length !== 720 || localAckP95Ms === undefined || localAckP95Ms > 150)) {
      throw new Error("Concurrent command count or loopback ACK p95 missed the target");
    }
  } finally {
    closing = true;
    for (const socket of sockets) socket.terminate();
    try {
      await server?.close();
    } finally {
      await db.end();
      try {
        if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }
}

try {
  await run();
} catch (error) {
  const detail = error instanceof Error ? error.message : "unexpected failure";
  console.error(detail.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL]"));
  process.exitCode = 1;
}
