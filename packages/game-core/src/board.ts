import { beside, buildGraph, cellKey, componentAtPort, componentKey, directions, indexByCell, ports, reachableComponents, rotatePorts } from "./graph.js";
import type { BoardTile, CardType, Catalog, Connections, MatchState, Position } from "./types.js";

const catalogIndexes = new WeakMap<Catalog, Map<string, CardType>>();

export function findCard(catalog: Catalog, typeId: string): CardType {
  let index = catalogIndexes.get(catalog);
  if (!index) {
    index = new Map(catalog.cards.map(card => [card.id, card]));
    catalogIndexes.set(catalog, index);
  }
  const card = index.get(typeId);
  if (!card) throw new Error("Unknown catalog type in game state");
  return card;
}

export function withinBoard(position: Position, limit: number): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y) &&
    Math.abs(position.x) <= limit && Math.abs(position.y) <= limit;
}

export function inspectBoard(state: MatchState) {
  const { board } = state.definition.ruleset;
  const tiles: BoardTile[] = [{
    instanceId: "origin", kind: "origin", x: board.origin.x, y: board.origin.y,
    connections: board.origin.connections,
  }];
  for (const tile of state.board) {
    const card = findCard(state.definition.catalog, tile.typeId);
    if (card.kind !== "tunnel") throw new Error("Invalid tunnel in game state");
    tiles.push({ ...tile, kind: "tunnel", connections: rotatePorts(card.connections, tile.rotation) });
  }
  for (const slot of board.goalSlots) {
    tiles.push({
      instanceId: goalTileId(slot.id), kind: "goal", x: slot.x, y: slot.y,
      connections: [board.publicGoalPorts], terminal: board.goalTerminal,
    });
  }
  return { tiles, cells: indexByCell(tiles), reachable: reachableComponents(buildGraph(tiles)), limit: board.coordinateLimit };
}

function goalTileId(goalSlotId: string): string {
  return "goal:" + goalSlotId;
}

export function reachableGoal(reachable: ReadonlySet<string>, goalSlotId: string): boolean {
  return reachable.has(componentKey(goalTileId(goalSlotId), 0));
}

type BoardContext = ReturnType<typeof inspectBoard>;

export function placementCells(context: BoardContext): Position[] {
  const candidates = new Map<string, Position>();
  for (const tile of context.tiles) {
    if (tile.kind === "goal") continue;
    for (const [index, connections] of tile.connections.entries()) {
      if (!context.reachable.has(componentKey(tile.instanceId, index))) continue;
      for (const port of connections) {
        const position = beside(tile, port);
        const key = cellKey(position.x, position.y);
        if (withinBoard(position, context.limit) && !context.cells.has(key)) candidates.set(key, position);
      }
    }
  }
  return [...candidates.values()];
}

export function canPlace(context: BoardContext, position: Position, connections: Connections): boolean {
  if (!withinBoard(position, context.limit) || context.cells.has(cellKey(position.x, position.y))) return false;
  let connected = false;
  const openPorts = connections.flat();
  for (const port of ports) {
    const { x, y } = beside(position, port);
    const tile = context.cells.get(cellKey(x, y));
    if (!tile) continue;
    const index = componentAtPort(tile, directions[port].opposite);
    const portOpen = openPorts.includes(port);
    if (portOpen !== (index >= 0)) return false;
    if (portOpen && tile.kind !== "goal" && context.reachable.has(componentKey(tile.instanceId, index))) {
      connected = true;
    }
  }
  return connected;
}
