import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { JournalEntry } from "../../../packages/protocol/src/index.js";
import { boardArt } from "./art.js";
import type { TunnelAuthor } from "./board.js";
import { tools } from "./text.js";
import { goldFlipDelay, type GoldFinale, type ToolChange } from "./turn-presentation.js";
import { Icon } from "./ui.js";
import "./turn-overlays.css";

export function GoldReveal({ scene, author, onReveal }: {
  scene: GoldFinale; author?: TunnelAuthor; onReveal?: (event: JournalEntry) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRevealed(true);
      onReveal?.(scene.event);
    }, goldFlipDelay);
    return () => window.clearTimeout(timer);
  }, [scene, onReveal]);

  return <div className={`gold-reveal${revealed ? " gold-reveal-open" : ""}`} aria-label="Последний ход раунда" role="region">
    <div className="gold-reveal-layout">
      <strong className="gold-reveal-title" role="status">{revealed ? "Золото найдено!" : "Последний туннель"}</strong>
      <div className="gold-reveal-cards" aria-hidden="true">
        <div className="gold-reveal-tunnel" style={{ "--tunnel-author": author?.color } as CSSProperties}>
          <img src={boardArt(scene.tunnel.assetId, "compact")} alt="" width={256} height={384}
            style={{ transform: `rotate(${scene.tunnel.rotation}deg)` }} />
        </div>
        <span className="gold-reveal-link" />
        <div className="gold-reveal-perspective">
          <div className="gold-reveal-flip">
            <img src={boardArt("goal-hidden", "compact")} alt="" width={256} height={384} />
            <img className="gold-reveal-face" src={boardArt(scene.goal.assetId, "compact")} alt="" width={256} height={384}
              style={{ rotate: `${scene.goal.rotation}deg` }} />
          </div>
        </div>
      </div>
      {author && <p className="gold-reveal-credit"><strong style={{ color: author.color }}>{author.name}</strong> проложил последний туннель</p>}
    </div>
  </div>;
}

export function ToolFeedback({ change, authors, mySeatId }: { change: ToolChange; authors: ReadonlyMap<string, TunnelAuthor>; mySeatId: string }) {
  const actor = change.actorSeatId ? authors.get(change.actorSeatId) : undefined;
  const target = authors.get(change.targetSeatId);
  if (!target) return null;
  return <div className={`move-feedback${change.broken ? " move-feedback-break" : " move-feedback-repair"}`}
    role="status" aria-label={change.broken ? "Поломка инструмента" : "Ремонт инструмента"}>
    <Icon name={change.tool} />
    <div>
      <strong>{change.broken ? "Поломка" : "Ремонт"} · {tools[change.tool]}</strong>
      <p>
        {actor && change.actorSeatId !== change.targetSeatId && <>
          <span style={{ color: actor.color }}>{change.actorSeatId === mySeatId ? "Вы" : actor.name}</span>
          <span aria-hidden="true"> → </span>
        </>}
        <b style={{ color: target.color }}>{change.targetSeatId === mySeatId ? "Ваш инструмент" : target.name}</b>
      </p>
    </div>
  </div>;
}
