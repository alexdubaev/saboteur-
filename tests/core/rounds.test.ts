import { expect, test } from "vitest";
import { createDefinition, loadActiveDefinition } from "../../packages/config/src/index.js";
import { applyCommand, assertInvariants, legalMoves, newMatch, playerView, publicView, startRound } from "../../packages/game-core/src/index.js";
import type { Command, MatchState, Rng } from "../../packages/game-core/src/index.js";
import { committed, fixedRng, give, play, ready, seats } from "./helpers.js";

test("R14: a closed discard is safe, the last stock card is drawn once, and empty seats are skipped", async () => {
  const { catalog, ruleset } = await loadActiveDefinition();
  const definition = createDefinition(catalog, {
    ...ruleset,
    players: { min: 3, max: 3 },
    handSizeByPlayers: { 3: 1 },
    traitorCountByPlayers: { 3: 1 },
    deck: { tunnelCopies: 4, actionCopies: 0, total: 4, copies: { "tunnel-straight-ew": 4 } },
  });
  let state = ready(definition);
  const { instanceId, typeId } = state.seats[0].hand[0];
  const result = applyCommand(state, "first", { type: "DISCARD", instanceId }, fixedRng);
  state = committed(result);
  if (!result.ok) throw new Error("Discard was rejected");
  expect(result.events).toEqual([{ type: "DISCARD", actorSeatId: "first" }]);
  expect(JSON.stringify(playerView(state, "second"))).not.toContain(instanceId);
  expect(state.discard).toContainEqual({ instanceId, typeId });
  expect(state.deck).toHaveLength(0);
  expect(state.seats[0].hand).toHaveLength(1);
  // The test fixture moves the next seat's last card to the existing discard pile.
  state.discard.push(state.seats[2].hand.pop()!);
  state = play(state, { type: "DISCARD", instanceId: state.seats[1].hand[0].instanceId });
  expect(state.turnSeatId).toBe("first");
  expect(state.turnNumber).toBe(2);
  state = play(state, { type: "DISCARD", instanceId: state.seats[0].hand[0].instanceId });
  expect(state.outcome).toMatchObject({ winner: "traitors", reason: "exhaustion", connectedOre: 0 });
  expect(state.discard).toHaveLength(4);
  expect(state.seats.map(seat => seat.roundScore)).toEqual([0, 0, 3]);
});

test("R02/R16/R18: resets round data, rotates the starter, accumulates scores, reveals a tie and supports a clean rematch", async () => {
  const { catalog, ruleset } = await loadActiveDefinition();
  const definition = createDefinition(catalog, {
    ...ruleset,
    turn: { ...ruleset.turn, maxTurnsFormula: { perPlayer: 0, constant: 1 } },
  });
  let state = ready(definition, "match-one");
  const issuances = new Set<string>();
  const rolesByRound: Rng[] = [
    () => 0.75,
    (() => {
      const roll = [0.75, 0.25];
      return () => roll.shift() ?? 0.25;
    })(),
    fixedRng,
  ];
  for (let round = 0; round < 3; round++) {
    expect(state.roundNo).toBe(round + 1);
    expect(state.turnSeatId).toBe(seats[round]);
    expect(state.seats.every(seat => seat.scoutResults.length === 0 && seat.roundScore === 0 && !seat.roleAcknowledged)).toBe(true);
    for (const card of [...state.deck, ...state.seats.flatMap(seat => seat.hand)]) {
      expect(issuances.has(card.instanceId)).toBe(false);
      issuances.add(card.instanceId);
    }
    state = play(state, { type: "PLAY_SCOUT", instanceId: give(state, "action-scout"), goalSlotId: "g1" });
    expect(state.phase).toBe("ROUND_SUMMARY");
    expect(publicView(state).seats.every(seat => !!seat.role && !("score" in seat))).toBe(true);
    expect(publicView(state).finalScores).toBeUndefined();
    for (const seatId of seats) state = committed(applyCommand(state, seatId, { type: "ACK_SUMMARY" }, rolesByRound[round]));
    if (round < 2) {
      expect(state.phase).toBe("ROLE_REVEAL");
      expect(state.discard).toEqual([]);
      expect(state.board).toEqual([]);
      expect(state.summaryAcknowledged).toEqual([]);
      expect(publicView(state).seats.every(seat => !("role" in seat))).toBe(true);
      state = committed(applyCommand(state, null, { type: "EXPIRE_ROLE_REVEAL" }, fixedRng));
    }
  }
  assertInvariants(state);
  expect(state.phase).toBe("MATCH_FINISHED");
  expect(publicView(state).finalScores).toEqual(seats.map(seatId => ({ seatId, score: 3 })));
  expect(publicView(state).winnerSeatIds).toEqual(seats);
  const replay = ready(definition, "match-two");
  expect(publicView(replay).matchId).toBe("match-two");
  expect(replay.seats.every(seat => seat.score === 0)).toBe(true);
  expect(replay.deck.every(card => !issuances.has(card.instanceId))).toBe(true);
});

test("R14/R17: illegal commands preserve a stored snapshot and never consume RNG", async () => {
  const definition = await loadActiveDefinition();
  let samples = 0;
  const rejectedRng = () => {
    samples++;
    return 0.5;
  };
  const started = committed(startRound(newMatch(definition, { matchId: "rejections", seatIds: seats }, fixedRng), fixedRng));
  const acknowledged = committed(applyCommand(started, "first", { type: "ACK_ROLE" }, fixedRng));
  expect(applyCommand(acknowledged, "first", { type: "ACK_ROLE" }, rejectedRng)).toEqual({ ok: false, code: "ALREADY_ACKNOWLEDGED" });
  expect(applyCommand(acknowledged, "second", { type: "EXPIRE_ROLE_REVEAL" }, rejectedRng)).toEqual({ ok: false, code: "INVALID_COMMAND" });
  const resumed: MatchState = JSON.parse(JSON.stringify(acknowledged));
  const state = committed(applyCommand(resumed, null, { type: "EXPIRE_ROLE_REVEAL" }, rejectedRng));
  const activeSeat = state.turnSeatId!;
  const instanceId = give(state, "tunnel-straight-ew");
  const unchanged = structuredClone(state);
  const illegal: Array<[string | null, Command, string]> = [
    ["unknown", { type: "ACK_SUMMARY" }, "NOT_MEMBER"],
    ["second", { type: "DISCARD", instanceId }, "NOT_YOUR_TURN"],
    [activeSeat, { type: "DISCARD", instanceId: state.seats[1].hand[0].instanceId }, "CARD_NOT_IN_HAND"],
    [activeSeat, { type: "ACK_SUMMARY" }, "WRONG_PHASE"],
    [activeSeat, { type: "PLAY_TUNNEL", instanceId, x: 1, y: 1, rotation: 0 }, "ILLEGAL_PLACEMENT"],
    [activeSeat, { type: "PLAY_TUNNEL", instanceId, x: 129, y: 0, rotation: 0 }, "ILLEGAL_PLACEMENT"],
    [activeSeat, { type: "PLAY_TUNNEL", instanceId, x: 1, y: 0, rotation: 90 } as unknown as Command, "INVALID_COMMAND"],
  ];
  for (const [seatId, command, code] of illegal) {
    expect(applyCommand(state, seatId, command, rejectedRng)).toEqual({ ok: false, code });
  }
  expect(state).toEqual(unchanged);
  expect(samples).toBe(0);
  expect(legalMoves(state, "second")).toEqual([]);
  expect(() => assertInvariants({ ...state, deck: [...state.deck, state.deck[0]] })).toThrow(/card instance conservation/);
  const abandoned = committed(applyCommand(state, null, { type: "ABANDON" }, rejectedRng));
  expect(abandoned.phase).toBe("ABANDONED");
  expect(abandoned.turnSeatId).toBeNull();
  expect(publicView(abandoned).seats.every(seat => !("role" in seat))).toBe(true);
  assertInvariants(abandoned);
});

test("R18: a pinned alternate profile handles a different deck, round count, goal count and required ore", async () => {
  const { catalog, ruleset } = await loadActiveDefinition();
  const alternate = createDefinition(catalog, {
    ...ruleset,
    id: "one-vein-fixture",
    players: { min: 3, max: 3 },
    rounds: 1,
    handSizeByPlayers: { 3: 1 },
    traitorCountByPlayers: { 3: 1 },
    deck: { tunnelCopies: 3, actionCopies: 0, total: 3, copies: { "tunnel-straight-ew": 3 } },
    board: { ...ruleset.board, goalSlots: [{ id: "sole-vein", x: 2, y: 0 }], goalContents: ["ore"] },
    victory: { ...ruleset.victory, prospectors: { ...ruleset.victory.prospectors, required: 1 } },
  });
  const input = JSON.parse(JSON.stringify(alternate));
  const state = ready(input);
  input.ruleset.rounds = 100;
  input.catalog.cards[0].labelRu = "Unsafe mutation";
  expect(state.definition.ruleset.rounds).toBe(1);
  expect(state.definition.catalog.cards[0].labelRu).toBe(alternate.catalog.cards[0].labelRu);
  expect(Object.isFrozen(state.definition.ruleset.board.goalSlots[0])).toBe(true);
  expect(state.deck).toEqual([]);
  expect(state.goals).toHaveLength(1);
  const ended = play(state, {
    type: "PLAY_TUNNEL", instanceId: state.seats[0].hand[0].instanceId, x: 1, y: 0, rotation: 0,
  });
  expect(ended.outcome?.winner).toBe("prospectors");
  const final = seats.reduce((acc, seatId) => committed(applyCommand(acc, seatId, { type: "ACK_SUMMARY" }, fixedRng)), ended);
  expect(final.phase).toBe("MATCH_FINISHED");
  const reversed = Object.fromEntries(Object.entries(alternate.ruleset).reverse());
  expect(createDefinition(catalog, reversed).digest).toBe(alternate.digest);
  expect(() => ready({ ...alternate, ruleset: { ...alternate.ruleset, rounds: 2 } })).toThrow(/digest mismatch/);
});
