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

test.each([
  { botCount: 2, handCount: 6, deckCount: 49 },
  { botCount: 9, handCount: 4, deckCount: 27 },
])("one human and $botCount bots can complete all three rounds without a server and replay", async ({ botCount, handCount, deckCount }) => {
  const match = new SoloMatch("  Старатель  ", await loadActiveDefinition(), () => 0.18, botCount);
  const initial = match.snapshot();
  expect(new Set(initial.room.seats.map(({ seatId }) => seatId)).size).toBe(botCount + 1);
  expect(initial.room.seats.map(({ name, bot }) => [name, bot])).toEqual([
    ["Старатель", false], ...Array.from({ length: botCount }, (_, index) => [`Бот ${index + 2}`, true]),
  ]);
  expect(initial.match).toMatchObject({ phase: "ROLE_REVEAL", requiredOre: 1, maxTurns: null, deckCount });
  expect(initial.match.self.hand).toHaveLength(handCount);
  expect(initial.match.seats.every((seat) => seat.role === undefined)).toBe(true);
  expect(initial.match.board.filter((tile) => tile.kind === "goal").every((tile) => tile.assetId === "goal-hidden")).toBe(true);
  expect(() => match.command({ type: "REPLAY" })).toThrow("WRONG_PHASE");
  expect(match.snapshot().sequence).toBe(initial.sequence);

  const rounds = new Set<number>();
  let attributedTunnel = false;
  for (let index = 0; index < 275; index++) {
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
  expect(replay.room.seats).toEqual(initial.room.seats);
});

test("rejects a bot count outside the ruleset before starting a solo match", async () => {
  const definition = await loadActiveDefinition();
  for (const count of [1, 10, 2.5]) {
    expect(() => new SoloMatch("Старатель", definition, () => 0.18, count)).toThrow(RangeError);
  }
});
