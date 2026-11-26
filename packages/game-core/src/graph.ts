import type { BoardTile, Connections, Graph, Port, Position, Rotation } from "./types.js";

export const directions = {
  N: { x: 0, y: -1, opposite: "S" },
  E: { x: 1, y: 0, opposite: "W" },
  S: { x: 0, y: 1, opposite: "N" },
  W: { x: -1, y: 0, opposite: "E" },
} as const;
export const ports = Object.keys(directions) as Port[];

export function rotatePorts(connections: Connections, rotation: Rotation): Connections {
  if (rotation === 0) return connections.map(component => [...component]);
  if (rotation === 180) return connections.map(component => component.map(port => directions[port].opposite));
  throw new Error("Unsupported rotation");
}

export function cellKey(x: number, y: number): string {
  return x + "," + y;
}

export function componentKey(instanceId: string, index: number): string {
  return instanceId + ":" + index;
}

export function beside(position: Position, port: Port): Position {
  const direction = directions[port];
  return { x: position.x + direction.x, y: position.y + direction.y };
}

export function indexByCell(tiles: readonly BoardTile[]): ReadonlyMap<string, BoardTile> {
  return new Map(tiles.map(tile => [cellKey(tile.x, tile.y), tile]));
}

export function componentAtPort(tile: BoardTile, port: Port): number {
  return tile.connections.findIndex(component => component.includes(port));
}

export function buildGraph(tiles: readonly BoardTile[]): Graph {
  const cells = indexByCell(tiles);
  const nodes = new Map<string, Set<string>>();
  const originComponents: string[] = [];
  for (const tile of tiles) {
    for (const [index, connections] of tile.connections.entries()) {
      const key = componentKey(tile.instanceId, index);
      const adjacent = new Set<string>();
      nodes.set(key, adjacent);
      if (tile.kind === "origin") originComponents.push(key);
      if (tile.terminal || tile.kind === "goal") continue;
      for (const port of connections) {
        const { x, y } = beside(tile, port);
        const neighbor = cells.get(cellKey(x, y));
        if (!neighbor) continue;
        const neighborIndex = componentAtPort(neighbor, directions[port].opposite);
        if (neighborIndex >= 0) adjacent.add(componentKey(neighbor.instanceId, neighborIndex));
      }
    }
  }
  return { nodes, originComponents };
}

export function reachableComponents(graph: Graph): ReadonlySet<string> {
  const visited = new Set(graph.originComponents);
  const queue = [...graph.originComponents];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of graph.nodes.get(queue[index]) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return visited;
}
