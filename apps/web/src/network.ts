import { useEffect, useRef, useState } from "react";
import type { CommandAck, CommandEnvelope, RoomSnapshot, ServerMessage, SessionView } from "../../../packages/protocol/src/index.js";

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function request<T>(path: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, body === undefined ? { cache: "no-store" } : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.code ?? "NETWORK");
  return payload as T;
}

export const errorCode = (error: unknown) => error instanceof ApiError ? error.code : "NETWORK";
export const sessionRequest = (name?: string) => name === undefined
  ? request<SessionView>("/session")
  : request<SessionView>("/session/guest", { name });

export const roomPath = (roomId: string) => "/rooms/" + encodeURIComponent(roomId);

export async function sendCommand(envelope: CommandEnvelope): Promise<void> {
  const action = () => request<CommandAck>(roomPath(envelope.roomId) + "/commands", envelope);
  const ack = await action().catch((error: unknown) => {
    if (errorCode(error) === "NETWORK") return action();
    throw error;
  });
  if (!ack?.ok) throw new ApiError(ack?.code ?? "NETWORK");
}

export type LinkStatus = "connecting" | "open" | "offline";

export function useRoomSocket(roomId: string | null, onSnapshot: (snapshot: RoomSnapshot) => void, onError: (code: string) => void) {
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const handlers = useRef({ onSnapshot, onError });
  const resync = useRef<() => void>(() => undefined);
  useEffect(() => { handlers.current = { onSnapshot, onError }; }, [onSnapshot, onError]);
  useEffect(() => {
    if (!roomId) return;
    let closed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    setStatus("connecting");

    const connect = () => {
      const url = new URL("/ws", window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const channel = new WebSocket(url);
      socket = channel;
      const subscribe = (type: "SUBSCRIBE" | "RESYNC") => {
        if (channel.readyState === WebSocket.OPEN) channel.send(JSON.stringify({ type, roomId }));
      };
      channel.onopen = () => subscribe("SUBSCRIBE");
      channel.onmessage = (event: MessageEvent<string>) => {
        if (closed || socket !== channel) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "SNAPSHOT" && message.room.roomId === roomId) {
          attempt = 0;
          setStatus("open");
          const { room, match, chat, journal, sequence } = message;
          handlers.current.onSnapshot({ room, match, chat, journal, sequence });
        } else if (message.type === "ERROR") {
          handlers.current.onError(message.code);
        }
      };
      channel.onerror = () => channel.close();
      channel.onclose = (event) => {
        if (closed) return;
        setStatus("offline");
        retry = setTimeout(connect, Math.min(10_000, 750 * 2 ** attempt));
        attempt++;
        if (event.code === 1008 || attempt === 3) {
          void sessionRequest().catch((failure: unknown) => {
            if (!closed && errorCode(failure) === "UNAUTHENTICATED") handlers.current.onError("UNAUTHENTICATED");
          });
        }
      };
      resync.current = () => subscribe("RESYNC");
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
      resync.current = () => undefined;
    };
  }, [roomId]);
  return { status, resync: () => resync.current() };
}
