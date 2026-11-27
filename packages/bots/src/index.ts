import { findCard } from "../../game-core/src/board.js";
import { beside, buildGraph, cellKey, componentKey, reachableComponents, rotatePorts } from "../../game-core/src/graph.js";
import type { BoardTile, Command, Definition, GoalContent, PlayerView, Position, Rng } from "../../game-core/src/types.js";

type BotDefinition = Pick<Definition, "catalog" | "ruleset">;
type Target = { tileId: string; approaches: Position[]; content: GoalContent | undefined };

function inspectRoutes(tiles: BoardTile[], targets: Target[], required: number) {
  const occupied = new Set(tiles.map(({ x, y }) => cellKey(x, y)));
  const reachable = reachableComponents(buildGraph(tiles));
  const exits = new Map<string, Position>();
  for (const tile of tiles) {
    if (tile.kind === "goal") continue;
    for (const [index, ports] of tile.connections.entries()) {
      if (!reachable.has(componentKey(tile.instanceId, index))) continue;
      for (const port of ports) {
        const position = beside(tile, port);
        const key = cellKey(position.x, position.y);
        if (!occupied.has(key)) exits.set(key, position);
      }
    }
  }

  const known: number[] = [];
  const unknown: number[] = [];
  for (const target of targets) {
    if (target.content === "barren") continue;
    const connected = reachable.has(componentKey(target.tileId, 0));
    let cost = connected ? 0 : 24;
    if (!connected) {
      for (const approach of target.approaches) {
        if (occupied.has(cellKey(approach.x, approach.y))) continue;
        for (const exit of exits.values()) {
          cost = Math.min(cost, 1 + Math.abs(approach.x - exit.x) + Math.abs(approach.y - exit.y));
        }
      }
    }
    (target.content === "ore" ? known : unknown).push(cost);
  }
  const unknownNeeded = Math.max(0, required - known.length);
  unknown.sort((left, right) => left - right);
  const primary = [...known, ...unknown.slice(0, unknownNeeded)];
  const alternatives = unknown.slice(unknownNeeded);
  return {
    cost: primary.reduce((sum, cost) => sum + cost, 0) +
      (unknownNeeded ? 0.25 * alternatives.reduce((sum, cost) => sum + cost, 0) : 0) - Math.min(8, exits.size) / 8,
    possibleWin: primary.filter((cost) => cost === 0).length >= required,
  };
}

export function chooseBotMove(view: PlayerView, rng: Rng, definition: BotDefinition): Command | undefined {
  const moves = view.moves;
  if (moves.length === 0) return undefined;
  if (view.phase !== "TURN") return moves[0];

  const { catalog, ruleset } = definition;
  const { board, victory } = ruleset;
  const required = victory.prospectors.required;
  const traitor = view.self.role === "traitor";
  const hand = new Map(view.self.hand.map((card) => [card.instanceId, findCard(catalog, card.typeId)]));
  const scouted = new Map(view.self.scoutResults.map((result) => [result.goalSlotId, result.content]));
  const targets: Target[] = [];
  const tiles: BoardTile[] = view.board.map((tile) => {
    const { x, y, kind } = tile;
    const instanceId = cellKey(x, y);
    if (kind === "origin") return { x, y, kind, instanceId, connections: board.origin.connections };
    if (kind === "goal") {
      const content = tile.revealed ? tile.assetId === board.goalAssets.ore ? "ore" : "barren" :
        tile.goalSlotId ? scouted.get(tile.goalSlotId) : undefined;
      targets.push({ tileId: instanceId, content, approaches: board.publicGoalPorts.map((port) => beside(tile, port)) });
      return { x, y, kind, instanceId, terminal: board.goalTerminal, connections: [board.publicGoalPorts] };
    }
    const card = findCard(catalog, tile.assetId);
    if (card.kind !== "tunnel") throw new Error("Board tile is not a tunnel");
    return { x, y, kind, instanceId, connections: rotatePorts(card.connections, tile.rotation) };
  });
  const before = inspectRoutes(tiles, targets, required);
  const positionScores = new Map<string, number>();
  const brokenTools = new Map(view.seats.map(({ seatId, brokenTools }) => [seatId, brokenTools.length]));
  const knownGoals = targets.filter(({ content }) => content !== undefined).length;

  function score(move: Command): number {
    switch (move.type) {
      case "PLAY_TUNNEL": {
        const card = hand.get(move.instanceId);
        if (card?.kind !== "tunnel") return Number.NEGATIVE_INFINITY;
        const { x, y, rotation } = move;
        const instanceId = cellKey(x, y);
        const key = `${instanceId}:${card.id}:${rotation}`;
        const cached = positionScores.get(key);
        if (cached !== undefined) return cached;
        const connections = rotatePorts(card.connections, rotation);
        const after = inspectRoutes([...tiles, { x, y, instanceId, kind: "tunnel", connections }], targets, required);
        const gain = before.cost - after.cost;
        const passable = connections.some((ports) => ports.length > 1);
        const value = traitor ? (after.possibleWin ? -1000 : 3 - 12 * gain) :
          (after.possibleWin ? 100 : 0) + 12 * gain + (passable ? 13 : -6);
        positionScores.set(key, value);
        return value;
      }
      case "PLAY_COLLAPSE": {
        const instanceId = cellKey(move.x, move.y);
        const key = `remove:${instanceId}`;
        const cached = positionScores.get(key);
        if (cached !== undefined) return cached;
        const after = inspectRoutes(tiles.filter((tile) => tile.instanceId !== instanceId), targets, required);
        const gain = before.cost - after.cost;
        const value = traitor ? (gain < -0.5 ? 15 - 12 * gain : 2) : (gain > 0.5 ? 10 + 12 * gain : 0);
        positionScores.set(key, value);
        return value;
      }
      case "PLAY_BREAK":
        return traitor ? ((brokenTools.get(move.targetSeatId) ?? 0) === 0 ? 32 : 15) : 2;
      case "PLAY_REPAIR": {
        const self = move.targetSeatId === view.self.seatId;
        if (traitor) return self ? 12 : 0;
        const unblocks = brokenTools.get(move.targetSeatId) === 1;
        return self ? (unblocks ? 36 : 22) : (unblocks ? 25 : 13);
      }
      case "PLAY_SCOUT":
        return !scouted.has(move.goalSlotId) && targets.length - knownGoals > 1 ? 12 : 2;
      case "DISCARD": {
        const card = hand.get(move.instanceId);
        if (card?.kind === "tunnel") return card.connections.some((ports) => ports.length > 1) ? (traitor ? 7 : 2) : (traitor ? 5 : 10);
        return card?.effect === "break" ? (traitor ? 2 : 9) : 5;
      }
      default:
        return Number.NEGATIVE_INFINITY;
    }
  }

  const scored = moves.map((move) => ({ move, score: score(move) }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore);
  return best[Math.floor(rng() * best.length)]?.move;
}
