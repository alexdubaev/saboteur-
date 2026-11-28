import { expect, test } from "vitest";
import { loadActiveDefinition } from "../../packages/config/src/index.js";
import { applyCommand, assertInvariants, createDefinition, newMatch, publicView, startRound } from "../../packages/game-core/src/index.js";
import { committed, fixedRng, legacyDefinition, play, ready, seats, tunnel } from "./helpers.js";

function roundRng(traitorRoll: number, starterRoll = 0) {
  const rolls = [starterRoll, traitorRoll, 0.25, 0.25, 0.9, 0.25];
  return () => rolls.shift() ?? fixedRng();
}

test("a new match needs just one connected gold chamber across seven empty cells", async () => {
  const definition = await loadActiveDefinition();
  let state = ready(definition, "gold-trail-win", roundRng(0.2));
  expect(publicView(state)).toMatchObject({ requiredOre: 1, maxTurns: null });
  expect(publicView(state).board.filter(tile => tile.kind === "goal").map(({ x, y }) => [x, y]))
    .toEqual([[8, -2], [8, 0], [8, 2]]);
  expect(state.goals.find(goal => goal.content === "ore")).toMatchObject({ x: 8, y: 0 });
  for (let x = 1; x <= 6; x++) {
    state = tunnel(state, "tunnel-straight-ew", x, 0);
    expect(state.outcome).toBeNull();
  }
  state = tunnel(state, "tunnel-tee-new", 7, 0);
  expect(state.phase).toBe("ROUND_SUMMARY");
  expect(state.outcome).toMatchObject({ winner: "prospectors", reason: "ore", connectedOre: 1 });
  expect(state.seats.map(seat => seat.roundScore)).toEqual([3, 2, 0]);
});

test("the round runs beyond 24 moves and exhausts all 67 cards before settling", async () => {
  const definition = await loadActiveDefinition();
  for (const [roll, winner, points] of [[0.2, "traitors", [0, 0, 2]], [0.19, "none", [0, 0, 0]]] as const) {
    let state = ready(definition, "gold-trail-exhaust-" + winner, roundRng(roll));
    for (let turn = 1; turn <= 67; turn++) {
      const actor = state.seats.find(seat => seat.seatId === state.turnSeatId)!;
      state = play(state, { type: "DISCARD", instanceId: actor.hand[0].instanceId });
      if (turn < 67) expect(state.outcome).toBeNull();
    }
    expect(state.phase).toBe("ROUND_SUMMARY");
    expect(state.deck).toEqual([]);
    expect(state.seats.map(seat => seat.hand)).toEqual([[], [], []]);
    expect(state.outcome).toMatchObject({ winner, reason: "exhaustion", connectedOre: 0 });
    expect(state.seats.map(seat => seat.roundScore)).toEqual(points);

    if (winner === "none") {
      // A new draw on transition may produce a traitor despite a traitorless round.
      for (const seatId of seats) state = committed(applyCommand(state, seatId, { type: "ACK_SUMMARY" }, () => 0.2));
      expect(state).toMatchObject({ phase: "ROLE_REVEAL", roundNo: 2 });
      expect(state.seats.filter(seat => seat.role === "traitor")).toHaveLength(1);
      expect(publicView(state).seats.every(seat => !("role" in seat))).toBe(true);
      assertInvariants(state);
    }
  }
});

test("only three and four players have a one-in-five chance of no traitor", async () => {
  const definition = await loadActiveDefinition();
  for (const count of [3, 4, 5]) {
    const seatIds = Array.from({ length: count }, (_, index) => String(index));
    const traitorless = Array.from({ length: 100 }, (_, index) => {
      const rng = roundRng((index + 0.5) / 100);
      const state = committed(startRound(newMatch(definition, { matchId: "traitor-odds-" + count, seatIds }, rng), rng));
      assertInvariants(state);
      return state.seats.every(seat => seat.role === "prospector");
    }).filter(Boolean).length;
    expect(traitorless).toBe(count <= 4 ? 20 : 0);
  }
});

test("a finished match with zero scores has no winner, and a positive tie keeps both winners", async () => {
  const definition = await loadActiveDefinition();
  let scoreless = ready(definition, "gold-trail-no-winner", roundRng(0.19));
  for (let round = 1; round <= definition.ruleset.rounds; round++) {
    for (let turn = 1; turn <= 67; turn++) {
      const actor = scoreless.seats.find(seat => seat.seatId === scoreless.turnSeatId)!;
      scoreless = play(scoreless, { type: "DISCARD", instanceId: actor.hand[0].instanceId });
    }
    expect(scoreless.outcome?.winner).toBe("none");
    for (const seatId of seats) scoreless = committed(applyCommand(scoreless, seatId, { type: "ACK_SUMMARY" }, () => 0.19));
    if (round < definition.ruleset.rounds) {
      scoreless = committed(applyCommand(scoreless, null, { type: "EXPIRE_ROLE_REVEAL" }, fixedRng));
    }
  }
  expect(publicView(scoreless)).toMatchObject({
    phase: "MATCH_FINISHED",
    finalScores: seats.map(seatId => ({ seatId, score: 0 })),
    winnerSeatIds: [],
  });

  const singleRound = createDefinition(definition.catalog, { ...definition.ruleset, rounds: 1 });
  let tied = ready(singleRound, "gold-trail-positive-tie", roundRng(0.2, 0.9));
  for (let x = 1; x <= 6; x++) tied = tunnel(tied, "tunnel-straight-ew", x, 0);
  tied = tunnel(tied, "tunnel-tee-new", 7, 0);
  expect(tied.outcome?.finisherSeatId).toBe("third");
  for (const seatId of seats) tied = committed(applyCommand(tied, seatId, { type: "ACK_SUMMARY" }, fixedRng));
  expect(publicView(tied)).toMatchObject({
    phase: "MATCH_FINISHED",
    finalScores: seats.map((seatId, index) => ({ seatId, score: index < 2 ? 2 : 0 })),
    winnerSeatIds: ["first", "second"],
  });
});

test("a persisted Two Veins match retains its profile, limit and original seeded role draw", () => {
  const definition = legacyDefinition();
  const rolls = [0, 0.19, 0.25, 0.9, 0.25, 0.25, 0.25];
  const state = ready(definition, "saved-two-veins", () => rolls.shift() ?? fixedRng());
  const saved = JSON.parse(JSON.stringify(state));
  expect(publicView(saved)).toMatchObject({ requiredOre: 2, maxTurns: 24 });
  expect(saved.definition.digest).toBe("5af298441bf89a6df04a2043ebe99bcdfebea13a0fb26219825a528ee89789ef");
  expect(saved.seats.map((seat: { role: string }) => seat.role)).toEqual(["prospector", "prospector", "traitor"]);
  expect(saved.goals.map((goal: { content: string }) => goal.content)).toEqual(["ore", "ore", "barren"]);
  const next = play(saved, { type: "DISCARD", instanceId: saved.seats[0].hand[0].instanceId });
  expect(next.definition.digest).toBe(saved.definition.digest);
  expect(publicView(next)).toMatchObject({ requiredOre: 2, maxTurns: 24, turnNumber: 1 });
});
