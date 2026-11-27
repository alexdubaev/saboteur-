import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { applyCommand, assertInvariants, createDefinition, legalMoves, newMatch, startRound } from "../../packages/game-core/src/index.js";
import type { CardCommand, CommitResult, Definition, MatchState, Rng } from "../../packages/game-core/src/index.js";

export const fixedRng = () => 0.25;
export const seats = ["first", "second", "third"];

export function committed(result: CommitResult) {
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

export function legacyDefinition(): Definition {
  const catalog = JSON.parse(readFileSync(new URL("../../data/card-catalog-v2.json", import.meta.url), "utf8"));
  const ruleset = JSON.parse(readFileSync(new URL("../../data/rulesets/playtest-expedition-v0.json", import.meta.url), "utf8"));
  return createDefinition(catalog, ruleset);
}

export function ready(definition: Definition, matchId = "fixture", rng: Rng = fixedRng): MatchState {
  const started = committed(startRound(newMatch(definition, { matchId, seatIds: seats }, rng), rng));
  return committed(applyCommand(started, null, { type: "EXPIRE_ROLE_REVEAL" }, fixedRng));
}

// This swaps cards in a fixture without adding or removing catalog instances.
export function give(state: MatchState, typeId: string, seatId = state.turnSeatId!) {
  const actor = state.seats.find(seat => seat.seatId === seatId)!;
  const holding = actor.hand.find(instance => instance.typeId === typeId);
  if (holding) return holding.instanceId;
  const source = [state.deck, ...state.seats.filter(seat => seat !== actor).map(seat => seat.hand)]
    .find(hand => hand.some(instance => instance.typeId === typeId));
  if (!source || actor.hand.length === 0) throw new Error("Fixture does not have " + typeId);
  const index = source.findIndex(instance => instance.typeId === typeId);
  [actor.hand[0], source[index]] = [source[index], actor.hand[0]];
  return actor.hand[0].instanceId;
}

export function play(state: MatchState, command: CardCommand): MatchState {
  const actor = state.turnSeatId!;
  expect(legalMoves(state, actor)).toContainEqual(command);
  const next = committed(applyCommand(state, actor, command, fixedRng));
  expect(next.revision).toBe(state.revision + 1);
  assertInvariants(next);
  return next;
}

export function tunnel(state: MatchState, typeId: string, x: number, y: number, rotation: 0 | 180 = 0): MatchState {
  return play(state, { type: "PLAY_TUNNEL", instanceId: give(state, typeId), x, y, rotation });
}
