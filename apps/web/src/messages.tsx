import { useState, type FormEvent } from "react";
import type { RoomSnapshot } from "../../../packages/protocol/src/index.js";
import type { TunnelAuthor } from "./board.js";
import { copy, journalLabels } from "./text.js";
import { Icon } from "./ui.js";

const clock = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });

export function Messages({ snapshot, send, authors, compact = false, split = false, local = false }: { snapshot: RoomSnapshot; send: (message: string) => Promise<boolean>; authors?: ReadonlyMap<string, TunnelAuthor>; compact?: boolean; split?: boolean; local?: boolean }) {
  const [tab, setTab] = useState<"chat" | "journal">("chat");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (await send(text)) setDraft((current) => current === draft ? "" : current);
    } finally {
      setSending(false);
    }
  };

  const names = new Map(snapshot.room.seats.map((seat) => [seat.seatId, seat.name]));
  const chat = <>
        <ol className="message-list" aria-label="Сообщения" aria-live="polite">
          {Array.from(new Map(snapshot.chat.map((message) => [message.messageId, message])).values()).reverse().map((message) => (
            <li key={message.messageId}><div><b>{message.name}</b><time dateTime={message.at}>{clock.format(new Date(message.at))}</time></div><p>{message.text}</p></li>
          ))}
          {snapshot.chat.length === 0 && <li className="soft-note">{copy.noChat}</li>}
        </ol>
        <form className="chat-form" onSubmit={submit}>
          <input className="chat-input" aria-label="Сообщение" placeholder="Написать в чат…" maxLength={300} value={draft} onChange={(event) => setDraft(event.target.value)} required />
          <button className="icon-button" aria-label="Отправить сообщение" disabled={sending || !draft.trim()}><Icon name="arrow-next" /></button>
        </form>
  </>;
  const journal = (
        <ol className="message-list" aria-label="Ходы и события" aria-live="polite">
          {[...snapshot.journal].reverse().filter((entry) => Object.hasOwn(journalLabels, entry.type)).map((entry) => {
            const label = journalLabels[entry.type];
            const author = entry.actorSeatId ? authors?.get(entry.actorSeatId) : undefined;
            const name = author?.name ?? (entry.actorSeatId ? names.get(entry.actorSeatId) : undefined);
            return <li key={entry.sequence}><div><span>
              {name && <><strong className="journal-actor" style={{ color: author?.color }}>{name}</strong>{" "}</>}{label}
            </span><time dateTime={entry.at}>{clock.format(new Date(entry.at))}</time></div></li>;
          })}
          {!snapshot.journal.some((entry) => Object.hasOwn(journalLabels, entry.type)) && <li className="soft-note">{copy.noJournal}</li>}
        </ol>
  );
  if (split) return <div className="messages-split">
    <section className="panel message-pane chat-pane" aria-label="Чат">
      <h2>Чат {local && <small>в этой вкладке</small>}</h2>{chat}
    </section>
    <section className="panel message-pane" aria-label="Журнал"><h2>Журнал</h2>{journal}</section>
  </div>;
  return (
    <section className={`panel messages ${compact ? "messages-compact" : ""}`} aria-label="Чат и журнал">
      <div className="message-tabs" role="group" aria-label="Переписка и события">
        <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}><Icon name="chat" />Чат</button>
        <button aria-pressed={tab === "journal"} onClick={() => setTab("journal")}><Icon name="cards" />Журнал</button>
      </div>
      {tab === "chat" ? chat : journal}
    </section>
  );
}
