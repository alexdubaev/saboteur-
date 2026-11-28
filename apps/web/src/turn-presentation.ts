import { useEffect, useState } from "react";
import type { Position, PublicBoardTile, Tool } from "../../../packages/game-core/src/types.js";
import type { JournalEntry } from "../../../packages/protocol/src/index.js";
import type { BoardTurnEffects } from "./board.js";
import type { MatchSnapshot } from "./game.js";

export const goldFlipDelay = 560;

export type GoldFinale = {
  event: JournalEntry;
  actorSeatId: string | null;
  tunnel: PublicBoardTile;
  goal: PublicBoardTile;
};
export type ToolChange = {
  sequence: number;
  actorSeatId: string | null;
  targetSeatId: string;
  tool: Tool;
  broken: boolean;
};

function eventPosition(entry: JournalEntry): Position | undefined {
  const { x, y } = entry.data ?? {};
  if (typeof x === "number" && typeof y === "number") return { x, y };
}

function goalSlot(entry: JournalEntry): string[] {
  const id = entry.data?.goalSlotId;
  return entry.type === "GOAL_REVEALED" && typeof id === "string" ? [id] : [];
}

export function getGoldFinale(snapshot: MatchSnapshot, entries: readonly JournalEntry[]): GoldFinale | null {
  if (snapshot.match.outcome?.reason !== "ore") return null;
  const event = entries.findLast(({ type }) => type === "ROUND_RESOLVED");
  if (!event) return null;
  const batch = entries.filter(({ revision }) => revision === event.revision);
  const placed = batch.findLast(({ type }) => type === "PLAY_TUNNEL");
  const cell = placed && eventPosition(placed);
  if (!placed || !cell) return null;
  const tunnel = snapshot.match.board.find(({ x, y, kind }) => kind === "tunnel" && x === cell.x && y === cell.y);
  const revealed = batch.flatMap(goalSlot);
  const reachableGold = snapshot.match.board.filter(({ kind, assetId, revealed, reachable }) =>
    kind === "goal" && assetId === "goal-gold" && revealed && reachable);
  const goal = reachableGold.find(({ goalSlotId }) => goalSlotId && revealed.includes(goalSlotId)) ?? reachableGold[0];
  return tunnel && goal ? { event, actorSeatId: placed.actorSeatId, tunnel, goal } : null;
}

function getToolChange(entries: readonly JournalEntry[]): ToolChange | null {
  const entry = entries.findLast(({ type }) => type === "PLAY_BREAK" || type === "PLAY_REPAIR");
  if (!entry) return null;
  const { targetSeatId, tool } = entry.data ?? {};
  if (typeof targetSeatId !== "string" || (tool !== "pickaxe" && tool !== "lantern" && tool !== "cart")) return null;
  return { sequence: entry.sequence, actorSeatId: entry.actorSeatId, targetSeatId, tool, broken: entry.type === "PLAY_BREAK" };
}

type Result = { gold: GoldFinale | null };
type Presentation = {
  round: string;
  sequence: number;
  board: BoardTurnEffects | null;
  tool: ToolChange | null;
  result: Result | null;
};

function initial(snapshot: MatchSnapshot): Presentation {
  const { match } = snapshot;
  return { round: `${match.matchId}:${match.roundNo}`, sequence: snapshot.sequence, board: null, tool: null, result: null };
}

function nextPresentation(previous: Presentation, snapshot: MatchSnapshot): Presentation {
  const next = { ...previous, sequence: snapshot.sequence };
  const entries = snapshot.journal.filter(({ sequence }) => sequence > previous.sequence);
  const result = entries.findLast(({ type }) => type === "ROUND_RESOLVED");
  const gold = result ? getGoldFinale(snapshot, entries) : null;
  const move = entries.findLast(({ type }) => type === "PLAY_TUNNEL" || type === "PLAY_COLLAPSE");
  const position = move && eventPosition(move);
  const revealed = move ? entries.filter(({ revision }) => revision === move.revision).flatMap(goalSlot) : [];
  if (move && position) next.board = {
    sequence: move.sequence,
    placed: move.type === "PLAY_TUNNEL" ? position : undefined,
    collapsed: move.type === "PLAY_COLLAPSE" ? position : undefined,
    revealed, goldFinale: Boolean(gold),
  };
  next.tool = getToolChange(entries) ?? next.tool;
  if (result && snapshot.match.outcome) next.result = { gold };
  return next;
}

export function useTurnPresentation(snapshot: MatchSnapshot, onGoldReveal?: (event: JournalEntry) => void) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [saved, setSaved] = useState(() => initial(snapshot));
  const [finished, setFinished] = useState<Result | null>(null);
  const [faded, setFaded] = useState<ToolChange | null>(null);
  let current = saved;
  if (saved.round !== `${snapshot.match.matchId}:${snapshot.match.roundNo}` || snapshot.sequence < saved.sequence) {
    current = initial(snapshot);
    setSaved(current);
  } else if (saved.sequence !== snapshot.sequence) {
    current = nextPresentation(saved, snapshot);
    setSaved(current);
  }

  const result = current.result !== finished ? current.result : null;
  const tool = current.tool !== faded ? current.tool : null;
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => {
      if (reducedMotion && result.gold) onGoldReveal?.(result.gold.event);
      setFinished(result);
    }, reducedMotion ? 0 : result.gold ? 2740 : 760);
    return () => window.clearTimeout(timer);
  }, [result, reducedMotion, onGoldReveal]);
  useEffect(() => {
    if (!tool) return;
    const timer = window.setTimeout(() => setFaded(tool), 2400);
    return () => window.clearTimeout(timer);
  }, [tool]);
  return { board: current.board ?? undefined, tool, holdResults: Boolean(result) && !reducedMotion, gold: reducedMotion ? null : result?.gold ?? null };
}
