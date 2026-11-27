import { legalMoves } from "./moves.js";
import type { MatchState, PlayerView, PublicBoardTile, PublicView, Tool } from "./types.js";

export function publicView(state: MatchState): PublicView {
  const rules = state.definition.ruleset;
  const summary = state.outcome !== null;
  const { origin } = rules.board;
  const board: PublicBoardTile[] = [];
  if (state.roundNo > 0) {
    board.push({ kind: "origin", x: origin.x, y: origin.y, rotation: 0, assetId: origin.assetId });
    for (const { x, y, rotation, typeId } of state.board) {
      board.push({ kind: "tunnel", x, y, rotation, assetId: typeId });
    }
    for (const goal of state.goals) {
      const revealed = goal.revealed || summary;
      board.push({
        kind: "goal", x: goal.x, y: goal.y, rotation: 0, goalSlotId: goal.goalSlotId,
        assetId: revealed ? goal.assetId : rules.board.goalAssets.hidden,
        revealed, reachable: goal.reachable,
      });
    }
  }
  const snapshot: PublicView = {
    matchId: state.matchId,
    revision: state.revision,
    phase: state.phase,
    roundNo: state.roundNo,
    rounds: rules.rounds,
    turnSeatId: state.turnSeatId,
    turnNumber: state.turnNumber,
    maxTurns: state.maxTurns,
    requiredOre: rules.victory.prospectors.required,
    deckCount: state.deck.length,
    seats: state.seats.map(({ seatId, hand, brokenTools, role }) => ({
      seatId, handCount: hand.length, brokenTools: Object.keys(brokenTools) as Tool[],
      ...(summary && role ? { role } : {}),
    })),
    board,
    outcome: state.outcome ? { ...state.outcome } : null,
    summaryAcknowledged: [...state.summaryAcknowledged],
  };
  if (state.phase === "MATCH_FINISHED") {
    const finalScores = state.seats.map(({ seatId, score }) => ({ seatId, score }));
    const best = Math.max(...finalScores.map(seat => seat.score));
    const allowsTraitorlessRounds = (rules.traitorlessChancePercentByPlayers?.[String(state.seats.length)] ?? 0) > 0;
    snapshot.finalScores = finalScores;
    snapshot.winnerSeatIds = best === 0 && allowsTraitorlessRounds
      ? [] : finalScores.filter(seat => seat.score === best).map(seat => seat.seatId);
  }
  return snapshot;
}

export function playerView(state: MatchState, seatId: string): PlayerView {
  const seat = state.seats.find(seat => seat.seatId === seatId);
  if (!seat) throw new Error("NOT_MEMBER");
  return {
    ...publicView(state),
    self: {
      seatId,
      role: seat.role,
      hand: seat.hand.map(({ instanceId, typeId }) => ({ instanceId, typeId, assetId: typeId })),
      scoutResults: seat.scoutResults.map(({ goalSlotId, assetId, content }) => ({ goalSlotId, assetId, content })),
      score: seat.score,
      roundScore: seat.roundScore,
      roleAcknowledged: seat.roleAcknowledged,
    },
    moves: legalMoves(state, seatId),
  };
}
