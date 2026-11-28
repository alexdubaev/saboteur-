import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalEntry, RoomSnapshot, SessionView, WireCommand } from "../../../packages/protocol/src/index.js";
import { Game } from "./game.js";
import { Lobby } from "./lobby.js";
import { Menu, type EntryMode } from "./menu.js";
import { ApiError, errorCode, request, roomPath, sendCommand, sessionRequest, useRoomSocket } from "./network.js";
import { copy, errorText } from "./text.js";
import { getGoldFinale } from "./turn-presentation.js";
import { Icon, Notice, Rules } from "./ui.js";
import { useGameAudio } from "./use-game-audio.js";

const params = new URLSearchParams(window.location.search);
const invitation = params.get("join")?.trim().toUpperCase();
const initialRoom = invitation === undefined ? params.get("room") : null;
const hostKey = new URLSearchParams(window.location.hash.slice(1)).get("host");
const inviteCodePattern = /^[23456789A-HJ-KM-NP-Z]{8}$/;
const savedRoomKey = "expedition:lastRoom";
const soundKey = "expedition:sound";

const joinRoom = (code: string) => request<RoomSnapshot>("/rooms/join", { code });

async function readEntryAccess() {
  if (hostKey !== null) {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }
  const access = await request<{ canCreateRooms: boolean }>("/entry");
  if (access.canCreateRooms || hostKey === null) return access;
  await request<{ ok: true }>("/session/host", { key: hostKey });
  return request<{ canCreateRooms: boolean }>("/entry");
}

async function restorePlayer(): Promise<{ snapshot?: RoomSnapshot; guest?: SessionView }> {
  if (invitation !== undefined) {
    if (!inviteCodePattern.test(invitation)) throw new ApiError("INVALID_INVITATION");
    return { snapshot: await joinRoom(invitation) };
  }
  if (initialRoom) return { snapshot: await request<RoomSnapshot>(roomPath(initialRoom)) };
  return { guest: await sessionRequest() };
}

const loadEntry = () => Promise.allSettled([readEntryAccess(), restorePlayer()]);

function roomGuest(snapshot: RoomSnapshot): SessionView | null {
  const seat = snapshot.room.seats.find(({ seatId }) => seatId === snapshot.room.mySeatId);
  return seat ? { name: seat.name, avatarId: seat.avatarId } : null;
}

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
  const [canCreateRooms, setCanCreateRooms] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [rules, setRules] = useState(false);
  const { audio, sound, soundActive, enableAudio, toggleSound } = useGameAudio(soundKey);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [terminalLobby, setTerminalLobby] = useState<string | null>(null);
  const [resume, setResume] = useState(() => initialRoom ?? (invitation ? null : sessionStorage.getItem(savedRoomKey)));
  const entryLoad = useRef<ReturnType<typeof loadEntry> | null>(null);
  const inFlight = useRef(false);
  const room = useRef(initialRoom);
  const heard = useRef<{ roomId: string; sequence: number } | null>(null);
  const finalLobby = state?.match?.matchId === terminalLobby;

  const playGold = useCallback((event: JournalEntry) => {
    if (!document.hidden) audio.current?.playLatest([event], "", true);
  }, [audio]);
  const ownTurnChanged = useCallback((turnKey: string | null) => audio.current?.setOwnTurn(turnKey), [audio]);

  useEffect(() => {
    const previous = heard.current;
    heard.current = state && { roomId: state.room.roomId, sequence: state.sequence };
    if (!state?.match || finalLobby || document.hidden || previous?.roomId !== state.room.roomId || previous.sequence >= state.sequence) return;
    const events = state.journal.filter(({ sequence }) => sequence > previous.sequence);
    const gold = getGoldFinale({ ...state, match: state.match }, events);
    audio.current?.playLatest(
      gold ? events.filter(({ type }) => type === "PLAY_TUNNEL") : events,
      state.room.mySeatId,
      state.match.outcome?.reason === "ore",
    );
  }, [state, finalLobby, audio]);

  const accept = useCallback((snapshot: RoomSnapshot) => {
    if (snapshot.room.roomId !== room.current) return;
    setState((current) => current?.room.roomId === snapshot.room.roomId && current.sequence > snapshot.sequence ? current : snapshot);
  }, []);

  const attach = useCallback((snapshot: RoomSnapshot) => {
    room.current = snapshot.room.roomId;
    sessionStorage.setItem(savedRoomKey, room.current);
    setResume(room.current);
    setRoomAddress(room.current);
    setSession(roomGuest(snapshot));
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
    entryLoad.current ??= loadEntry();
    void entryLoad.current.then(([access, player]) => {
      if (!active) return;
      setConnecting(false);
      if (access.status === "fulfilled") setCanCreateRooms(access.value.canCreateRooms);
      if (player.status === "fulfilled") {
        if (player.value.snapshot) {
          attach(player.value.snapshot);
          return;
        }
        if (player.value.guest) setSession(player.value.guest);
      } else {
        const code = errorCode(player.reason);
        if (code !== "UNAUTHENTICATED" || initialRoom || invitation !== undefined) {
          showError(code);
          return;
        }
      }
      if (access.status === "rejected") showError(errorCode(access.reason));
    });
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
    if (sound) enableAudio(true);
    if (mode === "join") {
      attach(await joinRoom(code));
      return;
    }
    if (!session) setSession(await sessionRequest(name));
    attach(await request<RoomSnapshot>("/rooms", {}));
  });

  const rename = (name: string) => mutation(async () => {
    if (!state) return;
    const snapshot = await request<RoomSnapshot>(roomPath(state.room.roomId) + "/name", { name });
    setSession(roomGuest(snapshot));
    accept(snapshot);
  });

  const run = async (command: WireCommand) => {
    if (!state || status !== "open") return false;
    const { room: current, match } = state;
    return mutation(async () => {
      if (sound) enableAudio(command.type === "START_MATCH" || command.type === "REPLAY");
      try {
        await sendCommand({
          roomId: current.roomId, matchId: match?.matchId ?? null,
          expectedRevision: match?.revision ?? 0, commandId: window.crypto.randomUUID(), command,
        });
      } catch (failure) {
        if (errorCode(failure) === "STALE_REVISION" || errorCode(failure) === "WRONG_PHASE") resync();
        throw failure;
      }
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

  const blocked = pending || (state !== null && status !== "open");
  const connectionStatus = state && status !== "open" ? status === "offline" ? copy.offline : copy.reconnect : undefined;
  const soundControl = <button type="button" className="icon-button" data-sound-toggle aria-label={soundActive ? copy.soundOn : copy.soundOff}
    title={soundActive ? copy.soundOn : copy.soundOff} aria-pressed={soundActive} onClick={toggleSound}>
    <Icon name="volume" className={soundActive ? "" : "muted-icon"} />
  </button>;

  return <div className="network-app">
    <header className={`site-header${state ? " site-header-room" : ""}`}>
      <div className="site-name"><Icon name="lantern" />{copy.title}</div>
      <div className="header-actions">
        {state && <span className="room-header-code" title="Код приглашения">{state.room.code}</span>}
        {soundControl}
        <button className="button secondary header-rules" onClick={() => setRules(true)}><Icon name="info" />{copy.rules}</button>
      </div>
    </header>
    {state?.match && !finalLobby ? <Game key={state.match.matchId} snapshot={{ ...state, match: state.match }} pending={blocked} error={error} run={run} send={send}
      openRules={() => setRules(true)} soundControl={soundControl} connectionStatus={connectionStatus} onGoldReveal={playGold} onTurnChange={ownTurnChanged}
      lobby={() => setTerminalLobby(state.match!.matchId)} exit={() => { setError(""); reset(true); }} />
      : state ? <>
        {connectionStatus && <p className="connection-status" role="status">{connectionStatus}</p>}
        <div className="lobby-error"><Notice text={error} /></div>
        <Lobby snapshot={state} run={run} send={send} rename={rename} pending={blocked} leave={() => void leave()} />
      </> : <Menu session={session} invite={invitation?.slice(0, 8) ?? ""} canCreateRooms={canCreateRooms} pending={pending} error={error}
        connecting={connecting ? invitation !== undefined ? "Входим в комнату…" : "Подключаемся…" : undefined}
        enter={(...args) => void enter(...args)}
        resume={session && resume ? () => void mutation(async () => {
          if (sound) enableAudio(false);
          attach(await request<RoomSnapshot>(roomPath(resume)));
        }) : undefined} />}
    {rules && <Rules requiredOre={finalLobby ? undefined : state?.match?.requiredOre} close={() => setRules(false)} />}
  </div>;
}
