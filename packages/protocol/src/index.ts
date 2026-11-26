import { z } from "zod";
import type { PlayerView } from "../../game-core/src/types.js";

const opaqueId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const roomIdSchema = z.uuid();
export const inviteCodeSchema = z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
const coordinates = { x: z.int().min(-10000).max(10000), y: z.int().min(-10000).max(10000) };
const card = { instanceId: opaqueId };
const tool = z.enum(["pickaxe", "lantern", "cart"]);

export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("SET_READY"), ready: z.boolean() }),
  z.strictObject({ type: z.literal("ADD_BOT") }),
  z.strictObject({ type: z.literal("REMOVE_BOT"), seatId: opaqueId }),
  z.strictObject({ type: z.literal("SET_TIMER"), seconds: z.int().min(5).max(300).nullable() }),
  z.strictObject({ type: z.literal("START_MATCH") }),
  z.strictObject({ type: z.literal("REPLAY") }),
  z.strictObject({ type: z.literal("ABANDON") }),
  z.strictObject({ type: z.literal("ACK_ROLE") }),
  z.strictObject({ type: z.literal("ACK_SUMMARY") }),
  z.strictObject({ type: z.literal("PLAY_TUNNEL"), ...card, ...coordinates, rotation: z.literal([0, 180]) }),
  z.strictObject({ type: z.literal("PLAY_BREAK"), ...card, targetSeatId: opaqueId }),
  z.strictObject({ type: z.literal("PLAY_REPAIR"), ...card, targetSeatId: opaqueId, tool }),
  z.strictObject({ type: z.literal("PLAY_COLLAPSE"), ...card, ...coordinates }),
  z.strictObject({ type: z.literal("PLAY_SCOUT"), ...card, goalSlotId: opaqueId }),
  z.strictObject({ type: z.literal("DISCARD"), ...card }),
]);

const envelopeFields = {
  roomId: roomIdSchema,
  matchId: z.uuid().nullable(),
  expectedRevision: z.int().nonnegative(),
  commandId: opaqueId,
  command: commandSchema,
};

export const httpCommandSchema = z.strictObject({ ...envelopeFields, roomId: roomIdSchema.optional() });
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("SUBSCRIBE"), roomId: roomIdSchema }),
  z.strictObject({ type: z.literal("RESYNC"), roomId: roomIdSchema }),
  z.strictObject({ type: z.literal("COMMAND"), ...envelopeFields }),
]);

function normalizedText(max: number, multiline = false) {
  const invalid = multiline ? /[\p{Cc}\p{Bidi_Control}]/u : /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u;
  return z.string().max(max * 4).transform((value) => {
    const normalized = value.normalize("NFC").trim();
    return multiline ? normalized : normalized.replace(/ {2,}/g, " ");
  }).refine((value) => value.length > 0 && [...value].length <= max && !invalid.test(value));
}

export const guestSchema = z.strictObject({ name: normalizedText(32) });
export const joinSchema = z.strictObject({ code: inviteCodeSchema });
export const chatSchema = z.strictObject({ text: normalizedText(300, true) });
export const emptySchema = z.strictObject({});

export type SessionView = { name: string; avatarId: string };
export type RoomSeat = SessionView & { seatId: string; ready: boolean; present: boolean; bot: boolean };
export type RoomView = {
  roomId: string;
  code: string;
  hostSeatId: string | null;
  mySeatId: string;
  seats: RoomSeat[];
  turnTimeoutSeconds: number | null;
  deadlineAt: string | null;
};
export type ChatMessage = { messageId: string; seatId: string; name: string; text: string; at: string };
export type JournalEntry = {
  sequence: number;
  actorSeatId: string | null;
  type: string;
  revision: number;
  at: string;
  data?: Readonly<Record<string, string | number | boolean | null>>;
};

export type RoomSnapshot = {
  room: RoomView;
  match: PlayerView | null;
  chat: ChatMessage[];
  journal: JournalEntry[];
  sequence: number;
};
export type WireCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = {
  roomId: string;
  matchId: string | null;
  expectedRevision: number;
  commandId: string;
  command: WireCommand;
};
export type CommandAck = { type: "ACK"; commandId: string; ok: boolean; revision?: number; code?: string };
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = CommandAck | (RoomSnapshot & { type: "SNAPSHOT" }) | { type: "ERROR"; code: string };
