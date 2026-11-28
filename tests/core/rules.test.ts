import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createDefinition, loadActiveDefinition } from "../../packages/config/src/index.js";
import { applyCommand, legalMoves, playerView, publicView, settleRewards } from "../../packages/game-core/src/index.js";
import { committed, fixedRng, give, play, ready, tunnel } from "./helpers.js";

const raw = JSON.parse(readFileSync(new URL("../../data/rulesets/playtest-expedition-v0.json", import.meta.url), "utf8"));
async function nearGoals(turns: number) {
  const { catalog } = await loadActiveDefinition();
  return createDefinition(catalog, {
    ...raw,
    rounds: 1,
    turn: { ...raw.turn, maxTurnsFormula: { perPlayer: 0, constant: turns } },
    board: {
      ...raw.board,
      goalSlots: [{ id: "a", x: 2, y: 0 }, { id: "b", x: 2, y: -1 }, { id: "c", x: 6, y: 2 }],
      goalContents: ["barren", "ore", "ore"],
    },
  });
}

test("R04/R07/R08/R09/R12/R15: reserve chambers, rejoin two ores and complete on the last turn as a prospector", async () => {
  let state = ready(await nearGoals(4));
  const wrongPort = give(state, "tunnel-turn-nw");
  const before = legalMoves(state, state.turnSeatId!);
  expect(before).not.toContainEqual({ type: "PLAY_TUNNEL", instanceId: wrongPort, x: 1, y: 0, rotation: 0 });
  const differentFaces = structuredClone(state);
  [differentFaces.goals[0].content, differentFaces.goals[2].content] = [differentFaces.goals[2].content, differentFaces.goals[0].content];
  [differentFaces.goals[0].assetId, differentFaces.goals[2].assetId] = [differentFaces.goals[2].assetId, differentFaces.goals[0].assetId];
  expect(legalMoves(differentFaces, state.turnSeatId!)).toEqual(before);
  expect(applyCommand(state, state.turnSeatId!, {
    type: "PLAY_TUNNEL", instanceId: wrongPort, x: 2, y: 0, rotation: 0,
  }, fixedRng)).toEqual({ ok: false, code: "ILLEGAL_PLACEMENT" });

  state = tunnel(state, "tunnel-tee-new", 1, 0);
  expect(state.phase).toBe("TURN");
  expect(state.goals.find(goal => goal.goalSlotId === "a")).toMatchObject({ content: "ore", revealed: true, reachable: true });
  expect(state.goals.find(goal => goal.goalSlotId === "b")).toMatchObject({ content: "ore", revealed: false, reachable: false });
  const collapse = give(state, "action-collapse");
  for (const [x, y] of [[0, 0], [2, 0]]) {
    expect(applyCommand(state, state.turnSeatId!, {
      type: "PLAY_COLLAPSE", instanceId: collapse, x, y,
    }, fixedRng)).toEqual({ ok: false, code: "INVALID_TARGET" });
  }
  state = play(state, { type: "PLAY_COLLAPSE", instanceId: collapse, x: 1, y: 0 });
  expect(state.goals[0]).toMatchObject({ revealed: true, reachable: false });
  expect(publicView(state).board.find(tile => tile.goalSlotId === "a")).toMatchObject({ assetId: "goal-gold", revealed: true, reachable: false });
  state = tunnel(state, "tunnel-tee-new", 1, 0);
  const finisher = state.turnSeatId!;
  expect(playerView(state, finisher).self.role).toBe("prospector");
  state = tunnel(state, "tunnel-turn-nw", 1, -1, 180);
  expect(state.turnNumber).toBe(4);
  expect(state.phase).toBe("ROUND_SUMMARY");
  expect(state.outcome).toEqual({ winner: "prospectors", reason: "ore", connectedOre: 2, finisherSeatId: finisher });
  expect(state.seats.map(seat => seat.roundScore)).toEqual([3, 2, 0]);
  expect(settleRewards(state)).toBe(state);
  expect(publicView(state).finalScores).toBeUndefined();
  expect(playerView(state, finisher).self.roundScore).toBe(3);
});

test("R09/R15: a traitor may complete both ores, and a lone connected ore reduces the opposing reward", async () => {
  let state = ready(await nearGoals(2));
  [state.seats[1].role, state.seats[2].role] = [state.seats[2].role, state.seats[1].role];
  state = tunnel(state, "tunnel-tee-new", 1, 0);
  const finisher = state.turnSeatId!;
  const winner = tunnel(structuredClone(state), "tunnel-turn-nw", 1, -1, 180);
  expect(winner.outcome).toEqual({ winner: "prospectors", reason: "ore", connectedOre: 2, finisherSeatId: finisher });
  expect(winner.seats.map(seat => seat.roundScore)).toEqual([2, 0, 2]);

  state = play(state, { type: "DISCARD", instanceId: state.seats[1].hand[0].instanceId });
  expect(state.outcome).toEqual({ winner: "traitors", reason: "turn-limit", connectedOre: 1, finisherSeatId: finisher });
  expect(state.seats.map(seat => seat.roundScore)).toEqual([0, 2, 0]);
});

test("R06: a collapsed branch survives, blocks disconnected placement and reconnects through a bypass", async () => {
  let state = ready(await loadActiveDefinition());
  state = tunnel(state, "tunnel-straight-ew", 1, 0);
  state = tunnel(state, "tunnel-straight-ew", 2, 0);
  state = tunnel(state, "tunnel-tee-new", 3, 0);
  state = play(state, { type: "PLAY_COLLAPSE", instanceId: give(state, "action-collapse"), x: 1, y: 0 });
  expect(state.board.map(tile => tile.x)).toEqual([2, 3]);
  const disconnected = { type: "PLAY_TUNNEL", instanceId: give(state, "tunnel-straight-ew"), x: 4, y: 0, rotation: 0 } as const;
  expect(legalMoves(state, state.turnSeatId!)).not.toContainEqual(disconnected);
  expect(applyCommand(state, state.turnSeatId!, disconnected, fixedRng)).toEqual({ ok: false, code: "ILLEGAL_PLACEMENT" });

  state = tunnel(state, "tunnel-turn-nw", 0, -1, 180);
  state = tunnel(state, "tunnel-straight-ew", 1, -1);
  state = tunnel(state, "tunnel-straight-ew", 2, -1);
  state = tunnel(state, "tunnel-turn-ne", 3, -1, 180);
  state = tunnel(state, "tunnel-straight-ew", 4, 0);
  expect(state.board).toHaveLength(7);
});

test("R10/R11: reject self and duplicate break, allow one repair at a time and preserve discard", async () => {
  let state = ready(await loadActiveDefinition());
  const first = state.turnSeatId!;
  const target = "second";
  const breakPickaxe = give(state, "action-break-pickaxe");
  expect(applyCommand(state, first, {
    type: "PLAY_BREAK", instanceId: breakPickaxe, targetSeatId: first,
  }, fixedRng)).toEqual({ ok: false, code: "INVALID_TARGET" });
  state = play(state, { type: "PLAY_BREAK", instanceId: breakPickaxe, targetSeatId: target });

  const tunnelCard = give(state, "tunnel-straight-ew");
  expect(applyCommand(state, target, {
    type: "PLAY_TUNNEL", instanceId: tunnelCard, x: 1, y: 0, rotation: 0,
  }, fixedRng)).toEqual({ ok: false, code: "TOOL_BROKEN" });
  state = play(state, { type: "DISCARD", instanceId: tunnelCard });
  const breakLantern = give(state, "action-break-lantern");
  state = play(state, { type: "PLAY_BREAK", instanceId: breakLantern, targetSeatId: target });

  const duplicate = give(state, "action-break-pickaxe");
  expect(applyCommand(state, first, {
    type: "PLAY_BREAK", instanceId: duplicate, targetSeatId: target,
  }, fixedRng)).toEqual({ ok: false, code: "INVALID_TARGET" });
  const repairBoth = give(state, "action-repair-pickaxe-or-lantern");
  expect(applyCommand(state, first, {
    type: "PLAY_REPAIR", instanceId: repairBoth, targetSeatId: first, tool: "pickaxe",
  }, fixedRng)).toEqual({ ok: false, code: "INVALID_TARGET" });
  state = play(state, { type: "PLAY_REPAIR", instanceId: repairBoth, targetSeatId: target, tool: "pickaxe" });
  expect(publicView(state).seats[1].brokenTools).toEqual(["lantern"]);
  const repairLantern = give(state, "action-repair-lantern");
  state = play(state, { type: "PLAY_REPAIR", instanceId: repairLantern, targetSeatId: target, tool: "lantern" });
  expect(publicView(state).seats[1].brokenTools).toEqual([]);
  expect(state.discard.map(card => card.instanceId)).toEqual([tunnelCard, repairBoth, breakPickaxe, repairLantern, breakLantern]);
});

test("R13: repeat scouting reads a private face and publishes only the fact", async () => {
  let state = ready(await nearGoals(10));
  const first = state.turnSeatId!;
  const firstScout = give(state, "action-scout");
  const result = applyCommand(state, first, {
    type: "PLAY_SCOUT", instanceId: firstScout, goalSlotId: "a",
  }, fixedRng);
  state = committed(result);
  if (!result.ok) throw new Error("Scout was rejected");
  expect(result.events).toEqual([{ type: "PLAY_SCOUT", actorSeatId: first }]);
  expect(playerView(state, first).self.scoutResults).toEqual([{ goalSlotId: "a", assetId: "goal-gold", content: "ore" }]);
  expect(playerView(state, "second").self.scoutResults).toEqual([]);
  expect(JSON.stringify(playerView(state, "second"))).not.toContain("goal-gold");
  expect(publicView(state).board.find(tile => tile.goalSlotId === "a")).toMatchObject({ assetId: "goal-hidden", revealed: false });
  for (const index of [1, 2]) state = play(state, { type: "DISCARD", instanceId: state.seats[index].hand[0].instanceId });
  const command = { type: "PLAY_SCOUT", instanceId: give(state, "action-scout"), goalSlotId: "a" } as const;
  state = play(state, command);
  expect(playerView(state, first).self.scoutResults).toHaveLength(1);
});
