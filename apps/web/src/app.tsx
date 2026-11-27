import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot, SessionView, WireCommand } from "../../../packages/protocol/src/index.js";
import { Game } from "./game.js";
import { Lobby } from "./lobby.js";
import { Menu, type EntryMode } from "./menu.js";
import { errorCode, request, roomPath, sendCommand, sessionRequest, useRoomSocket } from "./network.js";
import { copy, errorText } from "./text.js";
import { Icon, Notice, Rules } from "./ui.js";

const params = new URLSearchParams(window.location.search);
const invitation = (params.get("join") ?? "").trim().toUpperCase().slice(0, 8);
const initialRoom = params.get("room");
const savedRoomKey = "expedition:lastRoom";
const soundKey = "expedition:sound";

function setRoomAddress(roomId: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("join");
  if (roomId) url.searchParams.set("room", roomId);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

export function App() {
  const [state, setState] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [rules, setRules] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem(soundKey) === "on");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [terminalLobby, setTerminalLobby] = useState<string | null>(null);
  const [resume, setResume] = useState(() => initialRoom ?? (invitation ? null : sessionStorage.getItem(savedRoomKey)));
  const inFlight = useRef(false);
  const room = useRef(initialRoom);
  const audio = useRef<AudioContext | null>(null);

  const playSound = () => {
    const context = audio.current ?? new AudioContext();
    audio.current = context;
    void context.resume().then(() => {
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = "sine";
      tone.frequency.setValueAtTime(660, context.currentTime);
      tone.frequency.exponentialRampToValueAtTime(910, context.currentTime + .1);
      volume.gain.setValueAtTime(.04, context.currentTime);
      volume.gain.exponentialRampToValueAtTime(.001, context.currentTime + .19);
      tone.connect(volume);
      volume.connect(context.destination);
      tone.start();
      tone.stop(context.currentTime + .2);
    }).catch(() => undefined);
  };

  const accept = useCallback((snapshot: RoomSnapshot) => {
    if (snapshot.room.roomId !== room.current) return;
    setState((current) => current?.room.roomId === snapshot.room.roomId && current.sequence > snapshot.sequence ? current : snapshot);
  }, []);

  const attach = useCallback((snapshot: RoomSnapshot) => {
    room.current = snapshot.room.roomId;
    sessionStorage.setItem(savedRoomKey, room.current);
    setResume(room.current);
    setRoomAddress(room.current);
    accept(snapshot);
  }, [accept]);

  const reset = useCallback((keepRoom = false) => {
    room.current = null;
    setRoomAddress(null);
    if (!keepRoom) {
      sessionStorage.removeItem(savedRoomKey);
      setResume(null);
    }
    setTerminalLobby(null);
    setState(null);
  }, []);

  const showError = useCallback((code: string) => {
    setError(errorText(code));
    if (code === "UNAUTHENTICATED") {
      setSession(null);
      reset();
    } else if (code === "NOT_MEMBER" || code === "NOT_FOUND" || code === "ROOM_NOT_FOUND") {
      if (room.current) reset();
    }
  }, [reset]);

  const { status, resync } = useRoomSocket(state?.room.roomId ?? null, accept, showError);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const guest = await sessionRequest();
        if (!active) return;
        setSession(guest);
        if (initialRoom) {
          const snapshot = await request<RoomSnapshot>(roomPath(initialRoom));
          if (active) attach(snapshot);
        }
      } catch (failure) {
        if (!active) return;
        const code = errorCode(failure);
        if (code !== "UNAUTHENTICATED" || initialRoom) showError(code);
      }
    };
    void restore();
    return () => { active = false; };
  }, [attach, showError]);

  const mutation = async (effect: () => Promise<void>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await effect();
      return true;
    } catch (failure) {
      showError(errorCode(failure));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const enter = (mode: EntryMode, name: string, code: string) => mutation(async () => {
    if (!session) setSession(await sessionRequest(name));
    const snapshot = mode === "create"
      ? await request<RoomSnapshot>("/rooms", {})
      : await request<RoomSnapshot>("/rooms/join", { code });
    attach(snapshot);
    if (sound) playSound();
  });

  const run = async (command: WireCommand) => {
    if (!state || status !== "open") return false;
    const { room: current, match } = state;
    return mutation(async () => {
      try {
        await sendCommand({
          roomId: current.roomId, matchId: match?.matchId ?? null,
          expectedRevision: match?.revision ?? 0, commandId: window.crypto.randomUUID(), command,
        });
      } catch (failure) {
        if (errorCode(failure) === "STALE_REVISION" || errorCode(failure) === "WRONG_PHASE") resync();
        throw failure;
      }
      if (sound) playSound();
    });
  };

  const send = async (message: string) => {
    if (!state) return false;
    try {
      const snapshot = await request<RoomSnapshot>(roomPath(state.room.roomId) + "/chat", { text: message });
      accept(snapshot);
      return true;
    } catch (failure) {
      showError(errorCode(failure));
      return false;
    }
  };

  const leave = () => mutation(async () => {
    if (!state) return;
    await request(roomPath(state.room.roomId) + "/leave", {});
    reset();
  });

  const finalLobby = state?.match?.matchId === terminalLobby;
  const blocked = pending || (state !== null && status !== "open");

  return <>
    <header className={`site-header${state ? " site-header-room" : ""}`}>
      <div className="site-name"><Icon name="lantern" />{copy.title}</div>
      <div className="header-actions">
        {state && <span className="room-header-code" title="Код приглашения">{state.room.code}</span>}
        <button className="icon-button" aria-label={sound ? copy.soundOn : copy.soundOff} aria-pressed={sound} onClick={() => {
          const enabled = !sound;
          setSound(enabled);
          localStorage.setItem(soundKey, enabled ? "on" : "off");
          if (enabled) playSound();
        }}><Icon name="volume" className={sound ? "" : "muted-icon"} /></button>
        <button className="button secondary header-rules" onClick={() => setRules(true)}><Icon name="info" />{copy.rules}</button>
      </div>
    </header>
    {state && status !== "open" && <p className="connection-status" role="status">{status === "offline" ? copy.offline : copy.reconnect}</p>}
    {state?.match && !finalLobby ? <Game key={state.match.matchId} snapshot={{ ...state, match: state.match }} pending={blocked} error={error} run={run} send={send}
      lobby={() => setTerminalLobby(state.match!.matchId)} exit={() => { setError(""); reset(true); }} />
      : state ? <>
        <div className="lobby-error"><Notice text={error} /></div>
        <Lobby snapshot={state} run={run} send={send} pending={blocked} leave={() => void leave()} />
      </> : <Menu session={session} invite={invitation} pending={pending} error={error} enter={(...args) => void enter(...args)}
        resume={session && resume ? () => void mutation(async () => attach(await request<RoomSnapshot>(roomPath(resume)))) : undefined} />}
    {rules && <Rules requiredOre={finalLobby ? undefined : state?.match?.requiredOre} close={() => setRules(false)} />}
  </>;
}
