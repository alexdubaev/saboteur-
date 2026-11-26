import { createHash } from "node:crypto";
import { findCard, inspectBoard, reachableGoal } from "./board.js";
import { commandSchema, cardMoveError } from "./moves.js";
import { evaluateOutcome, settleRewards } from "./outcome.js";
import { pinDefinition } from "./validation.js";
import type {
  CardCommand, CardInstance, Command, CommitResult, Definition, MatchEvent, MatchOptions, MatchState, Rng, Role, Ruleset, SeatState,
} from "./types.js";

type Success = Extract<CommitResult, { ok: true }>;

function randomIndex(rng: Rng, size: number): number {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("RNG must return a value in [0, 1)");
  return Math.floor(value * size);
}

function shuffle<T>(values: readonly T[], rng: Rng): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomIndex(rng, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

const firstSeatPolicies = {
  random: (state: MatchState, rng: Rng) => randomIndex(rng, state.seats.length),
} satisfies Record<Ruleset["startingSeat"]["firstRound"], (state: MatchState, rng: Rng) => number>;

const nextSeatPolicies = {
  "advance-previous-round-starter": (state: MatchState) => {
    const previous = state.seats.findIndex(seat => seat.seatId === state.roundStarterSeatId);
    if (previous < 0) throw new Error("Missing previous round starter");
    return (previous + 1) % state.seats.length;
  },
} satisfies Record<Ruleset["startingSeat"]["nextRound"], (state: MatchState) => number>;

function buildDeck(state: MatchState, rng: Rng): CardInstance[] {
  const salt = Array.from({ length: 4 }, () => randomIndex(rng, 2 ** 32));
  const cards: CardInstance[] = [];
  for (const typeId of Object.keys(state.definition.ruleset.deck.copies).sort()) {
    const copies = state.definition.ruleset.deck.copies[typeId];
    for (let index = 0; index < copies; index++) {
      const data = JSON.stringify([state.matchId, state.roundNo, salt, cards.length]);
      const instanceId = createHash("sha256").update(data).digest("hex").slice(0, 32);
      cards.push({ typeId, instanceId });
    }
  }
  return shuffle(cards, rng);
}

function emptySeat(seatId: string, score = 0): SeatState {
  return { seatId, role: null, hand: [], brokenTools: {}, scoutResults: [], score, roundScore: 0, roleAcknowledged: false };
}

export function newMatch(definition: Definition, { matchId, seatIds }: MatchOptions, rng: Rng): MatchState {
  const pinned = pinDefinition(definition);
  const { min, max } = pinned.ruleset.players;
  if (typeof rng !== "function") throw new Error("Missing RNG");
  if (typeof matchId !== "string" || matchId.length === 0) throw new Error("Missing match ID");
  if (seatIds.length < min || seatIds.length > max || new Set(seatIds).size !== seatIds.length ||
      seatIds.some(seatId => typeof seatId !== "string" || seatId.length === 0)) {
    throw new Error("Invalid match seats");
  }
  return {
    schemaVersion: 1, matchId, revision: 0, phase: "LOBBY", roundNo: 0, definition: pinned,
    seats: seatIds.map(seatId => emptySeat(seatId)), board: [], goals: [], deck: [], discard: [],
    roundStarterSeatId: null, turnSeatId: null, turnNumber: 0, maxTurns: 0,
    outcome: null, rewards: [], summaryAcknowledged: [],
  };
}

function beginCommit(state: MatchState): Success {
  const { definition, ...mutableState } = state;
  const next = { ...structuredClone(mutableState), definition: pinDefinition(definition), revision: state.revision + 1 };
  return { ok: true, state: next, events: [] };
}

function reviewGoals(state: MatchState, events: MatchEvent[], actorSeatId: string | null): void {
  const { reachable } = inspectBoard(state);
  for (const goal of state.goals) {
    goal.reachable = reachableGoal(reachable, goal.goalSlotId);
    if (goal.revealed || !goal.reachable) continue;
    goal.revealed = true;
    events.push({
      type: "GOAL_REVEALED", actorSeatId,
      data: { goalSlotId: goal.goalSlotId, assetId: goal.assetId, content: goal.content },
    });
  }
}

function setupRound(state: MatchState, events: MatchEvent[], rng: Rng): void {
  const rules = state.definition.ruleset;
  const count = state.seats.length;
  const starterIndex = state.roundNo === 0 ?
    firstSeatPolicies[rules.startingSeat.firstRound](state, rng) :
    nextSeatPolicies[rules.startingSeat.nextRound](state);
  state.phase = "ROUND_SETUP";
  state.roundNo++;
  events.push({ type: "ROUND_SETUP", actorSeatId: null, data: { roundNo: state.roundNo } });
  state.roundStarterSeatId = state.seats[starterIndex].seatId;
  state.turnSeatId = null;
  state.turnNumber = 0;
  state.maxTurns = rules.turn.maxTurnsFormula.perPlayer * count + rules.turn.maxTurnsFormula.constant;
  state.discard = [];
  state.board = [];
  state.outcome = null;
  state.summaryAcknowledged = [];

  const traitors = rules.traitorCountByPlayers[String(count)];
  const roles = shuffle(Array.from({ length: count }, (_, index): Role => index < traitors ? "traitor" : "prospector"), rng);
  const contents = shuffle(rules.board.goalContents, rng);
  const { barrenOptions, ore } = rules.board.goalAssets;
  state.goals = rules.board.goalSlots.map(({ x, y, id }, index) => {
    const content = contents[index];
    const assetId = content === "ore" ? ore : barrenOptions[randomIndex(rng, barrenOptions.length)];
    return { goalSlotId: id, content, assetId, x, y, revealed: false, reachable: false };
  });
  state.deck = buildDeck(state, rng);
  const handSize = rules.handSizeByPlayers[String(count)];
  state.seats = state.seats.map(({ seatId, score }, index) => ({
    ...emptySeat(seatId, score), role: roles[index], hand: state.deck.splice(0, handSize),
  }));
  state.phase = "ROLE_REVEAL";
  events.push({ type: "ROLE_REVEAL", actorSeatId: null });
  reviewGoals(state, events, null);
}

export function startRound(state: MatchState, rng: Rng): CommitResult {
  if (state.phase !== "LOBBY") return { ok: false, code: "WRONG_PHASE" };
  const result = beginCommit(state);
  setupRound(result.state, result.events, rng);
  return result;
}

function beginTurns(state: MatchState, events: MatchEvent[]): void {
  state.phase = "TURN";
  state.turnSeatId = state.roundStarterSeatId;
  events.push({ type: "TURN_STARTED", actorSeatId: null, data: { turnSeatId: state.turnSeatId, turnNumber: state.turnNumber } });
}

function advanceTurn(state: MatchState, actorIndex: number): void {
  for (let offset = 1; offset <= state.seats.length; offset++) {
    const next = state.seats[(actorIndex + offset) % state.seats.length];
    if (next.hand.length > 0) {
      state.turnSeatId = next.seatId;
      return;
    }
    if (state.deck.length > 0) throw new Error("Empty hand with nonempty deck");
  }
  throw new Error("No playable seat after nonterminal move");
}

function playCard(state: MatchState, actor: SeatState, command: CardCommand, instance: CardInstance): MatchEvent {
  const event: MatchEvent = { type: command.type, actorSeatId: actor.seatId };
  switch (command.type) {
    case "PLAY_TUNNEL": {
      const { x, y, rotation } = command;
      state.board.push({ ...instance, x, y, rotation });
      event.data = { x, y, rotation, assetId: instance.typeId };
      break;
    }
    case "PLAY_BREAK": {
      const card = findCard(state.definition.catalog, instance.typeId);
      if (card.kind !== "action" || card.effect !== "break") throw new Error("Invalid break state");
      const tool = card.tools[0];
      const target = state.seats.find(seat => seat.seatId === command.targetSeatId)!;
      target.brokenTools[tool] = instance;
      event.data = { tool, targetSeatId: target.seatId };
      break;
    }
    case "PLAY_REPAIR": {
      const { tool, targetSeatId } = command;
      const target = state.seats.find(seat => seat.seatId === targetSeatId)!;
      state.discard.push(instance, target.brokenTools[tool]!);
      delete target.brokenTools[tool];
      event.data = { tool, targetSeatId };
      break;
    }
    case "PLAY_COLLAPSE": {
      const { x, y } = command;
      const index = state.board.findIndex(tile => tile.x === x && tile.y === y);
      const [{ instanceId, typeId }] = state.board.splice(index, 1);
      state.discard.push(instance, { instanceId, typeId });
      event.data = { x, y };
      break;
    }
    case "PLAY_SCOUT": {
      const { goalSlotId, assetId, content } = state.goals.find(goal => goal.goalSlotId === command.goalSlotId)!;
      if (!actor.scoutResults.some(result => result.goalSlotId === goalSlotId)) {
        actor.scoutResults.push({ goalSlotId, assetId, content });
      }
      state.discard.push(instance);
      break;
    }
    case "DISCARD":
      state.discard.push(instance);
      break;
  }
  return event;
}

function handleCardMove(state: MatchState, actorIndex: number, command: CardCommand): CommitResult {
  const actor = state.seats[actorIndex];
  if (state.phase !== "TURN") return { ok: false, code: "WRONG_PHASE" };
  if (state.turnSeatId !== actor.seatId) return { ok: false, code: "NOT_YOUR_TURN" };
  const instanceIndex = actor.hand.findIndex(card => card.instanceId === command.instanceId);
  if (instanceIndex < 0) return { ok: false, code: "CARD_NOT_IN_HAND" };
  const error = cardMoveError(state, actor, command, actor.hand[instanceIndex]);
  if (error) return { ok: false, code: error };

  const result = beginCommit(state);
  const { state: next, events } = result;
  const nextActor = next.seats[actorIndex];
  const [instance] = nextActor.hand.splice(instanceIndex, 1);
  events.push(playCard(next, nextActor, command, instance));
  next.turnNumber++;
  if (command.type === "PLAY_TUNNEL" || command.type === "PLAY_COLLAPSE") reviewGoals(next, events, actor.seatId);

  const outcome = evaluateOutcome(next, actor.seatId);
  if (outcome) {
    next.outcome = outcome;
    next.turnSeatId = null;
    next.phase = "ROUND_RESOLVED";
    events.push({ type: "ROUND_RESOLVED", actorSeatId: actor.seatId, data: outcome });
    next.phase = "REWARD_SETTLEMENT";
    result.state = settleRewards(next);
    events.push({ type: "REWARD_SETTLEMENT", actorSeatId: null });
    result.state.phase = "ROUND_SUMMARY";
    events.push({ type: "ROUND_SUMMARY", actorSeatId: null });
  } else {
    const drawn = next.deck.shift();
    if (drawn) nextActor.hand.push(drawn);
    advanceTurn(next, actorIndex);
  }
  return result;
}

function acknowledgeRole(state: MatchState, actorIndex: number): CommitResult {
  if (state.phase !== "ROLE_REVEAL") return { ok: false, code: "WRONG_PHASE" };
  if (state.seats[actorIndex].roleAcknowledged) return { ok: false, code: "ALREADY_ACKNOWLEDGED" };
  const result = beginCommit(state);
  const actor = result.state.seats[actorIndex];
  actor.roleAcknowledged = true;
  result.events.push({ type: "ACK_ROLE", actorSeatId: actor.seatId });
  if (result.state.seats.every(seat => seat.roleAcknowledged)) beginTurns(result.state, result.events);
  return result;
}

function acknowledgeSummary(state: MatchState, seatId: string, rng: Rng): CommitResult {
  if (state.phase !== "ROUND_SUMMARY") return { ok: false, code: "WRONG_PHASE" };
  if (state.summaryAcknowledged.includes(seatId)) return { ok: false, code: "ALREADY_ACKNOWLEDGED" };
  const result = beginCommit(state);
  const { state: next, events } = result;
  next.summaryAcknowledged.push(seatId);
  events.push({ type: "ACK_SUMMARY", actorSeatId: seatId });
  if (next.summaryAcknowledged.length === next.seats.length) {
    if (next.roundNo < next.definition.ruleset.rounds) {
      setupRound(next, events, rng);
    } else {
      next.phase = "MATCH_FINISHED";
      events.push({ type: "MATCH_FINISHED", actorSeatId: null });
    }
  }
  return result;
}

export function applyCommand(state: MatchState, seatId: string | null, rawCommand: Command, rng: Rng): CommitResult {
  const parsed = commandSchema.safeParse(rawCommand);
  if (!parsed.success) return { ok: false, code: "INVALID_COMMAND" };
  const command = parsed.data;
  if (command.type === "ABANDON" || command.type === "EXPIRE_ROLE_REVEAL") {
    if (seatId !== null) return { ok: false, code: "INVALID_COMMAND" };
    if (command.type === "EXPIRE_ROLE_REVEAL" && state.phase !== "ROLE_REVEAL") return { ok: false, code: "WRONG_PHASE" };
    if (state.phase === "ABANDONED" || state.phase === "MATCH_FINISHED") return { ok: false, code: "WRONG_PHASE" };
    const result = beginCommit(state);
    result.events.push({ type: command.type, actorSeatId: null });
    if (command.type === "ABANDON") {
      result.state.phase = "ABANDONED";
      result.state.turnSeatId = null;
    } else {
      beginTurns(result.state, result.events);
    }
    return result;
  }

  const actorIndex = state.seats.findIndex(seat => seat.seatId === seatId);
  if (actorIndex < 0) return { ok: false, code: "NOT_MEMBER" };
  if (command.type === "ACK_ROLE") return acknowledgeRole(state, actorIndex);
  if (command.type === "ACK_SUMMARY") return acknowledgeSummary(state, state.seats[actorIndex].seatId, rng);
  return handleCardMove(state, actorIndex, command);
}
