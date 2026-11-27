import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { applyCommand, newMatch, playerView, startRound } from "../../../packages/game-core/src/index.js";
import { cellKey } from "../../../packages/game-core/src/graph.js";
import type { Command, CommitResult, Definition, MatchEvent, MatchState, Rng } from "../../../packages/game-core/src/types.js";
import { chooseBotMove } from "../../../packages/bots/src/index.js";
import type { ChatMessage, CommandAck, CommandEnvelope, JournalEntry, RoomSnapshot } from "../../../packages/protocol/src/index.js";
import { transaction } from "./database.js";
import type { Identity } from "./session.js";

const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
const ROOM_FINISHED_MS = 7 * ROOM_IDLE_MS;
const ROLE_REVEAL_MS = 20_000;
const BOT_DELAY_MS = 300;
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

type Room = {
  room_id: string; code: string; host_seat_id: string | null; current_match_id: string | null;
  sequence: number; turn_timeout_seconds: number | null;
};
type Seat = { seat_id: string; user_id: string | null; name: string; avatar_id: string; ready: boolean; position: number };
type StoredMatch = { match_id: string; state: MatchState; rng_secret: Buffer; deadline_at: Date | null; automation_at: Date | null };
type SystemCommand = { actor: string | null; command: Command };

export class RoomError extends Error {
  constructor(readonly code: string, readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 409) {
    super(code);
  }
}

type RoomAccess = { room: Room; seats: Seat[]; seat: Seat };

function rngFor(secret: Buffer, label: string): Rng {
  let index = 0;
  return () => createHmac("sha256", secret).update(`${label}:${index++}`).digest().readUInt32BE() / 0x1_0000_0000;
}

function commandDigest(expectedRevision: number, command: CommandEnvelope["command"] | Command): string {
  const fields = Object.entries(command).sort(([left], [right]) => left.localeCompare(right, "en"));
  return createHash("sha256").update(JSON.stringify([expectedRevision, fields])).digest("hex");
}

function botPending(state: MatchState, seats: Seat[]): string | undefined {
  const bots = seats.filter((seat) => seat.user_id === null);
  return bots.find(({ seat_id }) => {
    if (state.phase === "TURN") return state.turnSeatId === seat_id;
    if (state.phase === "ROLE_REVEAL") return state.seats.some((s) => s.seatId === seat_id && !s.roleAcknowledged);
    return state.phase === "ROUND_SUMMARY" && !state.summaryAcknowledged.includes(seat_id);
  })?.seat_id;
}

function schedule(state: MatchState, previous: StoredMatch | null, seats: Seat[], timeout: number | null) {
  let deadline: Date | null = null;
  const now = Date.now();
  const samePhase = previous?.state.phase === state.phase && previous.state.roundNo === state.roundNo;
  if (state.phase === "ROLE_REVEAL") {
    deadline = samePhase ? previous.deadline_at : new Date(now + ROLE_REVEAL_MS);
  } else if (state.phase === "TURN" && timeout !== null) {
    deadline = new Date(now + timeout * 1000);
  } else if (state.phase === "ROUND_SUMMARY" && timeout !== null) {
    deadline = samePhase ? previous.deadline_at : new Date(now + timeout * 1000);
  }
  const botAt = botPending(state, seats) ? now + BOT_DELAY_MS : null;
  const automation = botAt === null ? deadline :
    new Date(Math.min(botAt, deadline?.getTime() ?? Infinity));
  return { deadline, automation };
}

function journalData(event: MatchEvent): JournalEntry["data"] {
  const data = event.data;
  if (!data) return undefined;
  switch (event.type) {
    case "PLAY_TUNNEL": return { x: data.x ?? null, y: data.y ?? null, rotation: data.rotation ?? null };
    case "PLAY_COLLAPSE": return { x: data.x ?? null, y: data.y ?? null };
    case "PLAY_BREAK":
    case "PLAY_REPAIR": return { targetSeatId: data.targetSeatId ?? null, tool: data.tool ?? null };
    case "GOAL_REVEALED": return { goalSlotId: data.goalSlotId ?? null };
    default: return undefined;
  }
}

export class Rooms {
  constructor(
    private readonly db: Pool,
    private readonly definition: Definition,
    private readonly playtest: boolean,
    private readonly present: (roomId: string, seatId: string) => boolean,
  ) {}

  async create(identity: Identity): Promise<RoomSnapshot> {
    const roomId = randomUUID();
    await transaction(this.db, async (client) => {
      let created = false;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
        const result = await client.query(`
          INSERT INTO rooms (room_id, code, turn_timeout_seconds, expires_at)
          VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING
        `, [roomId, code, this.definition.ruleset.turn.timeoutDefaultSeconds, new Date(Date.now() + ROOM_IDLE_MS)]);
        created = result.rowCount === 1;
      }
      if (!created) throw new RoomError("INVITE_UNAVAILABLE");
      const seatId = randomUUID();
      await client.query("INSERT INTO seats (seat_id, room_id, user_id, name, avatar_id, position) VALUES ($1,$2,$3,$4,$5,0)",
        [seatId, roomId, identity.userId, identity.name, identity.avatarId]);
      await client.query("UPDATE rooms SET host_seat_id = $2, sequence = 1 WHERE room_id = $1", [roomId, seatId]);
    });
    return this.snapshot(roomId, identity.userId);
  }

  async join(code: string, identity: Identity): Promise<RoomSnapshot> {
    const roomId = await transaction(this.db, async (client) => {
      const result = await client.query<Room>("SELECT * FROM rooms WHERE code = $1 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE", [code]);
      const room = result.rows[0];
      if (!room) throw new RoomError("ROOM_NOT_FOUND", 404);
      const seats = await this.seats(client, room.room_id);
      if (seats.some((seat) => seat.user_id === identity.userId)) return room.room_id;
      if (room.current_match_id) throw new RoomError("MATCH_STARTED");
      if (seats.length >= this.definition.ruleset.players.max) throw new RoomError("ROOM_FULL");
      await client.query("INSERT INTO seats (seat_id, room_id, user_id, name, avatar_id, position) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), room.room_id, identity.userId, identity.name, identity.avatarId, (seats.at(-1)?.position ?? -1) + 1]);
      await this.bumpSequence(client, room.room_id);
      return room.room_id;
    });
    return this.snapshot(roomId, identity.userId);
  }

  async leave(roomId: string, userId: string): Promise<string> {
    return transaction(this.db, async (client) => {
      const { room, seats, seat } = await this.access(client, roomId, userId);
      if (room.current_match_id) return seat.seat_id;
      const successor = seats.find((candidate) => candidate.seat_id !== seat.seat_id && candidate.user_id !== null);
      if (room.host_seat_id === seat.seat_id) {
        await client.query("UPDATE rooms SET host_seat_id = $2, expires_at = CASE WHEN $2::uuid IS NULL THEN now() ELSE expires_at END WHERE room_id = $1",
          [roomId, successor?.seat_id ?? null]);
      }
      await client.query("DELETE FROM seats WHERE seat_id = $1", [seat.seat_id]);
      await this.bumpSequence(client, roomId);
      return seat.seat_id;
    });
  }

  async seatId(roomId: string, userId: string): Promise<string> {
    return transaction(this.db, async (client) => (await this.access(client, roomId, userId, "SHARE")).seat.seat_id);
  }

  async presenceChanged(roomId: string): Promise<void> {
    await this.db.query("UPDATE rooms SET sequence = sequence + 1 WHERE room_id = $1", [roomId]);
  }

  async chat(roomId: string, userId: string, message: string): Promise<void> {
    await transaction(this.db, async (client) => {
      const { seat } = await this.access(client, roomId, userId);
      const sequence = await this.bumpSequence(client, roomId);
      await client.query("INSERT INTO chat_messages (message_id, room_id, sequence, seat_id, author_name, body) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), roomId, sequence, seat.seat_id, seat.name, message]);
    });
  }

  async snapshot(roomId: string, userId: string): Promise<RoomSnapshot> {
    const snapshots = await this.snapshots(roomId, [userId]);
    const snapshot = snapshots.get(userId);
    if (!snapshot) throw new RoomError("NOT_MEMBER", 403);
    return snapshot;
  }

  async snapshots(roomId: string, userIds: readonly string[]): Promise<Map<string, RoomSnapshot>> {
    return transaction(this.db, async (client) => {
      const room = await this.room(client, roomId, "SHARE");
      const seats = await this.seats(client, roomId);
      const userSeats = seats.filter((seat) => seat.user_id !== null && userIds.includes(seat.user_id));
      if (userSeats.length === 0) return new Map();
      const match = await this.match(client, room.current_match_id);
      const chat = await client.query<ChatMessage>(`
        SELECT message_id AS "messageId", seat_id AS "seatId", author_name AS name, body AS text, created_at AS at
        FROM chat_messages WHERE room_id = $1 ORDER BY sequence DESC LIMIT 50
      `, [roomId]);
      const journal = await client.query<JournalEntry>(`
        SELECT sequence, actor_seat_id AS "actorSeatId", type, revision, created_at AS at, public_data AS data
        FROM journal_events WHERE room_id = $1 ORDER BY sequence DESC LIMIT 100
      `, [roomId]);
      const tunnelAuthors = new Map<string, string>();
      if (match?.state.board.length) {
        const placements = await client.query<Pick<JournalEntry, "actorSeatId" | "type" | "data">>(`
          SELECT actor_seat_id AS "actorSeatId", type, public_data AS data
          FROM journal_events
          WHERE room_id = $1 AND match_id = $2 AND type IN ('ROUND_SETUP', 'PLAY_TUNNEL')
          ORDER BY sequence DESC
        `, [roomId, match.match_id]);
        for (const { actorSeatId, type, data } of placements.rows) {
          if (type === "ROUND_SETUP") break;
          if (!actorSeatId || typeof data?.x !== "number" || typeof data.y !== "number") continue;
          const key = cellKey(data.x, data.y);
          if (!tunnelAuthors.has(key)) tunnelAuthors.set(key, actorSeatId);
        }
      }
      const visibleSeats = seats.map((seat) => ({
        seatId: seat.seat_id, name: seat.name, avatarId: seat.avatar_id, ready: seat.ready,
        present: seat.user_id === null || this.present(roomId, seat.seat_id), bot: seat.user_id === null,
      }));
      const visibleChat = chat.rows.reverse();
      const visibleJournal = journal.rows.reverse().map(({ data, ...entry }) => data ? { ...entry, data } : entry);
      return new Map(userSeats.map((seat) => {
        const view = match && playerView(match.state, seat.seat_id);
        for (const tile of view?.board ?? []) {
          if (tile.kind !== "tunnel") continue;
          const author = tunnelAuthors.get(cellKey(tile.x, tile.y));
          if (author) tile.placedBySeatId = author;
        }
        return [seat.user_id as string, {
          room: {
            roomId, code: room.code, hostSeatId: room.host_seat_id, mySeatId: seat.seat_id, seats: visibleSeats,
            turnTimeoutSeconds: room.turn_timeout_seconds, deadlineAt: match?.deadline_at?.toISOString() ?? null,
          },
          match: view,
          chat: visibleChat, journal: visibleJournal, sequence: room.sequence,
        }];
      }));
    });
  }

  async command(userId: string, envelope: CommandEnvelope): Promise<{ ack: CommandAck; changed: boolean }> {
    return transaction(this.db, async (client) => {
      const { room, seats, seat } = await this.access(client, envelope.roomId, userId);
      const scope = envelope.matchId ?? "lobby";
      const digest = commandDigest(envelope.expectedRevision, envelope.command);
      const receiptKey = [room.room_id, scope, seat.seat_id, envelope.commandId];
      const receipt = await client.query<{ digest: string; ack: CommandAck }>(
        "SELECT digest, ack FROM command_receipts WHERE room_id = $1 AND match_scope = $2 AND actor_seat_id = $3 AND command_id = $4", receiptKey);
      if (receipt.rows[0]) {
        const saved = receipt.rows[0];
        return { ack: saved.digest === digest ? saved.ack : this.reject(envelope.commandId, "COMMAND_ID_REUSED"), changed: false };
      }
      const match = await this.match(client, room.current_match_id);
      const revision = match?.state.revision ?? 0;
      let ack: CommandAck;
      let changed = false;
      if (room.current_match_id !== envelope.matchId || revision !== envelope.expectedRevision) {
        ack = this.reject(envelope.commandId, "STALE_REVISION", revision);
      } else {
        try {
          const expired = envelope.command.type === "ABANDON" || !match ? undefined : this.expiredCommand(match);
          if (match && expired) {
            const next = await this.commitAutomation(client, room, seats, match, expired);
            ack = this.reject(envelope.commandId, "STALE_REVISION", next);
          } else {
            const nextRevision = await this.execute(client, { room, seats, seat }, match, envelope.command);
            ack = { type: "ACK", commandId: envelope.commandId, ok: true, revision: nextRevision };
          }
          changed = true;
        } catch (error) {
          if (!(error instanceof RoomError)) throw error;
          ack = this.reject(envelope.commandId, error.code, revision);
        }
      }
      await client.query("INSERT INTO command_receipts (room_id, match_scope, actor_seat_id, command_id, digest, ack) VALUES ($1,$2,$3,$4,$5,$6)",
        [...receiptKey, digest, ack]);
      return { ack, changed };
    });
  }

  async dueRooms(): Promise<string[]> {
    const result = await this.db.query<{ room_id: string }>(`
      SELECT r.room_id FROM matches m JOIN rooms r ON r.current_match_id = m.match_id
      WHERE m.automation_at <= now() ORDER BY m.automation_at LIMIT 50
    `);
    return result.rows.map(({ room_id }) => room_id);
  }

  async automate(roomId: string): Promise<boolean> {
    return transaction(this.db, async (client) => {
      const room = await this.room(client, roomId);
      const match = await this.match(client, room.current_match_id);
      if (!match?.automation_at || match.automation_at.getTime() > Date.now()) return false;
      const seats = await this.seats(client, roomId);
      const action = this.automaticCommand(match, seats);
      if (!action) throw new Error("Scheduled match lacks an automatic command");
      await this.commitAutomation(client, room, seats, match, action);
      return true;
    });
  }

  private async commitAutomation(client: PoolClient, room: Room, seats: Seat[], match: StoredMatch, action: SystemCommand): Promise<number> {
    const revision = match.state.revision;
    const commandId = `system-${revision}`;
    const result = applyCommand(match.state, action.actor, action.command, rngFor(match.rng_secret, `revision:${revision}`));
    if (!result.ok) throw new Error("Automatic match command was rejected");
    await this.writeCommit(client, room, seats, match, match.rng_secret, result);
    const ack: CommandAck = { type: "ACK", commandId, ok: true, revision: result.state.revision };
    await client.query("INSERT INTO command_receipts (room_id, match_scope, actor_seat_id, command_id, digest, ack) VALUES ($1,$2,'system',$3,$4,$5)",
      [room.room_id, match.match_id, commandId, commandDigest(revision, action.command), ack]);
    return result.state.revision;
  }

  private expiredCommand(match: StoredMatch): SystemCommand | undefined {
    if (!match.deadline_at || match.deadline_at.getTime() > Date.now()) return undefined;
    const state = match.state;
    if (state.phase === "ROLE_REVEAL") return { actor: null, command: { type: "EXPIRE_ROLE_REVEAL" } };
    if (state.phase === "TURN" && state.turnSeatId) {
      const actor = state.turnSeatId;
      const view = playerView(state, actor);
      const command = view.moves.find((move) => move.type === "DISCARD" && move.instanceId === view.self.hand[0]?.instanceId);
      if (command) return { actor, command };
    }
    if (state.phase === "ROUND_SUMMARY") {
      const pending = state.seats.find(({ seatId }) => !state.summaryAcknowledged.includes(seatId));
      if (pending) return { actor: pending.seatId, command: { type: "ACK_SUMMARY" } };
    }
  }

  private automaticCommand(match: StoredMatch, seats: Seat[]): SystemCommand | undefined {
    const expired = this.expiredCommand(match);
    if (expired) return expired;
    const state = match.state;
    const actor = botPending(state, seats);
    if (!actor) return undefined;
    const command = chooseBotMove(playerView(state, actor), rngFor(match.rng_secret, `bot:${state.revision}`));
    if (command) return { actor, command };
  }

  private async execute(client: PoolClient, access: RoomAccess, match: StoredMatch | null, command: CommandEnvelope["command"]): Promise<number> {
    const { room, seats, seat } = access;
    const isHost = seat.seat_id === room.host_seat_id;
    switch (command.type) {
      case "START_MATCH":
      case "REPLAY": {
        if (!isHost) throw new RoomError("HOST_REQUIRED", 403);
        if (command.type === "START_MATCH" ? match : !match || !["MATCH_FINISHED", "ABANDONED"].includes(match.state.phase)) {
          throw new RoomError("WRONG_PHASE");
        }
        const definition = match?.state.definition ?? this.definition;
        if (seats.length < definition.ruleset.players.min) throw new RoomError("NOT_ENOUGH_PLAYERS");
        if (seats.some((candidate) => !candidate.ready)) throw new RoomError("SEATS_NOT_READY");
        const secret = randomBytes(32);
        const state = newMatch(definition, { matchId: randomUUID(), seatIds: seats.map(({ seat_id }) => seat_id) }, rngFor(secret, "match"));
        const result = startRound(state, rngFor(secret, "start"));
        if (!result.ok) throw new RoomError(result.code);
        await this.writeCommit(client, room, seats, null, secret, result);
        return result.state.revision;
      }
      case "SET_READY":
      case "ADD_BOT":
      case "REMOVE_BOT":
      case "SET_TIMER": {
        if (match) throw new RoomError("WRONG_PHASE");
        if (command.type !== "SET_READY" && !isHost) throw new RoomError("HOST_REQUIRED", 403);
        await this.changeLobby(client, access, command);
        await this.bumpSequence(client, room.room_id);
        return 0;
      }
      default: {
        if (!match) throw new RoomError("WRONG_PHASE");
        if (command.type === "ABANDON" && !isHost) throw new RoomError("HOST_REQUIRED", 403);
        const actor = command.type === "ABANDON" ? null : seat.seat_id;
        const rng = rngFor(match.rng_secret, `revision:${match.state.revision}`);
        const result = applyCommand(match.state, actor, command, rng);
        if (!result.ok) throw new RoomError(result.code);
        await this.writeCommit(client, room, seats, match, match.rng_secret, result);
        return result.state.revision;
      }
    }
  }

  private async changeLobby(client: PoolClient, { room, seats, seat }: RoomAccess, command: Extract<CommandEnvelope["command"], {
    type: "SET_READY" | "ADD_BOT" | "REMOVE_BOT" | "SET_TIMER";
  }>): Promise<void> {
    switch (command.type) {
      case "SET_READY":
        await client.query("UPDATE seats SET ready = $2 WHERE seat_id = $1", [seat.seat_id, command.ready]);
        break;
      case "ADD_BOT": {
        if (!this.playtest) throw new RoomError("PLAYTEST_REQUIRED", 403);
        if (seats.length >= this.definition.ruleset.players.max) throw new RoomError("ROOM_FULL");
        const position = (seats.at(-1)?.position ?? -1) + 1;
        await client.query("INSERT INTO seats (seat_id, room_id, name, avatar_id, ready, position) VALUES ($1,$2,$3,'bot',TRUE,$4)",
          [randomUUID(), room.room_id, `Бот ${position + 1}`, position]);
        break;
      }
      case "REMOVE_BOT": {
        const bot = seats.find((candidate) => candidate.user_id === null && candidate.seat_id === command.seatId);
        if (!bot) throw new RoomError("INVALID_TARGET");
        await client.query("DELETE FROM seats WHERE seat_id = $1", [bot.seat_id]);
        break;
      }
      case "SET_TIMER":
        await client.query("UPDATE rooms SET turn_timeout_seconds = $2 WHERE room_id = $1", [room.room_id, command.seconds]);
        break;
    }
  }

  private async writeCommit(client: PoolClient, room: Room, seats: Seat[], previous: StoredMatch | null, secret: Buffer, result: Extract<CommitResult, { ok: true }>) {
    const { state, events } = result;
    const { deadline, automation } = schedule(state, previous, seats, room.turn_timeout_seconds);
    await client.query(`
      INSERT INTO matches (match_id, room_id, ruleset_id, profile_version, profile_digest, rng_secret, revision, state, deadline_at, automation_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (match_id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state,
        deadline_at = EXCLUDED.deadline_at, automation_at = EXCLUDED.automation_at
    `, [state.matchId, room.room_id, state.definition.ruleset.id, state.definition.ruleset.schemaVersion, state.definition.digest,
      secret, state.revision, state, deadline, automation]);
    const expiresAt = ["MATCH_FINISHED", "ABANDONED"].includes(state.phase) ? new Date(Date.now() + ROOM_FINISHED_MS) : null;
    await client.query("UPDATE rooms SET current_match_id = $2, sequence = sequence + $3, expires_at = $4 WHERE room_id = $1",
      [room.room_id, state.matchId, Math.max(1, events.length), expiresAt]);

    if (events.length > 0) {
      const publicEvents = events.map((event, index) => ({
        sequence: room.sequence + index + 1, actor_seat_id: event.actorSeatId,
        type: event.type, public_data: journalData(event),
      }));
      await client.query(`
        INSERT INTO journal_events (room_id, sequence, match_id, actor_seat_id, type, revision, public_data)
        SELECT $1, sequence, $2, actor_seat_id, type, $3, public_data
        FROM jsonb_to_recordset($4) AS e(sequence int, actor_seat_id uuid, type text, public_data jsonb)
      `, [room.room_id, state.matchId, state.revision, JSON.stringify(publicEvents)]);
    }
    const rewards = state.rewards.slice(previous?.state.rewards.length ?? 0);
    if (rewards.length > 0) {
      await client.query(`
        INSERT INTO reward_ledger (match_id, round_no, seat_id, points)
        SELECT $1, "roundNo", "seatId", points
        FROM jsonb_to_recordset($2) AS r("roundNo" int, "seatId" uuid, points int)
      `, [state.matchId, JSON.stringify(rewards)]);
    }
  }

  private reject(commandId: string, code: string, revision?: number): CommandAck {
    return { type: "ACK", commandId, ok: false, code, revision };
  }

  private async room(client: PoolClient, roomId: string, mode: "SHARE" | "UPDATE" = "UPDATE"): Promise<Room> {
    const result = await client.query<Room>(`SELECT * FROM rooms WHERE room_id = $1 AND (expires_at IS NULL OR expires_at > now()) FOR ${mode}`, [roomId]);
    const room = result.rows[0];
    if (!room) throw new RoomError("ROOM_NOT_FOUND", 404);
    return room;
  }

  private async seats(client: PoolClient, roomId: string): Promise<Seat[]> {
    return (await client.query<Seat>("SELECT * FROM seats WHERE room_id = $1 ORDER BY position", [roomId])).rows;
  }

  private async access(client: PoolClient, roomId: string, userId: string, mode: "SHARE" | "UPDATE" = "UPDATE"): Promise<RoomAccess> {
    const room = await this.room(client, roomId, mode);
    const seats = await this.seats(client, roomId);
    const seat = seats.find((candidate) => candidate.user_id === userId);
    if (!seat) throw new RoomError("NOT_MEMBER", 403);
    return { room, seats, seat };
  }

  private async match(client: PoolClient, matchId: string | null): Promise<StoredMatch | null> {
    if (!matchId) return null;
    const { rows } = await client.query<StoredMatch>("SELECT match_id, state, rng_secret, deadline_at, automation_at FROM matches WHERE match_id = $1", [matchId]);
    if (!rows[0]) throw new Error("Current room match is missing");
    return rows[0];
  }

  private async bumpSequence(client: PoolClient, roomId: string): Promise<number> {
    const result = await client.query<{ sequence: number }>("UPDATE rooms SET sequence = sequence + 1 WHERE room_id = $1 RETURNING sequence", [roomId]);
    return result.rows[0].sequence;
  }
}
