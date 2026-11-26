import { z } from "zod";
import { canPlace, findCard, inspectBoard, placementCells } from "./board.js";
import { rotatePorts } from "./graph.js";
import type { ActionCard, CardCommand, CardInstance, Command, CommandErrorCode, MatchState, SeatState, Tool } from "./types.js";

const instanceId = z.string().min(1);
const targetSeatId = z.string().min(1);
const cell = { x: z.int(), y: z.int() };
const tool = z.enum(["pickaxe", "lantern", "cart"]);

export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("PLAY_TUNNEL"), instanceId, ...cell, rotation: z.union([z.literal(0), z.literal(180)]) }),
  z.strictObject({ type: z.literal("PLAY_BREAK"), instanceId, targetSeatId }),
  z.strictObject({ type: z.literal("PLAY_REPAIR"), instanceId, targetSeatId, tool }),
  z.strictObject({ type: z.literal("PLAY_COLLAPSE"), instanceId, ...cell }),
  z.strictObject({ type: z.literal("PLAY_SCOUT"), instanceId, goalSlotId: z.string().min(1) }),
  z.strictObject({ type: z.literal("DISCARD"), instanceId }),
  z.strictObject({ type: z.literal("ACK_ROLE") }),
  z.strictObject({ type: z.literal("EXPIRE_ROLE_REVEAL") }),
  z.strictObject({ type: z.literal("ACK_SUMMARY") }),
  z.strictObject({ type: z.literal("ABANDON") }),
]);

const actionEffects = {
  PLAY_BREAK: "break",
  PLAY_REPAIR: "repair",
  PLAY_COLLAPSE: "collapse",
  PLAY_SCOUT: "scout",
} as const;

function noTunnelBuilding(state: MatchState, seat: SeatState): boolean {
  return state.definition.ruleset.tools.anyBreakBlocksTunnel && Object.keys(seat.brokenTools).length > 0;
}

function canBreak(state: MatchState, actor: SeatState, target: SeatState, tool: Tool): boolean {
  return (target.seatId !== actor.seatId || state.definition.ruleset.tools.allowSelfBreak) && !target.brokenTools[tool];
}

export function cardMoveError(
  state: MatchState, actor: SeatState, command: CardCommand, instance: CardInstance,
): CommandErrorCode | undefined {
  if (command.type === "DISCARD") return;
  const card = findCard(state.definition.catalog, instance.typeId);
  if (command.type === "PLAY_TUNNEL") {
    if (card.kind !== "tunnel") return "INVALID_COMMAND";
    if (noTunnelBuilding(state, actor)) return "TOOL_BROKEN";
    if (!card.allowedRotations.includes(command.rotation) ||
        !canPlace(inspectBoard(state), command, rotatePorts(card.connections, command.rotation))) {
      return "ILLEGAL_PLACEMENT";
    }
    return;
  }
  if (card.kind !== "action" || card.effect !== actionEffects[command.type]) return "INVALID_COMMAND";
  if (command.type === "PLAY_BREAK") {
    const target = state.seats.find(seat => seat.seatId === command.targetSeatId);
    if (!target || !canBreak(state, actor, target, card.tools[0])) return "INVALID_TARGET";
  } else if (command.type === "PLAY_REPAIR") {
    const target = state.seats.find(seat => seat.seatId === command.targetSeatId);
    if (!target?.brokenTools[command.tool] || !card.tools.some(tool => tool === command.tool)) return "INVALID_TARGET";
  } else if (command.type === "PLAY_COLLAPSE") {
    if (!state.board.some(tile => tile.x === command.x && tile.y === command.y)) return "INVALID_TARGET";
  } else if (!state.goals.some(goal => goal.goalSlotId === command.goalSlotId && !goal.revealed)) {
    return "INVALID_TARGET";
  }
}

function addActionMoves(moves: CardCommand[], state: MatchState, actor: SeatState, card: ActionCard, instanceId: string): void {
  switch (card.effect) {
    case "break":
      for (const target of state.seats) {
        if (canBreak(state, actor, target, card.tools[0])) moves.push({ type: "PLAY_BREAK", instanceId, targetSeatId: target.seatId });
      }
      break;
    case "repair":
      for (const target of state.seats) {
        for (const tool of card.tools) {
          if (target.brokenTools[tool]) moves.push({ type: "PLAY_REPAIR", instanceId, targetSeatId: target.seatId, tool });
        }
      }
      break;
    case "collapse":
      for (const { x, y } of state.board) moves.push({ type: "PLAY_COLLAPSE", instanceId, x, y });
      break;
    case "scout":
      for (const goal of state.goals) {
        if (!goal.revealed) moves.push({ type: "PLAY_SCOUT", instanceId, goalSlotId: goal.goalSlotId });
      }
  }
}

export function legalMoves(state: MatchState, seatId: string): Command[] {
  const actor = state.seats.find(seat => seat.seatId === seatId);
  if (!actor) return [];
  if (state.phase === "ROLE_REVEAL") return actor.roleAcknowledged ? [] : [{ type: "ACK_ROLE" }];
  if (state.phase === "ROUND_SUMMARY") return state.summaryAcknowledged.includes(seatId) ? [] : [{ type: "ACK_SUMMARY" }];
  if (state.phase !== "TURN" || state.turnSeatId !== seatId) return [];

  const moves: CardCommand[] = [];
  const blocked = noTunnelBuilding(state, actor);
  const board = blocked ? null : inspectBoard(state);
  const cells = board ? placementCells(board) : [];
  for (const { instanceId, typeId } of actor.hand) {
    moves.push({ type: "DISCARD", instanceId });
    const card = findCard(state.definition.catalog, typeId);
    if (card.kind === "action") {
      addActionMoves(moves, state, actor, card, instanceId);
    } else if (board) {
      for (const rotation of card.allowedRotations) {
        const connections = rotatePorts(card.connections, rotation);
        for (const cell of cells) {
          if (canPlace(board, cell, connections)) moves.push({ ...cell, type: "PLAY_TUNNEL", instanceId, rotation });
        }
      }
    }
  }
  return moves;
}
