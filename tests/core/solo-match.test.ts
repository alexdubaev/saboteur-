import { createHash as nodeHash } from "node:crypto";
import { expect, test } from "vitest";
import { SoloMatch } from "../../apps/web/src/solo-match.js";
import { createHash as browserHash } from "../../apps/web/src/solo-sha256.js";
import { loadActiveDefinition } from "../../packages/config/src/index.js";

test("the Sites adapter uses the same SHA-256 for card IDs and rule definitions", async () => {
  const definition = await loadActiveDefinition();
  // Check the two padding boundaries, Unicode and a multi-block ruleset.
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "Путь к золоту", JSON.stringify(definition.ruleset)]) {
    expect(browserHash("sha256").update(text).digest("hex")).toBe(nodeHash("sha256").update(text).digest("hex"));
  }
});

test("one human and two bots can complete all three rounds without a server and replay", async () => {
  const match = new SoloMatch("  Старатель  ", await loadActiveDefinition(), () => 0.18);
  const initial = match.snapshot();
  expect(initial.room.seats.map(({ name, bot }) => [name, bot])).toEqual([
    ["Старатель", false], ["Бот 2", true], ["Бот 3", true],
  ]);
  expect(initial.match).toMatchObject({ phase: "ROLE_REVEAL", requiredOre: 1, maxTurns: null, deckCount: 49 });
  expect(initial.match.self.hand).toHaveLength(6);
  expect(initial.match.seats.every((seat) => seat.role === undefined)).toBe(true);
  expect(initial.match.board.filter((tile) => tile.kind === "goal").every((tile) => tile.assetId === "goal-hidden")).toBe(true);
  expect(() => match.command({ type: "REPLAY" })).toThrow("WRONG_PHASE");
  expect(match.snapshot().sequence).toBe(initial.sequence);

  const rounds = new Set<number>();
  let attributedTunnel = false;
  for (let index = 0; index < 225; index++) {
    const snapshot = match.snapshot();
    const { match: view } = snapshot;
    if (view.phase === "ROUND_SUMMARY") rounds.add(view.roundNo);
    if (view.phase === "MATCH_FINISHED") break;
    attributedTunnel ||= view.board.some((tile) => tile.kind === "tunnel" && !!tile.placedBySeatId);
    if (match.hasBotTurn()) {
      expect(match.botTurn()).toBe(true);
    } else if (view.phase === "ROLE_REVEAL") {
      match.command({ type: "ACK_ROLE" });
    } else if (view.phase === "ROUND_SUMMARY") {
      match.command({ type: "ACK_SUMMARY" });
    } else {
      const move = view.moves.find(({ type }) => type === "PLAY_TUNNEL") ?? view.moves[0];
      if (!move || !("instanceId" in move)) throw new Error("Missing player move");
      match.command(move);
    }
  }

  expect(rounds).toEqual(new Set([1, 2, 3]));
  expect(match.snapshot().match.phase).toBe("MATCH_FINISHED");
  expect(attributedTunnel).toBe(true);
  expect(match.botTurn()).toBe(false);
  match.command({ type: "REPLAY" });
  const replay = match.snapshot();
  expect(replay.match).toMatchObject({ phase: "ROLE_REVEAL", roundNo: 1, self: { score: 0 } });
  expect(replay.match.matchId).not.toBe(initial.match.matchId);
  expect(replay.room.roomId).toBe(initial.room.roomId);
});
