import { findCard, inspectBoard, reachableGoal, withinBoard } from "./board.js";
import { beside, cellKey, componentAtPort, directions, ports } from "./graph.js";
import { pinDefinition } from "./validation.js";
import type { CardInstance, MatchState, Tool } from "./types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Invariant failed: " + message);
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

export function assertInvariants(state: MatchState): void {
  const { ruleset, catalog } = state.definition;
  const count = state.seats.length;
  const seatIds = new Set(state.seats.map(seat => seat.seatId));
  assert(state.schemaVersion === 1 && state.matchId.length > 0, "match identity");
  assert(Number.isSafeInteger(state.revision) && state.revision >= 0, "revision");
  assert(count >= ruleset.players.min && count <= ruleset.players.max && seatIds.size === count, "seat count and identity");
  assert(Number.isSafeInteger(state.roundNo) && state.roundNo >= 0 && state.roundNo <= ruleset.rounds, "round number");
  pinDefinition(state.definition);
  assert(unique(state.summaryAcknowledged) && state.summaryAcknowledged.every(seatId => seatIds.has(seatId)), "summary seats");
  if (state.roundNo === 0) {
    assert(state.phase === "LOBBY" || state.phase === "ABANDONED", "phase before first round");
    assert(state.board.length === 0 && state.goals.length === 0 && state.deck.length === 0 && state.discard.length === 0 &&
      state.rewards.length === 0 && state.seats.every(seat =>
        seat.role === null && seat.score === 0 && seat.hand.length === 0), "match starts empty");
    return;
  }
  assert(state.phase !== "LOBBY", "active phase");
  assert(state.roundStarterSeatId !== null && seatIds.has(state.roundStarterSeatId), "round starter");
  assert(state.maxTurns === ruleset.turn.maxTurnsFormula.perPlayer * count + ruleset.turn.maxTurnsFormula.constant, "turn budget");
  assert(Number.isSafeInteger(state.turnNumber) && state.turnNumber >= 0 && state.turnNumber <= state.maxTurns, "turn count");
  if (state.phase === "TURN") {
    assert(state.turnSeatId !== null && state.seats.some(seat => seat.seatId === state.turnSeatId && seat.hand.length > 0),
      "current seat needs a card");
    assert(state.outcome === null, "active round has no outcome");
  } else {
    assert(state.turnSeatId === null, "inactive turn");
  }
  if (state.phase === "ROLE_REVEAL" || state.phase === "TURN") {
    assert(state.deck.length === 0 || state.seats.every(seat => seat.hand.length > 0), "empty hand with cards to draw");
  }
  const traitors = state.seats.filter(seat => seat.role === "traitor").length;
  assert(traitors === ruleset.traitorCountByPlayers[String(count)] &&
    state.seats.filter(seat => seat.role === "prospector").length === count - traitors, "role distribution");

  const instances: CardInstance[] = [...state.deck, ...state.discard, ...state.board];
  for (const seat of state.seats) {
    instances.push(...seat.hand);
    for (const [tool, card] of Object.entries(seat.brokenTools)) {
      const type = findCard(catalog, card.typeId);
      assert(type.kind === "action" && type.effect === "break" && type.tools[0] === tool &&
        ruleset.tools.types.includes(tool as Tool), "tool status holds its original break card");
      instances.push(card);
    }
    assert(unique(seat.scoutResults.map(result => result.goalSlotId)), "one record per scouted goal");
    for (const result of seat.scoutResults) {
      assert(state.goals.some(goal => goal.goalSlotId === result.goalSlotId &&
        goal.assetId === result.assetId && goal.content === result.content), "scout content matches its goal");
    }
  }
  assert(instances.length === ruleset.deck.total && unique(instances.map(card => card.instanceId)), "card instance conservation");
  const copies = new Map<string, number>();
  for (const instance of instances) {
    assert(instance.instanceId.length > 0 && Object.hasOwn(ruleset.deck.copies, instance.typeId), "instance identity");
    copies.set(instance.typeId, (copies.get(instance.typeId) ?? 0) + 1);
  }
  assert(Object.entries(ruleset.deck.copies).every(([type, count]) => (copies.get(type) ?? 0) === count), "card type conservation");

  const board = inspectBoard(state);
  assert(board.cells.size === board.tiles.length, "one tile per position");
  assert(board.tiles.every(tile => withinBoard(tile, board.limit)), "board bounds");
  for (const tile of board.tiles) {
    for (const port of ports) {
      const { x, y } = beside(tile, port);
      const neighbor = board.cells.get(cellKey(x, y));
      if (!neighbor) continue;
      assert((componentAtPort(tile, port) >= 0) === (componentAtPort(neighbor, directions[port].opposite) >= 0),
        "all occupied neighbors match");
    }
  }
  for (const tile of state.board) {
    const type = findCard(catalog, tile.typeId);
    assert(type.kind === "tunnel" && type.allowedRotations.includes(tile.rotation), "tunnel orientation is permitted");
  }
  assert(state.goals.length === ruleset.board.goalSlots.length && unique(state.goals.map(goal => goal.goalSlotId)), "goal identities");
  assert(state.goals.map(goal => goal.content).sort().join(",") === [...ruleset.board.goalContents].sort().join(","), "goal contents");
  for (const goal of state.goals) {
    assert(ruleset.board.goalSlots.some(slot => slot.id === goal.goalSlotId && slot.x === goal.x && slot.y === goal.y), "goal location");
    assert(goal.content === "ore" ? goal.assetId === ruleset.board.goalAssets.ore :
      ruleset.board.goalAssets.barrenOptions.includes(goal.assetId), "goal art");
    assert(goal.reachable === reachableGoal(board.reachable, goal.goalSlotId) && (!goal.reachable || goal.revealed), "goal reachability");
  }

  if (state.phase === "ROUND_SUMMARY" || state.phase === "MATCH_FINISHED") assert(state.outcome !== null, "settled outcome");
  if (state.phase === "MATCH_FINISHED") {
    assert(state.roundNo === ruleset.rounds && state.summaryAcknowledged.length === count, "final summary");
  }
  const settledRounds = state.roundNo - (state.outcome ? 0 : 1);
  assert(state.rewards.length === settledRounds * count, "one reward per seat and completed round");
  for (const seat of state.seats) {
    const entries = state.rewards.filter(entry => entry.seatId === seat.seatId);
    assert(entries.length === settledRounds && unique(entries.map(entry => entry.roundNo)), "reward ledger identity");
    assert(entries.every(entry => Number.isSafeInteger(entry.roundNo) && entry.roundNo >= 1 && entry.roundNo <= settledRounds &&
      Number.isSafeInteger(entry.points) && entry.points >= 0), "reward ledger range");
    assert(seat.score === entries.reduce((total, entry) => total + entry.points, 0), "cumulative reward");
    assert(seat.roundScore === (entries.find(entry => entry.roundNo === state.roundNo)?.points ?? 0), "current reward");
  }
}
