import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { CardCommand, Position, PublicBoardTile } from "../../../packages/game-core/src/types.js";
import { boardArt, mineRock } from "./art.js";
import { copy } from "./text.js";
import { Icon } from "./ui.js";
import "./board-effects.css";

type BoardMove = Extract<CardCommand, { type: "PLAY_TUNNEL" | "PLAY_COLLAPSE" | "PLAY_SCOUT" }>;
type Camera = { x: number; y: number; scale: number };
type FixedView = { center: Position; scale: number; overview: boolean };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type BoardFinale = { tunnel: Position; goal: Position; notice: ReactNode };
export type TunnelAuthor = { name: string; color: string };
export type BoardTurnEffects = {
  sequence: number;
  placed?: Position;
  collapsed?: Position;
  revealed?: readonly string[];
  goldFinale?: boolean;
};
type BoardProps = {
  tiles: PublicBoardTile[];
  authors: ReadonlyMap<string, TunnelAuthor>;
  moves: BoardMove[];
  staged: CardCommand | null;
  asset: string | undefined;
  last: Position | null;
  choose: (move: CardCommand) => void;
  phone?: boolean;
  status?: ReactNode;
  effects?: BoardTurnEffects;
  overlay?: ReactNode;
  finale?: BoardFinale;
};

const tileWidth = 72;
const tileHeight = 108;
const cell = (position: Position) => position.x + "," + position.y;
const same = (a: Position | null, b: Position) => a?.x === b.x && a?.y === b.y;
const clamped = (scale: number) => Math.max(.22, Math.min(2.6, scale));
const delta = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (a: Position, b: Position) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const zoom = (view: Camera, scale: number, from: Position, to = from): Camera => {
  const factor = scale / view.scale;
  return { scale, x: to.x - (from.x - view.x) * factor, y: to.y - (from.y - view.y) * factor };
};

function frameFinalMove(view: Camera, size: { width: number; height: number }, { tunnel, goal }: BoardFinale): Camera {
  if (!size.width || !size.height) return view;
  const left = Math.min(tunnel.x, goal.x) * tileWidth;
  const right = (Math.max(tunnel.x, goal.x) + 1) * tileWidth;
  const top = Math.min(tunnel.y, goal.y) * tileHeight;
  const bottom = (Math.max(tunnel.y, goal.y) + 1) * tileHeight;
  const margin = Math.min(17, size.width * .1, size.height * .14);
  const noticeHeight = Math.min(52, size.height * .44);
  const scale = Math.min(view.scale, (size.width - 2 * margin) / (right - left),
    (size.height - margin - noticeHeight) / (bottom - top));
  const centered = zoom(view, scale, { x: size.width / 2, y: size.height / 2 });
  return {
    scale,
    x: Math.max(margin - left * scale, Math.min(centered.x, size.width - margin - right * scale)),
    y: Math.max(noticeHeight - top * scale, Math.min(centered.y, size.height - margin - bottom * scale)),
  };
}

const labelTile = (tile: PublicBoardTile) => {
  if (tile.kind === "origin") return "Вход в шахту";
  if (tile.kind === "tunnel") return `Туннель ${tile.x}, ${tile.y}`;
  const status = tile.revealed ? tile.assetId === "goal-gold" ? "золотая жила" : "пустая порода" : "закрыта";
  return `Камера ${tile.goalSlotId?.replace(/^g/, "") ?? ""} · ${status}${tile.reachable && tile.revealed ? " · доступна" : ""}`;
};

function TileImage({ id, rotation, large, name, eager }: { id: string; rotation: number; large: boolean; name: string; eager?: boolean }) {
  const src = boardArt(id, large ? "standard" : "compact") ?? boardArt(id, "compact");
  return src
    ? <img src={src} className="tile-image" alt={name} draggable={false} loading={eager ? "eager" : "lazy"} width={512} height={768} style={{ transform: `rotate(${rotation}deg)` }} />
    : <span className="tile-unavailable" aria-label={name}>?</span>;
}

export function Board({ tiles, authors, moves, staged, asset, last, choose, phone = false, status, effects, overlay, finale }: BoardProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Position>());
  const start = useRef<Position | null>(null);
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const [fixedView, setFixedView] = useState<FixedView | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const bounds = tiles.reduce<Bounds>((frame, tile) => ({
    minX: Math.min(frame.minX, tile.x), maxX: Math.max(frame.maxX, tile.x),
    minY: Math.min(frame.minY, tile.y), maxY: Math.max(frame.maxY, tile.y),
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const fitScale = clamped(Math.min(
    (size.width - 44) / ((bounds.maxX - bounds.minX + 2.15) * tileWidth),
    (size.height - 50) / ((bounds.maxY - bounds.minY + 1.35) * tileHeight),
    1.22,
  ));
  const fit = {
    scale: fitScale,
    x: size.width / 2 - (bounds.minX + bounds.maxX + 1) / 2 * tileWidth * fitScale,
    y: size.height / 2 - (bounds.minY + bounds.maxY + 1) / 2 * tileHeight * fitScale,
  };
  const anchor = last ?? tiles.find((tile) => tile.kind === "origin") ?? { x: 0, y: 0 };
  const byCell = new Map(tiles.map((tile) => [cell(tile), tile]));
  const positionOf = (move: BoardMove) => "x" in move ? move : tiles.find((tile) => tile.goalSlotId === move.goalSlotId);
  const nearAnchor = moves.reduce<Position | undefined>((nearest, move) => {
    const target = positionOf(move);
    return target && (!nearest || delta(target, anchor) < delta(nearest, anchor)) ? target : nearest;
  }, undefined);
  const point = nearAnchor && delta(nearAnchor, anchor) === 1 ? center(nearAnchor, anchor) : nearAnchor ?? anchor;
  const workScale = .74;
  const work = {
    scale: workScale,
    x: size.width / 2 - (point.x + .5) * tileWidth * workScale,
    y: size.height / 2 - (point.y + .5) * tileHeight * workScale,
  };
  const tableView = fixedView ? {
    scale: fixedView.scale,
    x: size.width / 2 - fixedView.center.x * fixedView.scale,
    y: size.height / 2 - fixedView.center.y * fixedView.scale,
  } : phone ? work : fit;
  const view = finale ? frameFinalMove(tableView, size, finale) : tableView;
  const framing = Boolean(finale);
  const current = useRef(tableView);
  useEffect(() => { current.current = tableView; }, [tableView]);
  const large = tileWidth * view.scale * window.devicePixelRatio > 256;
  const moveByCell = new Map(moves.map((move) => {
    const position = positionOf(move);
    return [position ? cell(position) : "", move] as const;
  }));

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const updateCamera = useCallback((change: (previous: Camera) => Camera, overview = false) => {
    if (framing) return;
    const next = change(current.current);
    current.current = next;
    setFixedView({
      scale: next.scale, overview,
      center: { x: (size.width / 2 - next.x) / next.scale, y: (size.height / 2 - next.y) / next.scale },
    });
  }, [size, framing]);

  const showOverview = () => updateCamera(() => fit, true);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.cancelable) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      updateCamera((previous) => zoom(previous, clamped(previous.scale * (event.deltaY < 0 ? 1.13 : 1 / 1.13)), point));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [updateCamera]);

  const focusTile = (tile: Position) => {
    updateCamera((previous) => ({
      scale: Math.max(previous.scale, .71),
      x: size.width / 2 - (tile.x + .5) * tileWidth * Math.max(previous.scale, .71),
      y: size.height / 2 - (tile.y + .5) * tileHeight * Math.max(previous.scale, .71),
    }));
  };
  const scaleBy = (factor: number) => updateCamera((previous) =>
    zoom(previous, clamped(previous.scale * factor), { x: size.width / 2, y: size.height / 2 }));
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (framing || event.button !== 0 || pointers.current.size >= 2) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) {
      start.current = point;
      dragged.current = false;
    }
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      dragged.current = true;
      setPanning(true);
      for (const id of pointers.current.keys()) event.currentTarget.setPointerCapture(id);
    }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    if (!dragged.current && start.current && delta(start.current, next) > 5) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragged.current = true;
      setPanning(true);
    }
    if (!dragged.current) return;
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const box = event.currentTarget.getBoundingClientRect();
      const local = (point: Position) => ({ x: point.x - box.left, y: point.y - box.top });
      const ratio = delta(next, other) / Math.max(delta(previous, other), 1);
      updateCamera((view) => zoom(view, clamped(view.scale * ratio), local(center(previous, other)), local(center(next, other))));
    } else {
      updateCamera((view) => ({ ...view, x: view.x + next.x - previous.x, y: view.y + next.y - previous.y }));
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size === 0) setPanning(false);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (framing || event.target !== event.currentTarget) return;
    const pan: Record<string, Position> = {
      ArrowLeft: { x: 50, y: 0 }, ArrowRight: { x: -50, y: 0 },
      ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 },
    };
    if (Object.hasOwn(pan, event.key)) {
      const offset = pan[event.key];
      updateCamera((view) => ({ ...view, x: view.x + offset.x, y: view.y + offset.y }));
    } else if (event.key === "+" || event.key === "=") scaleBy(1.2);
    else if (event.key === "-") scaleBy(1 / 1.2);
    else if (event.key === "0") showOverview();
    else return;
    event.preventDefault();
  };

  const stagedPosition = staged && "x" in staged ? staged : staged?.type === "PLAY_SCOUT"
    ? tiles.find((tile) => tile.goalSlotId === staged.goalSlotId) ?? null : null;
  const goals = tiles.filter((tile) => tile.kind === "goal");
  const collapse = effects?.collapsed ?? last;
  const showCollapse = collapse && !byCell.has(cell(collapse));

  return (
    <section className={status ? "mine mine-with-status" : "mine"} aria-label={copy.mine}>
      {status}
      <div
        ref={viewport} className={`board-viewport${panning ? " is-panning" : ""}`} tabIndex={0} role="region"
        style={{ backgroundImage: `linear-gradient(100deg,#1b15102b,#1c171533), url("${mineRock}")` }}
        aria-label="Поле шахты. Стрелки перемещают поле, плюс и минус меняют масштаб, ноль показывает всё поле."
        onKeyDown={keyboard} onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={up} onLostPointerCapture={up}
        onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) up(event); }}
        onClickCapture={(event) => { if (dragged.current && event.detail !== 0) event.stopPropagation(); }}
      >
        <div className="board-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, visibility: size.width ? "visible" : "hidden" }}>
          <div className="board-grid" style={{ left: (bounds.minX - 1) * tileWidth, top: (bounds.minY - 1) * tileHeight, width: (bounds.maxX - bounds.minX + 3) * tileWidth, height: (bounds.maxY - bounds.minY + 3) * tileHeight }} />
          {tiles.map((tile) => {
            const key = cell(tile);
            const action = moveByCell.get(key);
            const author = tile.kind === "tunnel" && tile.placedBySeatId ? authors.get(tile.placedBySeatId) : undefined;
            const name = author ? `${labelTile(tile)} · Автор: ${author.name}` : labelTile(tile);
            const selected = stagedPosition && same(stagedPosition, tile);
            const landed = tile.kind === "tunnel" && same(effects?.placed ?? null, tile);
            const camera = tile.goalSlotId ? `Камера ${tile.goalSlotId.replace(/^g/, "")}` : null;
            const cameraLabel = tile.revealed ? tile.assetId === "goal-gold" ? "Жила" : "Порода" : camera;
            const finalTile = Boolean(finale && same(finale.tunnel, tile));
            const finalGoal = Boolean(finale && same(finale.goal, tile));
            const flipped = tile.kind === "goal" && tile.revealed && tile.goalSlotId && (finalGoal || effects?.revealed?.includes(tile.goalSlotId));
            const golden = flipped && effects?.goldFinale && tile.assetId === "goal-gold";
            const className = `board-tile tile-${tile.kind}${same(last, tile) ? " last-tile" : ""}${selected ? " tile-selected" : ""}${author ? " tile-authored" : ""}${landed ? " tile-arrived" : ""}${finalTile ? " tile-final-tunnel" : ""}${flipped ? " tile-revealing" : ""}${golden ? " tile-gold-finale" : ""}`;
            const style = { left: tile.x * tileWidth, top: tile.y * tileHeight, color: author?.color };
            const turnSequence = landed || flipped ? effects?.sequence : undefined;
            const front = <>
              <TileImage id={tile.assetId} rotation={tile.rotation} large={large} name={action ? "" : name} eager={landed || Boolean(flipped)} />
              {camera && <span className="tile-label">{cameraLabel}</span>}
            </>;
            const content = flipped ? (
              <span className="tile-turnover" key={turnSequence}>
                <span className="tile-face tile-face-closed" aria-hidden="true">
                  <TileImage id="goal-hidden" rotation={0} large={large} name="" eager />
                  <span className="tile-label">{camera}</span>
                </span>
                <span className="tile-face tile-face-open">{front}</span>
              </span>
            ) : front;
            const effectsLayer = <>
              {landed && <span className="tile-landing-dust" key={`landing-${turnSequence}`} aria-hidden="true" />}
              {finalTile && <span className="tile-final-accent" aria-hidden="true" />}
              {golden && <span className="tile-gold-sparks" key={`gold-${turnSequence}`} aria-hidden="true" />}
            </>;
            return action
              ? <button key={key} className={`${className} tile-target`} data-turn-sequence={turnSequence} style={style} title={author ? name : undefined} onClick={() => choose(action)} aria-label={name} aria-pressed={Boolean(selected)}>{content}{effectsLayer}</button>
              : <div key={key} className={className} data-turn-sequence={turnSequence} style={style} title={name}>{content}{effectsLayer}</div>;
          })}
          {moves.filter((action): action is Extract<BoardMove, { type: "PLAY_TUNNEL" }> => action.type === "PLAY_TUNNEL" && !byCell.has(cell(action))).map((action) => {
            const selected = staged?.type === "PLAY_TUNNEL" && same(staged, action);
            return (
              <button type="button" className={`board-tile tile-target tile-empty${selected ? " tile-selected" : ""}`} key={cell(action)}
                style={{ left: action.x * tileWidth, top: action.y * tileHeight }}
                onClick={() => choose(action)} aria-label={`Клетка ${action.x}, ${action.y}`} aria-pressed={selected}>
                {selected && asset ? <TileImage id={asset} rotation={action.rotation} large={large} name="" /> : <span aria-hidden="true">+</span>}
              </button>
            );
          })}
          {showCollapse && <div className="board-tile last-tile collapsed-tile" style={{ left: collapse.x * tileWidth, top: collapse.y * tileHeight }} aria-label="Последний обвал">
            {effects?.collapsed && <span className="tile-collapse-dust" key={effects.sequence} data-turn-sequence={effects.sequence} aria-hidden="true" />}
          </div>}
        </div>
        {finale?.notice}
      </div>
      {!finale && overlay}
      {!status && !finale && <div className="board-title"><Icon name="lantern" /><h2>{copy.mine}</h2></div>}
      <div className="board-controls" aria-label="Управление картой">
        <button className="icon-button" disabled={framing} onClick={() => scaleBy(1.22)} aria-label="Приблизить">{phone ? "+" : <Icon name="zoom-in" />}</button>
        <button className="icon-button" disabled={framing} onClick={() => scaleBy(1 / 1.22)} aria-label="Отдалить">{phone ? "−" : <Icon name="zoom-out" />}</button>
        {phone ? <>
          <button className="button secondary" disabled={framing} onClick={showOverview} aria-pressed={fixedView?.overview ?? false}>Вся шахта</button>
          <button className="button secondary" disabled={framing} onClick={() => setFixedView(null)} aria-pressed={!fixedView} title="Вернуть автослежение за ходами">К ходу</button>
        </> : <>
          <button className="icon-button" disabled={framing} onClick={showOverview} aria-label="Показать всё поле"><Icon name="settings" /></button>
          <button className="icon-button" disabled={framing} onClick={() => { const origin = tiles.find((tile) => tile.kind === "origin"); if (origin) focusTile(origin); }} aria-label="Ко входу"><Icon name="home" /></button>
          {goals.length > 0 && <button className="icon-button" disabled={framing} onClick={() => focusTile(goals[Math.floor(goals.length / 2)])} aria-label="К камерам"><Icon name="gold" /></button>}
          {last && <button className="icon-button" disabled={framing} onClick={() => focusTile(last)} aria-label="К последнему ходу"><Icon name="arrow-back" /></button>}
        </>}
      </div>
    </section>
  );
}
