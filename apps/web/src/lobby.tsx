import { useState, type FormEvent } from "react";
import type { RoomSnapshot, WireCommand } from "../../../packages/protocol/src/index.js";
import { junctionArt } from "./art.js";
import { Messages } from "./messages.js";
import { copy } from "./text.js";
import { Avatar, Icon } from "./ui.js";

export type RunCommand = (command: WireCommand) => Promise<boolean>;

const minParticipants = 3;
const maxParticipants = 10;

const inviteUrl = (code: string) => {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("join", code);
  return url.href;
};

function TimerSetup({ seconds, disabled, run }: { seconds: number | null; disabled: boolean; run: RunCommand }) {
  const [value, setValue] = useState(seconds?.toString() ?? "");
  const update = (event: FormEvent) => {
    event.preventDefault();
    void run({ type: "SET_TIMER", seconds: value ? Number(value) : null });
  };
  return (
    <form className="timer-form" onSubmit={update}>
      <label className="field">Секунд на ход<input type="number" min={5} max={300} step={1} placeholder="Без таймера" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <button className="button secondary" disabled={disabled || (value ? Number(value) : null) === seconds}>Сохранить</button>
    </form>
  );
}

export function Lobby({ snapshot, run, send, pending, leave }: { snapshot: RoomSnapshot; run: RunCommand; send: (message: string) => Promise<boolean>; pending: boolean; leave: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const { room, match } = snapshot;
  const host = room.mySeatId === room.hostSeatId;
  const me = room.seats.find((seat) => seat.seatId === room.mySeatId);
  const botCount = room.seats.filter((seat) => seat.bot).length;
  const freeSeats = maxParticipants - room.seats.length;
  const enoughPlayers = room.seats.length >= minParticipants;
  const allReady = enoughPlayers && room.seats.every((seat) => seat.bot || (seat.ready && seat.present));
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(room.code));
      setCopied(true);
    } catch {
      setShowInvite(true);
    }
  };

  return (
    <main className="lobby-shell" aria-label={copy.lobby}>
      <section className="lobby-banner" style={{ backgroundImage: `linear-gradient(90deg,#171020 5%,#171020aa 64%,#17102011), url(${junctionArt})` }}>
        <div>
          <p className="eyebrow">{copy.alpha} · {copy.profile}</p>
          <h1>{copy.lobby}</h1>
          <p className="lobby-intro">Пригласите друзей по ссылке. Ведущий может добавить ботов перед началом.</p>
        </div>
        <div className="invite">
          <span>Код приглашения</span><strong aria-label="Код приглашения" data-testid="invite-code">{room.code}</strong>
          <button className="button secondary" onClick={() => void copyInvite()}><Icon name="copy" />{copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button>
          {showInvite && <input className="chat-input" aria-label="Ссылка приглашения" value={inviteUrl(room.code)} readOnly autoFocus onFocus={(event) => event.currentTarget.select()} />}
        </div>
      </section>
      <div className="lobby-body">
        <section className="panel crew-panel" aria-label={copy.crew}>
          <div className="panel-heading"><h2>{copy.crew}</h2><span>{room.seats.length} / {maxParticipants}</span></div>
          <p className="soft-note" role="status">Людей {room.seats.length - botCount} · Ботов {botCount} · Свободных мест {freeSeats}</p>
          {!enoughPlayers && <p className="soft-note">Для старта нужно минимум {minParticipants} участника. {host && "Можно добавить ботов."}</p>}
          {host && enoughPlayers && !allReady && <p className="soft-note">Дождитесь готовности всех игроков.</p>}
          {host && !match && freeSeats === 0 && botCount > 0 && <p className="soft-note">Уберите бота, чтобы освободить место для друга.</p>}
          <div className="lobby-actions" style={{ marginBottom: 14 }}>
            {host && !match && <button className="button secondary" disabled={pending || freeSeats === 0} onClick={() => void run({ type: "ADD_BOT" })}><Icon name="cart" />Добавить бота</button>}
            {!match && <button className="button secondary" disabled={pending || !me} aria-pressed={me?.ready ?? false} onClick={() => void run({ type: "SET_READY", ready: !me?.ready })}><Icon name="confirm" />{me?.ready ? copy.unready : copy.ready}</button>}
            {host && <button className="button primary" disabled={pending || !allReady} onClick={() => void run({ type: match ? "REPLAY" : "START_MATCH" })}><Icon name="pickaxe" />{match ? "Играть снова" : copy.play}</button>}
          </div>
          <ul className="lobby-seats">
            {room.seats.map((seat) => (
              <li key={seat.seatId}>
                <Avatar {...seat} />
                <div className="seat-name"><strong>{seat.name}</strong><small>{[seat.seatId === room.mySeatId && "Вы", seat.seatId === room.hostSeatId && "Ведущий", seat.bot && "Бот"].filter(Boolean).join(" · ")}</small></div>
                <span className={seat.bot || (seat.present && seat.ready) ? "seat-ready" : "soft-note"}>{seat.bot || (seat.present && seat.ready) ? "Готов" : seat.present ? "Ждёт" : "Нет связи"}</span>
                {host && !match && seat.bot && <button className="icon-button" aria-label={`Убрать бота ${seat.name}`} title="Убрать бота" disabled={pending} onClick={() => void run({ type: "REMOVE_BOT", seatId: seat.seatId })}><Icon name="close" /></button>}
              </li>
            ))}
          </ul>
        </section>
        <div className="lobby-side">
          <section className="panel setting-panel">
            <div className="panel-heading"><h2>Таймер хода</h2><Icon name="settings" /></div>
            <p className="soft-note">{room.turnTimeoutSeconds ? `${room.turnTimeoutSeconds} с на ход` : "Ходы без ограничения времени"}</p>
            {host && !match && <TimerSetup key={room.turnTimeoutSeconds ?? "off"} seconds={room.turnTimeoutSeconds} disabled={pending} run={run} />}
          </section>
          <Messages snapshot={snapshot} send={send} />
        </div>
      </div>
      <footer className="lobby-footer"><p className="soft-note">{copy.preview}</p><button className="button secondary" disabled={pending} onClick={leave}>{copy.leave}</button></footer>
    </main>
  );
}
