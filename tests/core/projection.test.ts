import { expect, test } from "vitest";
import { loadActiveDefinition } from "../../packages/config/src/index.js";
import { newMatch, playerView, publicView, startRound } from "../../packages/game-core/src/index.js";
import { committed } from "./helpers.js";

test("R13/R17: role reveal projects only the viewer's private state", async () => {
  const state = committed(startRound(newMatch(await loadActiveDefinition(), {
    matchId: "privacy", seatIds: ["first", "second", "third"],
  }, () => 0.25), () => 0.25));
  const forFirst = playerView(state, "first");
  const publicly = publicView(state);
  expect(forFirst.self.role).toBe(state.seats[0].role);
  expect(forFirst.self.hand.map(card => card.instanceId)).toEqual(state.seats[0].hand.map(card => card.instanceId));
  expect(forFirst.seats.every(seat => !("role" in seat) && !("score" in seat) && !("hand" in seat))).toBe(true);
  expect(publicly.board.filter(tile => tile.kind === "goal").map(tile => tile.assetId)).toEqual(Array(3).fill("goal-hidden"));
  expect(publicly).not.toHaveProperty("definition");
  expect(publicly).not.toHaveProperty("deck");
  expect(publicly).not.toHaveProperty("discard");
  expect(publicly).not.toHaveProperty("rewards");
  const projection = JSON.stringify(forFirst);
  expect(projection).not.toContain("goal-gold");
  expect(projection).not.toContain(state.seats[1].hand[0].instanceId);
  expect(projection).not.toContain(state.deck[0].instanceId);
  expect(() => playerView(state, "unknown")).toThrow("NOT_MEMBER");
});
