import { chooseBotMove } from "../../../packages/bots/src/index.js";
import { applyCommand, newMatch, playerView, startRound } from "../../../packages/game-core/src/index.js";
import { cellKey } from "../../../packages/game-core/src/graph.js";
import type { CommitResult, Definition, MatchEvent, MatchState, PlayerView, Rng } from "../../../packages/game-core/src/types.js";
import { guestSchema, type JournalEntry, type RoomSeat, type RoomSnapshot, type WireCommand } from "../../../packages/protocol/src/index.js";

declare const __SITES_SOLO_DEFINITION__: Definition | undefined;

type SoloSnapshot = RoomSnapshot & { match: PlayerView };

function botRange(definition: Definition) {
  const { min, max } = definition.ruleset.players;
  return { min: min - 1, max: max - 1 };
}

function sitesDefinition(): Definition {
  if (typeof __SITES_SOLO_DEFINITION__ === "undefined") throw new Error("Missing Sites solo definition");
  return __SITES_SOLO_DEFINITION__;
}

export function soloBotRange() {
  return botRange(sitesDefinition());
}

function randomFraction(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
}

function publicData(event: MatchEvent): JournalEntry["data"] {
  const { data } = event;
  if (!data) return;
  switch (event.type) {
    case "PLAY_TUNNEL": return { x: data.x ?? null, y: data.y ?? null, rotation: data.rotation ?? null };
    case "PLAY_COLLAPSE": return { x: data.x ?? null, y: data.y ?? null };
    case "PLAY_BREAK":
    case "PLAY_REPAIR": return { targetSeatId: data.targetSeatId ?? null, tool: data.tool ?? null };
    case "GOAL_REVEALED": return { goalSlotId: data.goalSlotId ?? null };
  }
}

function requireCommit(result: CommitResult): Extract<CommitResult, { ok: true }> {
  if (!result.ok) throw new Error(result.code);
  return result;
}

export class SoloMatch {
  readonly #seats: RoomSeat[];
  readonly #roomId = crypto.randomUUID();
  readonly #tunnelAuthors = new Map<string, string>();
  readonly #journal: JournalEntry[] = [];
  #sequence = 0;
  #match: MatchState;

  constructor(name: string, definition: Definition, private readonly rng: Rng, botCount = botRange(definition).min) {
    const { min, max } = botRange(definition);
    if (!Number.isInteger(botCount) || botCount < min || botCount > max) {
      throw new RangeError(`Expected ${min}–${max} bots`);
    }
    const guest = guestSchema.parse({ name });
    this.#seats = [
      { seatId: "solo", name: guest.name, avatarId: "guest", ready: true, present: true, bot: false },
      ...Array.from({ length: botCount }, (_, index) => {
        const number = index + 2;
        return { seatId: `bot-${number}`, name: `Бот ${number}`, avatarId: "bot", ready: true, present: true, bot: true };
      }),
    ];
    const started = this.#start(definition);
    this.#match = started.state;
    this.#record(started.events);
  }

  snapshot(): SoloSnapshot {
    const host = this.#seats[0].seatId;
    const match = playerView(this.#match, host);
    for (const tile of match.board) {
      if (tile.kind !== "tunnel") continue;
      const author = this.#tunnelAuthors.get(cellKey(tile.x, tile.y));
      if (author) tile.placedBySeatId = author;
    }
    return {
      room: {
        roomId: this.#roomId, code: "", hostSeatId: host, mySeatId: host,
        seats: this.#seats.map((seat) => ({ ...seat })), turnTimeoutSeconds: null, deadlineAt: null,
      },
      match, chat: [], journal: structuredClone(this.#journal), sequence: this.#sequence,
    };
  }

  command(move: WireCommand): void {
    switch (move.type) {
      case "REPLAY":
        if (this.#match.phase !== "MATCH_FINISHED" && this.#match.phase !== "ABANDONED") throw new Error("WRONG_PHASE");
        this.#commit(this.#start(this.#match.definition));
        return;
      case "SET_READY":
      case "ADD_BOT":
      case "REMOVE_BOT":
      case "REMOVE_PLAYER":
      case "SET_TIMER":
      case "START_MATCH":
        throw new Error("WRONG_PHASE");
      default:
        this.#commit(applyCommand(this.#match, move.type === "ABANDON" ? null : this.#seats[0].seatId, move, this.rng));
    }
  }

  hasBotTurn(): boolean {
    return this.#pendingBot() !== undefined;
  }

  botTurn(): boolean {
    const bot = this.#pendingBot();
    if (!bot) return false;
    const view = playerView(this.#match, bot.seatId);
    const move = chooseBotMove(view, this.rng, this.#match.definition);
    if (!move) return false;
    this.#commit(applyCommand(this.#match, bot.seatId, move, this.rng));
    return true;
  }

  #start(definition: Definition) {
    const match = newMatch(definition, { matchId: crypto.randomUUID(), seatIds: this.#seats.map(({ seatId }) => seatId) }, this.rng);
    return requireCommit(startRound(match, this.rng));
  }

  #commit(result: CommitResult): void {
    const updated = requireCommit(result);
    this.#match = updated.state;
    this.#record(updated.events);
  }

  #record(events: MatchEvent[]): void {
    const at = new Date().toISOString();
    for (const event of events) {
      const data = publicData(event);
      if (event.type === "ROUND_SETUP") this.#tunnelAuthors.clear();
      if (typeof data?.x === "number" && typeof data.y === "number") {
        const cell = cellKey(data.x, data.y);
        if (event.type === "PLAY_TUNNEL" && event.actorSeatId) this.#tunnelAuthors.set(cell, event.actorSeatId);
        if (event.type === "PLAY_COLLAPSE") this.#tunnelAuthors.delete(cell);
      }
      this.#journal.push({ type: event.type, actorSeatId: event.actorSeatId, sequence: ++this.#sequence,
        revision: this.#match.revision, at, ...(data && { data }) });
    }
    if (this.#journal.length > 100) this.#journal.splice(0, this.#journal.length - 100);
  }

  #pendingBot(): RoomSeat | undefined {
    const state = this.#match;
    return this.#seats.find(({ seatId, bot }) => {
      if (!bot) return false;
      if (state.phase === "ROLE_REVEAL") return state.seats.some((seat) => seat.seatId === seatId && !seat.roleAcknowledged);
      if (state.phase === "TURN") return state.turnSeatId === seatId;
      if (state.phase === "ROUND_SUMMARY") return !state.summaryAcknowledged.includes(seatId);
      return false;
    });
  }
}

export function createSoloMatch(name: string, botCount: number): SoloMatch {
  return new SoloMatch(name, sitesDefinition(), randomFraction, botCount);
}
