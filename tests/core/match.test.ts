import { expect, test } from "vitest";
import { loadActiveDefinition } from "../../packages/config/src/index.js";
import { applyCommand, newMatch, startRound } from "../../packages/game-core/src/index.js";
import type { CommitResult } from "../../packages/game-core/src/index.js";

export function committed(result: CommitResult) {
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

test("R02: all eight player counts deal 66 unique cards and the configured roles", async () => {
  const definition = await loadActiveDefinition();
  for (let count = 3; count <= 10; count++) {
    const seatIds = Array.from({ length: count }, (_, index) => "seat-" + index);
    const rng = () => 0.25;
    const initial = newMatch(definition, { matchId: "match-" + count, seatIds }, rng);
    const state = committed(startRound(initial, rng));
    expect(initial.phase).toBe("LOBBY");
    expect(state.phase).toBe("ROLE_REVEAL");
    expect(state.roundNo).toBe(1);
    expect(state.revision).toBe(1);
    expect(state.seats.map(seat => seat.seatId)).toEqual(seatIds);
    expect(state.seats.filter(seat => seat.role === "traitor")).toHaveLength(count < 6 ? 1 : count < 9 ? 2 : 3);
    expect(state.seats.map(seat => seat.hand.length)).toEqual(Array(count).fill(count < 9 ? 5 : 4));
    const dealt = [...state.deck, ...state.seats.flatMap(seat => seat.hand)];
    expect(dealt).toHaveLength(66);
    expect(new Set(dealt.map(card => card.instanceId)).size).toBe(66);
    let ready = state;
    for (const seatId of seatIds) ready = committed(applyCommand(ready, seatId, { type: "ACK_ROLE" }, rng));
    expect(ready.phase).toBe("TURN");
    expect(ready.turnSeatId).toBe(seatIds[Math.floor(count * 0.25)]);
    expect(ready.turnNumber).toBe(0);
  }
});
