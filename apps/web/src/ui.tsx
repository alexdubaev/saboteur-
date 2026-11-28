import { useEffect, useRef, useState, type ReactNode } from "react";
import { crewPortraits, iconArt } from "./art.js";
import { copy, profileFor } from "./text.js";

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <img className={`icon ${className}`} src={iconArt(name)} alt="" aria-hidden="true" width={24} height={24} draggable={false} />;
}

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close?: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={element} className="dialog" aria-label={title} onCancel={(event) => {
      event.preventDefault();
      close?.();
    }}>
      <header className="dialog-header">
        <h2>{title}</h2>
        {close && <button className="icon-button" onClick={close} aria-label="Закрыть"><Icon name="close" /></button>}
      </header>
      {children}
    </dialog>
  );
}

export function Rules({ requiredOre, close }: { requiredOre?: number; close: () => void }) {
  const profile = profileFor(requiredOre);
  const chapters = { setup: "Экспедиция", play: "Ваш ход", scoring: "Итоги" } as const;
  const [chapter, setChapter] = useState<keyof typeof chapters>("setup");
  return (
    <Dialog title="Правила экспедиции" close={close}>
      <span className="eyebrow">{profile.label}</span>
      <div className="guide-chapters" role="group" aria-label="Раздел правил">
        {(Object.keys(chapters) as (keyof typeof chapters)[]).map(key =>
          <button type="button" key={key} aria-pressed={key === chapter} onClick={() => setChapter(key)}>{chapters[key]}</button>)}
      </div>
      <section aria-label={chapters[chapter]}>{profile[chapter].map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>
      <p className="soft-note">{copy.balance}</p>
    </Dialog>
  );
}

export function Avatar({ name, avatarId, bot }: { name: string; avatarId: string; bot?: boolean }) {
  const portrait = Array.from(bot ? name : avatarId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  return <span className="avatar crew-portrait" aria-hidden="true" style={{
    backgroundImage: `url("${crewPortraits}")`,
    backgroundPosition: `${(portrait % 3) * 50}% ${Math.floor(portrait / 3) * 100}%`,
  }}>{bot && <Icon name="cart" />}</span>;
}

export function Notice({ text }: { text: string }) {
  return text ? <p className="error" role="alert">{text}</p> : null;
}
