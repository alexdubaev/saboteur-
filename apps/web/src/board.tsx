import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CardCommand, Position, PublicBoardTile } from "../../../packages/game-core/src/types.js";
import { boardArt, junctionArt } from "./art.js";
import { copy } from "./text.js";
import { Icon } from "./ui.js";

type BoardMove = Extract<CardCommand, { type: "PLAY_TUNNEL" | "PLAY_COLLAPSE" | "PLAY_SCOUT" }>;
type Camera = { x: number; y: number; scale: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
export type TunnelAuthor = { name: string; color: string };
type BoardProps = {
  tiles: PublicBoardTile[];
  authors: ReadonlyMap<string, TunnelAuthor>;
  moves: BoardMove[];
  staged: CardCommand | null;
  asset: string | undefined;
  last: Position | null;
  choose: (move: CardCommand) => void;
  phone?: boolean;
  selectedCard?: string;
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

const labelTile = (tile: PublicBoardTile) => {
  if (tile.kind === "origin") return "Вход в шахту";
  if (tile.kind === "tunnel") return `Туннель ${tile.x}, ${tile.y}`;
  const status = tile.revealed ? tile.assetId === "goal-gold" ? "золотая жила" : "пустая порода" : "закрыта";
  return `Камера ${tile.goalSlotId?.replace(/^g/, "") ?? ""} · ${status}${tile.reachable && tile.revealed ? " · доступна" : ""}`;
};

function TileImage({ id, rotation, large, name }: { id: string; rotation: number; large: boolean; name: string }) {
  const src = boardArt(id, large ? "standard" : "compact") ?? boardArt(id, "compact");
  return src
    ? <img src={src} className="tile-image" alt={name} draggable={false} loading="lazy" width={512} height={768} style={{ transform: `rotate(${rotation}deg)` }} />
    : <span className="tile-unavailable" aria-label={name}>?</span>;
}

export function Board({ tiles, authors, moves, staged, asset, last, choose, phone = false, selectedCard }: BoardProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Position>());
  const start = useRef<Position | null>(null);
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const [camera, setCamera] = useState<{ scope: string; view: Camera | "overview" } | null>(null);
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
  const point = nearAnchor ?? anchor;
  const scope = `${phone}:${selectedCard ?? ""}`;
  const chosenCamera = camera?.scope === scope ? camera.view : null;
  const workScale = .86;
  const work = {
    scale: workScale,
    x: size.width / 2 - (point.x + .5) * tileWidth * workScale,
    y: size.height / 2 - (point.y + .5) * tileHeight * workScale,
  };
  const view = chosenCamera === "overview" ? fit : chosenCamera ?? (phone ? work : fit);
  const current = useRef(view);
  useEffect(() => { current.current = view; }, [view]);
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

  const updateCamera = useCallback((change: (previous: Camera) => Camera) => {
    current.current = change(current.current);
    setCamera({ scope, view: current.current });
  }, [scope]);

  const showOverview = () => setCamera({ scope, view: "overview" });

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
    if (event.button !== 0 || pointers.current.size >= 2) return;
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
    if (event.target !== event.currentTarget) return;
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

  return (
    <section className="mine" aria-label={copy.mine}>
      <div
        ref={viewport} className={`board-viewport${panning ? " is-panning" : ""}`} tabIndex={0} role="region"
        aria-label="Поле шахты. Стрелки перемещают поле, плюс и минус меняют масштаб, ноль показывает всё поле."
        onKeyDown={keyboard} onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={up} onLostPointerCapture={up}
        onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) up(event); }}
        onClickCapture={(event) => { if (dragged.current && event.detail !== 0) event.stopPropagation(); }}
        style={{ backgroundImage: `linear-gradient(#1a132bf0,#15101feb), url(${junctionArt})` }}
      >
        <div className="board-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, visibility: size.width ? "visible" : "hidden" }}>
          <div className="board-grid" style={{ left: (bounds.minX - 1) * tileWidth, top: (bounds.minY - 1) * tileHeight, width: (bounds.maxX - bounds.minX + 3) * tileWidth, height: (bounds.maxY - bounds.minY + 3) * tileHeight }} />
          {tiles.map((tile) => {
            const key = cell(tile);
            const action = moveByCell.get(key);
            const author = tile.kind === "tunnel" && tile.placedBySeatId ? authors.get(tile.placedBySeatId) : undefined;
            const name = author ? `${labelTile(tile)} · Автор: ${author.name}` : labelTile(tile);
            const selected = stagedPosition && same(stagedPosition, tile);
            const className = `board-tile tile-${tile.kind}${same(last, tile) ? " last-tile" : ""}${selected ? " tile-selected" : ""}${author ? " tile-authored" : ""}`;
            const style = { left: tile.x * tileWidth, top: tile.y * tileHeight, color: author?.color };
            const content = <>
              <TileImage id={tile.assetId} rotation={tile.rotation} large={large} name={action ? "" : name} />

              {tile.goalSlotId && <span className="tile-label">{tile.revealed ? tile.assetId === "goal-gold" ? "Жила" : "Порода" : `Камера ${tile.goalSlotId.replace(/^g/, "")}`}</span>}
            </>;
            return action
              ? <button key={key} className={`${className} tile-target`} style={style} title={author ? name : undefined} onClick={() => choose(action)} aria-label={name} aria-pressed={Boolean(selected)}>{content}</button>
              : <div key={key} className={className} style={style} title={name}>{content}</div>;
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
          {last && !byCell.has(cell(last)) && <div className="board-tile last-tile collapsed-tile" style={{ left: last.x * tileWidth, top: last.y * tileHeight }} aria-label="Последний обвал" />}
        </div>
      </div>
      <div className="board-title"><Icon name="lantern" /><h2>{copy.mine}</h2></div>
      <div className="board-controls" aria-label="Управление картой">
        <button className="icon-button" onClick={() => scaleBy(1.22)} aria-label="Приблизить"><Icon name="zoom-in" /></button>
        <button className="icon-button" onClick={() => scaleBy(1 / 1.22)} aria-label="Отдалить"><Icon name="zoom-out" /></button>
        {phone ? <>
          <button className="button secondary" onClick={showOverview} aria-pressed={chosenCamera === "overview"}>Вся шахта</button>
          <button className="button secondary" onClick={() => setCamera(null)}>К ходу</button>
        </> : <>
          <button className="icon-button" onClick={showOverview} aria-label="Показать всё поле"><Icon name="settings" /></button>
          <button className="icon-button" onClick={() => { const origin = tiles.find((tile) => tile.kind === "origin"); if (origin) focusTile(origin); }} aria-label="Ко входу"><Icon name="home" /></button>
          {goals.length > 0 && <button className="icon-button" onClick={() => focusTile(goals[Math.floor(goals.length / 2)])} aria-label="К камерам"><Icon name="gold" /></button>}
          {last && <button className="icon-button" onClick={() => focusTile(last)} aria-label="К последнему ходу"><Icon name="arrow-back" /></button>}
        </>}
      </div>
    </section>
  );
}
