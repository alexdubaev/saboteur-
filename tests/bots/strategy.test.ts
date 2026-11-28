import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { chooseBotMove } from "../../packages/bots/src/index.js";
import { createDefinition, loadActiveDefinition } from "../../packages/config/src/index.js";
import type { PlayerView, PublicBoardTile } from "../../packages/game-core/src/types.js";

async function definition() {
  const { catalog } = await loadActiveDefinition();
  const prior = JSON.parse(await readFile(new URL("../../data/rulesets/playtest-expedition-v0.json", import.meta.url), "utf8"));
  return createDefinition(catalog, {
    ...prior,
    victory: { ...prior.victory, prospectors: { ...prior.victory.prospectors, required: 1 } },
  });
}

const origin: PublicBoardTile = { kind: "origin", x: 0, y: 0, rotation: 0, assetId: "board-start" };
const chamber: PublicBoardTile = { kind: "goal", x: 6, y: 0, rotation: 0, assetId: "goal-hidden", goalSlotId: "g2" };

function view(board: PublicBoardTile[], role: PlayerView["self"]["role"]): PlayerView & { requiredOre: number } {
  return {
    board, matchId: "test", revision: 4, phase: "TURN", roundNo: 1, rounds: 3,
    turnSeatId: "self", turnNumber: 0, maxTurns: 24, requiredOre: 1, deckCount: 46,
    seats: [{ seatId: "self", brokenTools: [], handCount: 2 }], summaryAcknowledged: [], outcome: null,
    self: {
      seatId: "self", role, roleAcknowledged: true, score: 0, roundScore: 0, scoutResults: [],
      hand: [
        { instanceId: "cap", typeId: "tunnel-dead-end-e", assetId: "tunnel-dead-end-e" },
        { instanceId: "straight", typeId: "tunnel-straight-ew", assetId: "tunnel-straight-ew" },
      ],
    },
    moves: [],
  };
}

test("a builder keeps the route open instead of capping the same legal square", async () => {
  const state = view([origin, chamber], "prospector");
  const straight = { type: "PLAY_TUNNEL", instanceId: "straight", x: 1, y: 0, rotation: 0 } as const;
  state.moves = [{ type: "PLAY_TUNNEL", instanceId: "cap", x: 1, y: 0, rotation: 180 }, straight];
  expect(chooseBotMove(state, () => 0, await definition())).toEqual(straight);
});

test("a traitor never connects a chamber already scouted as gold if a discard is legal", async () => {
  const approach: PublicBoardTile[] = [1, 2, 3, 4].map((x) => ({
    kind: "tunnel", x, y: 0, rotation: 0, assetId: "tunnel-straight-ew",
  }));
  const state = view([origin, ...approach, chamber], "traitor");
  state.self.scoutResults = [{ goalSlotId: "g2", assetId: "goal-gold", content: "ore" }];
  const discard = { type: "DISCARD", instanceId: "cap" } as const;
  state.moves = [{ type: "PLAY_TUNNEL", instanceId: "straight", x: 5, y: 0, rotation: 0 }, discard];
  expect(chooseBotMove(state, () => 0, await definition())).toEqual(discard);
});
