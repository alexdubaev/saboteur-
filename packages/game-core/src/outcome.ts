import type { MatchState, Outcome, Role, Ruleset } from "./types.js";

const prospectorPolicies = {
  "simultaneously-reachable-ore": (connectedOre: number, required: number) => connectedOre >= required,
} satisfies Record<Ruleset["victory"]["prospectors"]["type"], (connectedOre: number, required: number) => boolean>;

const traitorPolicies = {
  "turn-budget-or-exhaustion-without-goal": (state: MatchState): Outcome["reason"] | null => {
    if (state.maxTurns !== null && state.turnNumber >= state.maxTurns) return "turn-limit";
    if (state.deck.length === 0 && state.seats.every(seat => seat.hand.length === 0)) return "exhaustion";
    return null;
  },
} satisfies Record<Ruleset["victory"]["traitors"]["type"], (state: MatchState) => Outcome["reason"] | null>;

const rewardPolicies = {
  "numeric-ledger": (rules: Ruleset, outcome: Outcome, seatId: string, role: Role | null): number => {
    const { rewards } = rules;
    if (outcome.winner === "prospectors" && role === "prospector") {
      return rewards.prospectorWinEach + (outcome.finisherSeatId === seatId ? rewards.prospectorFinisherBonus : 0);
    }
    if (outcome.winner === "traitors" && role === "traitor") {
      const missing = Math.max(0, rules.victory.prospectors.required - outcome.connectedOre);
      return rewards.traitorWinFormula.base + missing * rewards.traitorWinFormula.missingConnectedOreMultiplier;
    }
    return 0;
  },
} satisfies Record<Ruleset["rewards"]["mode"], (rules: Ruleset, outcome: Outcome, seatId: string, role: Role | null) => number>;

export function evaluateOutcome(state: MatchState, finisherSeatId: string | null = null): Outcome | null {
  if (state.outcome) return { ...state.outcome };
  if (state.phase !== "TURN") return null;
  const connectedOre = state.goals.filter(goal => goal.content === "ore" && goal.reachable).length;
  const { prospectors, traitors } = state.definition.ruleset.victory;
  if (prospectorPolicies[prospectors.type](connectedOre, prospectors.required)) {
    return { winner: "prospectors", reason: "ore", connectedOre, finisherSeatId };
  }
  const reason = traitorPolicies[traitors.type](state);
  if (!reason) return null;
  const winner = state.seats.some(seat => seat.role === "traitor") ? "traitors" : "none";
  return { winner, reason, connectedOre, finisherSeatId };
}

export function settleRewards(state: MatchState): MatchState {
  if (!state.outcome) return state;
  const { outcome, roundNo } = state;
  const existing = state.rewards.filter(entry => entry.roundNo === roundNo);
  if (existing.length > 0) {
    const seatIds = new Set(existing.map(entry => entry.seatId));
    if (existing.length !== state.seats.length || state.seats.some(seat => !seatIds.has(seat.seatId))) {
      throw new Error("Incomplete round reward settlement");
    }
    return state;
  }
  if (state.phase !== "REWARD_SETTLEMENT" && state.phase !== "ROUND_RESOLVED") {
    throw new Error("Rewards requested outside round settlement");
  }
  const rules = state.definition.ruleset;
  const seats = state.seats.map(seat => {
    const roundScore = rewardPolicies[rules.rewards.mode](rules, outcome, seat.seatId, seat.role);
    return { ...seat, roundScore, score: seat.score + roundScore };
  });
  const rewards = [...state.rewards, ...seats.map(({ seatId, roundScore: points }) => ({ roundNo, seatId, points }))];
  return { ...state, seats, rewards };
}
