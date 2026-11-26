import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { chooseBotMove } from "../../bots/src/index.js";
import { loadActiveDefinition } from "../../config/src/index.js";
import { applyCommand, assertInvariants, newMatch, playerView, publicView, startRound } from "./index.js";
import type { CommitResult, Definition, MatchState, Rng } from "./index.js";

function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
}

function committed(result: CommitResult): MatchState {
  if (!result.ok) throw new Error("Simulation command rejected: " + result.code);
  assertInvariants(result.state);
  return result.state;
}

function playMatch(definition: Definition, seats: number, seed: number) {
  const seatIds = Array.from({ length: seats }, (_, index) => "seat-" + (index + 1));
  const rng = seededRng(seed);
  const botRng = seededRng(seed ^ 0x9e3779b9);
  const matchId = "simulation-" + seats + "-" + seed;
  let state = committed(startRound(newMatch(definition, { matchId, seatIds }, rng), rng));
  const roundWins = { prospectors: 0, traitors: 0 };
  const maxCommits = definition.ruleset.rounds * (state.maxTurns + 2 * seats) + 1;
  let turns = 0;
  for (let index = 0; index < maxCommits; index++) {
    if (state.phase === "MATCH_FINISHED") {
      return { roundWins, tied: publicView(state).winnerSeatIds!.length > 1, turns };
    }
    let actor: string | null | undefined;
    if (state.phase === "ROLE_REVEAL") {
      actor = state.seats.find(seat => !seat.roleAcknowledged)?.seatId;
    } else if (state.phase === "TURN") {
      actor = state.turnSeatId;
    } else if (state.phase === "ROUND_SUMMARY") {
      actor = seatIds.find(seatId => !state.summaryAcknowledged.includes(seatId));
    }
    if (!actor) throw new Error("No acting seat during " + state.phase);
    const move = chooseBotMove(playerView(state, actor), botRng);
    if (!move) throw new Error("Bot has no legal move during " + state.phase);
    const previousPhase = state.phase;
    state = committed(applyCommand(state, actor, move, rng));
    if (previousPhase === "TURN") {
      turns++;
      if (state.outcome) roundWins[state.outcome.winner]++;
    }
  }
  throw new Error("Match exceeded configured turn and acknowledgement bounds");
}

function readInteger(value: string, label: string, min: number, max: number): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(result) || result < min || result > max) {
    throw new Error("Invalid " + label);
  }
  return result;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "20261127" },
      "matches-per-size": { type: "string", default: "100" },
    },
  });
  const baseSeed = readInteger(values.seed, "seed", 0, 2 ** 32 - 1);
  const sample = readInteger(values["matches-per-size"], "matches per size", 1, 100_000);
  const definition = await loadActiveDefinition();
  const totalStart = performance.now();
  const results = [];
  for (let seats = definition.ruleset.players.min; seats <= definition.ruleset.players.max; seats++) {
    const started = performance.now();
    const seedAt = (index: number) => (baseSeed + seats * 100_000 + index) >>> 0;
    const roundWins = { prospectors: 0, traitors: 0 };
    let tiedMatches = 0;
    let turns = 0;
    for (let index = 0; index < sample; index++) {
      const seed = seedAt(index);
      try {
        const result = playMatch(definition, seats, seed);
        roundWins.prospectors += result.roundWins.prospectors;
        roundWins.traitors += result.roundWins.traitors;
        turns += result.turns;
        if (result.tied) tiedMatches++;
      } catch (error) {
        throw new Error("Simulation failed for " + seats + " seats and seed " + seed, { cause: error });
      }
    }
    const totalRounds = roundWins.prospectors + roundWins.traitors;
    results.push({
      seats, completedMatches: sample, firstSeed: seedAt(0), lastSeed: seedAt(sample - 1),
      roundWins, prospectorWinRate: roundWins.prospectors / totalRounds,
      tiedMatches, averageTurnsPerRound: turns / totalRounds, elapsedMs: Math.round(performance.now() - started),
    });
  }
  process.stdout.write(JSON.stringify({
    ruleset: definition.ruleset.id, digest: definition.digest, baseSeed,
    seedFormula: "(baseSeed + seats * 100000 + matchIndex) mod 2^32",
    completedMatches: sample * results.length, invariantViolations: 0,
    elapsedMs: Math.round(performance.now() - totalStart), results,
  }, null, 2) + "\n");
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
