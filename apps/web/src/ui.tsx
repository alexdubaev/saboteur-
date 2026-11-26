import { useEffect, useRef, type ReactNode } from "react";
import { iconArt } from "./art.js";
import { copy } from "./text.js";

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

export function Rules({ close }: { close: () => void }) {
  return (
    <Dialog title="Правила экспедиции" close={close}>
      <span className="eyebrow">{copy.profile}</span>
      {copy.rulesText.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <p className="soft-note">{copy.balance}</p>
    </Dialog>
  );
}

export function Avatar({ name, avatarId, bot }: { name: string; avatarId: string; bot?: boolean }) {
  const color = Array.from(avatarId).reduce((total, char) => total + char.charCodeAt(0), 0) % 4;
  return <span className={`avatar avatar-${color}`} aria-hidden="true">{bot ? <Icon name="cart" /> : name.slice(0, 1).toLocaleUpperCase("ru")}</span>;
}

export function Notice({ text }: { text: string }) {
  return text ? <p className="error" role="alert">{text}</p> : null;
}
