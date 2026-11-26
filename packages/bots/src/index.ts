import type { Command, PlayerView, Rng } from "../../game-core/src/types.js";

export function chooseBotMove(view: PlayerView, rng: Rng): Command | undefined {
  const moves = view.moves;
  if (moves.length === 0) return undefined;
  if (view.phase !== "TURN") return moves[0];

  const goals = view.board.filter((tile) => tile.kind === "goal" && !tile.reachable);
  const traitor = view.self.role === "traitor";
  const scored = moves.map((move) => {
    switch (move.type) {
      case "PLAY_TUNNEL": {
        const distance = Math.min(20, ...goals.map((goal) => Math.abs(goal.x - move.x) + Math.abs(goal.y - move.y)));
        return { move, score: traitor ? 12 + distance : 40 - distance };
      }
      case "PLAY_BREAK": return { move, score: traitor ? 45 : 12 };
      case "PLAY_REPAIR": return { move, score: traitor ? 10 : move.targetSeatId === view.self.seatId ? 40 : 24 };
      case "PLAY_COLLAPSE": return { move, score: traitor ? 32 : 6 };
      case "PLAY_SCOUT": return { move, score: view.self.scoutResults.some((result) => result.goalSlotId === move.goalSlotId) ? 2 : 19 };
      default: return { move, score: 4 };
    }
  });
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore);
  return best[Math.floor(rng() * best.length)]?.move;
}
