import { describe, expect, test } from "vitest";
import { buildGraph, reachableComponents, rotatePorts } from "../../packages/game-core/src/index.js";
import type { BoardTile, Port, Rotation } from "../../packages/game-core/src/index.js";

const ports = ["N", "E", "S", "W"] as const;
const opposite = { N: "S", E: "W", S: "N", W: "E" } as const;
const position = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

describe("public graph API", () => {
  test("R03: rotates every catalog geometry by 180 degrees and rejects quarter turns", async () => {
    const { readFile } = await import("node:fs/promises");
    const { cards } = JSON.parse(await readFile(new URL("../../data/card-catalog-v2.json", import.meta.url), "utf8"));
    expect(() => rotatePorts([["N"]], 90 as Rotation)).toThrow();
    for (const card of cards.filter((card: { kind: string }) => card.kind === "tunnel")) {
      const turned = rotatePorts(card.connections, 180);
      expect(turned).toEqual(card.connections.map((group: Port[]) => group.map(side => opposite[side])));
      expect(rotatePorts(turned, 180)).toEqual(card.connections);
      expect(rotatePorts(card.connections, 0)).toEqual(card.connections);
    }
  });

  test("R05/R17: for every split of four ports, only the component touching the entrance carries reachability", () => {
    for (const entry of ports) {
      const [dx, dy] = position[entry];
      const rest = ports.filter(side => side !== entry);
      for (let mask = 0; mask < 8; mask++) {
        const connected = [entry, ...rest.filter((_, index) => mask & (1 << index))];
        const separated = rest.filter(side => !connected.includes(side));
        const tiles: BoardTile[] = [
          { instanceId: "origin", kind: "origin", x: dx, y: dy, connections: [[opposite[entry]]] },
          { instanceId: "split", kind: "tunnel", x: 0, y: 0, connections: [connected, ...separated.map(side => [side])] },
          ...rest.map((side): BoardTile => ({
            instanceId: side, kind: "tunnel", x: position[side][0], y: position[side][1], connections: [[opposite[side]]],
          })),
        ];
        const graph = buildGraph(tiles);
        expect(graph.nodes.size).toBe(5 + separated.length);
        expect(reachableComponents(graph).size).toBe(2 + connected.length - 1);
      }
    }
  });

  test("R04/R07: diagonal contact and an entrance beyond a terminal chamber do not carry reachability", () => {
    const tiles: BoardTile[] = [
      { instanceId: "origin", kind: "origin", x: 0, y: 0, connections: [["E", "S"]] },
      { instanceId: "diagonal", kind: "tunnel", x: 1, y: 1, connections: [["N", "W"]] },
      { instanceId: "chamber", kind: "goal", x: 1, y: 0, connections: [["W", "E"]], terminal: true },
      { instanceId: "beyond", kind: "tunnel", x: 2, y: 0, connections: [["W"]] },
    ];
    expect(reachableComponents(buildGraph(tiles)).size).toBe(2);
    expect(reachableComponents(buildGraph(tiles.slice(0, 2))).size).toBe(1);
  });
});
