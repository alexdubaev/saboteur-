import { useState, type FormEvent } from "react";
import type { SessionView } from "../../../packages/protocol/src/index.js";
import { corridorArt, logoArt } from "./art.js";
import { copy } from "./text.js";
import { Avatar, Icon, Notice } from "./ui.js";

export type EntryMode = "create" | "join";

type MenuProps = {
  session: SessionView | null;
  invite: string;
  pending: boolean;
  error: string;
  resume?: () => void;
  enter: (mode: EntryMode, name: string, code: string) => void;
};

export function Menu({ session, invite, pending, error, enter, resume }: MenuProps) {
  const [mode, setMode] = useState<EntryMode>(invite ? "join" : "create");
  const [name, setName] = useState("");
  const [code, setCode] = useState(invite);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    enter(mode, name.trim(), code.trim());
  };

  return (
    <main className="home-stage">
      <div className="home-copy">
        <div className="home-inner">
          <div className="eyebrow home-edition"><span aria-hidden="true">◆</span> {copy.alpha}<span className="edition-separator" />{copy.profile}</div>
          <h1 className="home-logo"><img src={logoArt} width={1440} height={488} alt={copy.title} /></h1>
          <p className="lead">Проложите путь к двум золотым жилам. Но помните: в вашей команде есть предатели.</p>
          <form className="entry-form" onSubmit={submit}>
            <div className="entry-switch" role="group" aria-label="Способ входа">
              <button type="button" className={mode === "create" ? "active" : ""} aria-pressed={mode === "create"} onClick={() => setMode("create")}><Icon name="pickaxe" />Создать</button>
              <button type="button" className={mode === "join" ? "active" : ""} aria-pressed={mode === "join"} onClick={() => setMode("join")}><Icon name="invite" />Присоединиться</button>
            </div>
            {session
              ? <div className="guest-id"><Avatar {...session} /><span>{session.name}</span></div>
              : <label className="field">Имя в экспедиции<input value={name} onChange={(event) => setName(event.target.value)} name="name" autoComplete="nickname" maxLength={32} placeholder="Ваше имя" required /></label>}
            {mode === "join" && <label className="field">Код приглашения<input name="code" value={code} autoComplete="off" autoCapitalize="characters" maxLength={8} pattern="[23456789A-HJ-KM-NP-Z]{8}" onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="8 символов" required /></label>}
            <Notice text={error} />
            <button className="button primary entry-submit" disabled={pending} type="submit">{pending ? "Подождите…" : mode === "create" ? copy.create : copy.join}<span className="arrow" aria-hidden="true">→</span></button>
          </form>
          {resume && <button className="button secondary resume-room" disabled={pending} onClick={resume}>Вернуться в комнату</button>}
          <ul className="home-facts" aria-label="Об экспедиции">
            <li><Icon name="invite" />3–10 игроков</li><li><Icon name="cards" />3 раунда</li><li><Icon name="gold" />2 золотые жилы</li>
          </ul>
        </div>
      </div>
      <figure className="home-art">
        <img src={corridorArt} alt="" fetchPriority="high" width={1254} height={1254} />
        <figcaption><Icon name="lantern" /><span>Вход в шахту</span></figcaption>
      </figure>
    </main>
  );
}
