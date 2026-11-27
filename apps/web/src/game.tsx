import { useEffect, useState, useSyncExternalStore } from "react";
import type { CardCommand, PlayerView, Position, Rotation } from "../../../packages/game-core/src/types.js";
import type { RoomSnapshot } from "../../../packages/protocol/src/index.js";
import { cardArt } from "./art.js";
import { Board, type TunnelAuthor } from "./board.js";
import type { RunCommand } from "./lobby.js";
import { Messages } from "./messages.js";
import { actions, cardLabels, copy, profileFor, reasons, roles, roundWinners, tools } from "./text.js";
import { Avatar, Dialog, Icon, Notice } from "./ui.js";

export type MatchSnapshot = RoomSnapshot & { match: PlayerView };
type Selection = { revision: number; instanceId: string; rotation: Rotation; staged: CardCommand | null };
type ScoutModal = { roundNo: number; goalSlotId?: string };
const seatColors = ["#62d9ff", "#fbb364", "#a7e86a", "#f890cc", "#baa0ff", "#52e2bb", "#f7e26d", "#ff8282", "#91aaff", "#eee2cf"];
const phoneLayout = "(max-width: 620px), (orientation: landscape) and (max-height: 520px)";
const shortCardLabels: Record<string, string> = {
  straight: "Прямая", turn: "Поворот", tee: "Развилка", cross: "Крест",
  dead: "Тупик", separated: "Тупики", break: "Поломка", repair: "Ремонт",
};

function subscribeToPhoneLayout(update: () => void) {
  const query = window.matchMedia(phoneLayout);
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}

function Deadline({ at }: { at: string }) {
  const remaining = () => Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    setSeconds(remaining());
    const interval = setInterval(() => setSeconds(remaining()), 250);
    return () => clearInterval(interval);
  }, [at]);
  return <span className={`deadline${seconds <= 8 ? " deadline-urgent" : ""}`} aria-label={`Осталось секунд: ${seconds}`}>{seconds} с</span>;
}

function RoleCard({ snapshot, mandatory, close, run, pending, error }: { snapshot: MatchSnapshot; mandatory: boolean; close: () => void; run: RunCommand; pending: boolean; error: string }) {
  const role = snapshot.match.self.role;
  const deadline = snapshot.room.deadlineAt;
  const profile = profileFor(snapshot.match.requiredOre);
  if (!role) return null;
  return (
    <Dialog title={copy.role} close={mandatory ? undefined : close}>
      <div className="role-card">
        <img className="role-art" src={cardArt("role-" + role, "standard")} width={512} height={768} alt="" />
        <div>
          <span className="eyebrow">Видно только вам</span>
          <h3>{roles[role]}</h3>
          <p>{profile.roleGoals[role]}</p>
          {mandatory && <>
            {deadline && <p><Deadline key={deadline} at={deadline} /></p>}
            <button className="button primary" disabled={pending} onClick={() => void run({ type: "ACK_ROLE" })}>Роль понятна</button>
          </>}
        </div>
      </div>
      <Notice text={error} />
    </Dialog>
  );
}

function ScoutNotes({ snapshot, goalSlotId, close }: { snapshot: MatchSnapshot; goalSlotId?: string; close: () => void }) {
  const results = snapshot.match.self.scoutResults.filter((result) => !goalSlotId || result.goalSlotId === goalSlotId);
  return (
    <Dialog title="Моя разведка" close={close}>
      <p>Видно только вам.</p>
      {results.length === 0 ? <p role="status">Ждём результат разведки…</p> : <ul className="result-grid">
        {results.map((scout) => (
          <li key={scout.goalSlotId}>
            <img className="summary-art" src={cardArt(scout.assetId)} width={256} height={384} alt="" />
            <strong>Камера {scout.goalSlotId.replace(/^g/, "")}</strong>
            <span>{scout.content === "ore" ? "Золотая жила" : "Пустая порода"}</span>
          </li>
        ))}
      </ul>}
    </Dialog>
  );
}

function RoundResults({ snapshot, run, pending, error }: { snapshot: MatchSnapshot; run: RunCommand; pending: boolean; error: string }) {
  const { match, room } = snapshot;
  if (!match.outcome) return null;
  const acknowledged = match.summaryAcknowledged.includes(room.mySeatId);
  const reason = match.outcome.reason === "ore" ? profileFor(match.requiredOre).oreReason : reasons[match.outcome.reason];
  return (
    <Dialog title={`Итоги раунда ${match.roundNo}`}>
      <p className="eyebrow">{roundWinners[match.outcome.winner]}</p>
      <p>{reason}.{match.requiredOre > 1 && ` Со входом связано ${match.outcome.connectedOre} из ${match.requiredOre} золотых жил.`}</p>
      <ul className="result-grid">
        {match.board.filter((tile) => tile.kind === "goal" && tile.revealed).map((tile) => (
          <li key={tile.goalSlotId}>
            <img className="summary-art" src={cardArt(tile.assetId)} width={256} height={384} alt="" />
            <strong>Камера {tile.goalSlotId?.replace(/^g/, "")}</strong>
            <span>{tile.assetId === "goal-gold" ? "Золотая жила" : "Пустая порода"}</span>
          </li>
        ))}
      </ul>
      <ul className="revealed-roles" aria-label="Роли участников">
        {match.seats.filter((seat) => seat.role).map((seat) => <li key={seat.seatId}>{room.seats.find((member) => member.seatId === seat.seatId)?.name} · {seat.role && roles[seat.role]}</li>)}
      </ul>
      <div className="round-reward">
        {match.self.roundScore > 0 && <img className="reward-art" src={cardArt(({ 1: "reward-gold-one", 2: "reward-gold-two", 3: "reward-gold-three" } as Record<number, string>)[Math.min(match.self.roundScore, 3)])} width={256} height={384} alt="" />}
        <div><strong>Ваше начисление +{match.self.roundScore}</strong><small>Личный счёт: {match.self.score}</small></div>
      </div>
      {acknowledged ? <p role="status">Ждём подтверждения остальных…</p> : <button className="button primary" disabled={pending} onClick={() => void run({ type: "ACK_SUMMARY" })}>{copy.next}</button>}
      <Notice text={error} />
    </Dialog>
  );
}

function MatchResults({ snapshot, run, pending, error, lobby, solo }: { snapshot: MatchSnapshot; run: RunCommand; pending: boolean; error: string; lobby: () => void; solo: boolean }) {
  const { match, room } = snapshot;
  const abandoned = match.phase === "ABANDONED";
  const winners = new Set(match.winnerSeatIds);
  const scores = [...(match.finalScores ?? [])].sort((a, b) => b.score - a.score);
  return (
    <Dialog title={abandoned ? "Экспедиция остановлена" : "Итоги экспедиции"}>
      {!abandoned && winners.size === 0 && <p>В матче нет победителя</p>}
      {winners.size > 1 && <p>Ничья за первое место</p>}
      <ol className="scores">
        {scores.map(({ seatId, score }) => {
          const seat = room.seats.find((member) => member.seatId === seatId);
          return <li key={seatId}><span>{seat?.name ?? "Участник"}{winners.has(seatId) && <b className="winner">Победитель</b>}</span><strong>{score}</strong></li>;
        })}
      </ol>
      <div className="dialog-actions">
        <button className="button secondary" onClick={lobby}>{solo ? "В меню" : "В лобби"}</button>
        {room.hostSeatId === room.mySeatId && <button className="button primary" disabled={pending} onClick={() => void run({ type: "REPLAY" })}>Играть снова</button>}
      </div>
      <Notice text={error} />
    </Dialog>
  );
}

function Crew({ snapshot, authors, compact = false }: { snapshot: MatchSnapshot; authors: ReadonlyMap<string, TunnelAuthor>; compact?: boolean }) {
  const { room, match } = snapshot;
  return (
    <section className={`panel match-crew${compact ? " phone-crew" : ""}`} aria-label={copy.crew}>
      {!compact && <div className="panel-heading"><h2>{copy.crew}</h2><span>{room.seats.length}</span></div>}
      <ul>
        {room.seats.map((seat) => {
          const info = match.seats.find(({ seatId }) => seatId === seat.seatId);
          const active = seat.seatId === match.turnSeatId;
          const own = seat.seatId === room.mySeatId;
          return (
            <li key={seat.seatId} className={active ? "current-seat" : ""}>
              {!compact && <Avatar {...seat} />}
              <div className="seat-name">
                <strong><span className="seat-color" style={{ backgroundColor: authors.get(seat.seatId)?.color }} aria-hidden="true" />{own && compact ? "Вы" : seat.name}</strong>
                {!compact && <small>{[own && "Вы", active && "Ходит", seat.bot && "Бот", !seat.present && !seat.bot && "Нет связи"].filter(Boolean).join(" · ") || "В шахте"}</small>}
              </div>
              <div className="seat-icons">
                <span className="seat-cards" aria-label={`Карт в руке: ${info?.handCount ?? 0}`}><Icon name="cards" />{info?.handCount ?? 0}</span>
                {info?.brokenTools.map((tool) => <span key={tool} className="broken-tool" title={`Поломка: ${tools[tool]}`} aria-label={`Поломка: ${tools[tool]}`}><Icon name={tool} /><b aria-hidden="true">×</b></span>)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function messageForMove(move: CardCommand, snapshot: MatchSnapshot) {
  if ("x" in move) return `${actions[move.type]} · ${move.x}, ${move.y}`;
  if (move.type === "PLAY_SCOUT") return `${actions[move.type]} ${move.goalSlotId.replace(/^g/, "")}`;
  if ("targetSeatId" in move) {
    const name = snapshot.room.seats.find((seat) => seat.seatId === move.targetSeatId)?.name ?? "Участник";
    return move.type === "PLAY_REPAIR" ? `${name} · ${tools[move.tool]}` : name;
  }
  return actions.DISCARD;
}

function lastBoardMove(snapshot: MatchSnapshot): Position | null {
  for (let index = snapshot.journal.length - 1; index >= 0; index--) {
    const entry = snapshot.journal[index];
    if (entry.type === "ROUND_SETUP") return null;
    if ((entry.type === "PLAY_TUNNEL" || entry.type === "PLAY_COLLAPSE") && typeof entry.data?.x === "number" && typeof entry.data?.y === "number") {
      return { x: entry.data.x, y: entry.data.y };
    }
  }
  return null;
}

export function Game({ snapshot, pending, error, run, send, sendLocalMessage, lobby, exit, openRules, fullscreenControl }: { snapshot: MatchSnapshot; pending: boolean; error: string; run: RunCommand; send?: (message: string) => Promise<boolean>; sendLocalMessage?: (message: string) => Promise<boolean>; lobby: () => void; exit: () => void; openRules?: () => void; fullscreenControl?: { label: string; active: boolean; toggle: () => void } }) {
  const { match, room } = snapshot;
  const solo = !send;
  const phone = useSyncExternalStore(subscribeToPhoneLayout, () => window.matchMedia(phoneLayout).matches) && solo;
  const leaveLabel = solo ? "Выйти из партии" : copy.leave;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modal, setModal] = useState<"role" | "leave" | ScoutModal | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const selected = selection?.revision === match.revision ? selection : null;
  const me = match.turnSeatId === room.mySeatId && match.phase === "TURN";
  const handCard = match.self.hand.find((card) => card.instanceId === selected?.instanceId);
  const moves = match.moves.filter((move): move is CardCommand => "instanceId" in move && move.instanceId === selected?.instanceId);
  const tunnel = handCard?.typeId.startsWith("tunnel-") ?? false;
  const boardMoves = moves.filter((move): move is Extract<CardCommand, { type: "PLAY_TUNNEL" | "PLAY_COLLAPSE" | "PLAY_SCOUT" }> =>
    (move.type === "PLAY_TUNNEL" && move.rotation === selected?.rotation) || move.type === "PLAY_COLLAPSE" || move.type === "PLAY_SCOUT");
  const seats = moves.filter((move) => move.type === "PLAY_BREAK" || move.type === "PLAY_REPAIR");
  const discard = moves.find((move) => move.type === "DISCARD");
  const choose = (move: CardCommand) => {
    if (selected && !pending) setSelection({ ...selected, staged: move });
  };
  const rotate = () => {
    if (!selected || !tunnel || pending) return;
    const rotation = selected.rotation === 0 ? 180 : 0;
    const staged = selected.staged;
    const next = staged?.type === "PLAY_TUNNEL"
      ? moves.find((move) => move.type === "PLAY_TUNNEL" && move.rotation === rotation && move.x === staged.x && move.y === staged.y)
      : staged;
    setSelection({ ...selected, rotation, staged: next ?? null });
  };
  const confirm = async () => {
    const move = selected?.staged;
    if (!move || !await run(move)) return;
    setSelection(null);
    if (move.type === "PLAY_SCOUT") setModal({ roundNo: match.roundNo, goalSlotId: move.goalSlotId });
  };
  const scout = modal && typeof modal === "object" && modal.roundNo === match.roundNo ? modal : null;
  const names = new Map(room.seats.map((seat) => [seat.seatId, seat.name]));
  const authors = new Map(match.seats.map(({ seatId }, index) =>
    [seatId, { name: names.get(seatId) ?? "Участник", color: seatColors[index] }] as const));
  const current = room.seats.find((seat) => seat.seatId === match.turnSeatId);
  const rolePending = match.phase === "ROLE_REVEAL" && !match.self.roleAcknowledged;
  const summary = match.phase === "ROUND_SUMMARY";
  const final = match.phase === "MATCH_FINISHED" || match.phase === "ABANDONED";
  const actorLabel = me ? "Ваш ход" : current ? `Ходит ${current.name}` : match.phase === "ROLE_REVEAL" ? "Участники смотрят роли" : "Подготовка шахты";
  const linkedOre = match.board.filter((tile) => tile.kind === "goal" && tile.revealed && tile.reachable && tile.assetId === "goal-gold").length;
  const profile = profileFor(match.requiredOre);
  const roleName = match.self.role ? roles[match.self.role] : null;
  const isHost = room.hostSeatId === room.mySeatId;
  const deadline = room.deadlineAt;
  const staged = selected?.staged ?? null;
  const hint = !selected ? (me ? "Выберите карту для хода." : "Дождитесь своего хода.")
    : !me ? "Карту можно сыграть в свой ход."
    : seats.length ? "Выберите участника и инструмент, если доступен выбор."
    : boardMoves.length ? "Выберите подсвеченную клетку на карте."
    : tunnel && moves.some((move) => move.type === "PLAY_TUNNEL") ? "Поверните карту, чтобы увидеть доступные клетки."
    : "Для карты нет подходящих целей. Её можно сбросить в закрытую.";
  const moveHint = staged ? messageForMove(staged, snapshot) : hint;
  const phoneTargets = [...seats, ...boardMoves.filter((move) => move.type === "PLAY_SCOUT")];
  const counts = <ul className="match-counts">
    <li title={profile.roleGoals.prospector}><Icon name="gold" /><span>{profile.progress} <b>{linkedOre}/{match.requiredOre}</b></span></li>
    <li><Icon name="pickaxe" /><span>Ходы <b>{match.turnNumber}{match.maxTurns !== null ? `/${match.maxTurns}` : ""}</b></span></li>
    <li><Icon name="cards" /><span>Колода <b>{match.deckCount}</b></span></li>
    {deadline && <li><Deadline key={deadline} at={deadline} /></li>}
  </ul>;
  const cards = () => match.self.hand.map((card) => {
    const label = cardLabels[card.typeId] ?? "Карта";
    const caption = phone ? shortCardLabels[card.typeId.split("-", 2)[1]] ?? label : label;
    const active = card.instanceId === selected?.instanceId;
    return <button key={card.instanceId} className={`hand-card${active ? " selected-card" : ""}`} aria-label={label} aria-pressed={active} disabled={pending} title={label}
      onClick={() => setSelection(active ? null : { revision: match.revision, instanceId: card.instanceId, rotation: 0, staged: null })}>
      <img src={cardArt(card.assetId)} width={256} height={384} alt="" draggable={false}
        style={{ transform: active && tunnel ? `rotate(${selected.rotation}deg)` : undefined }} />
      <span>{caption}</span>
    </button>;
  });
  const confirmButton = <button className="button primary" aria-label={copy.confirm} disabled={pending || !staged} onClick={() => void confirm()}>
    {!phone && <Icon name="confirm" />}{pending ? "Ожидаем…" : phone ? "Готово" : copy.confirm}
  </button>;
  const actionsPanel = (phone || selected) && <div className="hand-actions" aria-label="Подготовка хода">
    {!phone && seats.length > 0 && <div className="seat-targets" aria-label="Доступные цели">
      <strong>{actions[seats[0].type]}</strong>
      {seats.map((move) => <button className="button secondary" key={JSON.stringify(move)} aria-pressed={JSON.stringify(staged) === JSON.stringify(move)} disabled={pending} onClick={() => choose(move)}>{messageForMove(move, snapshot)}</button>)}
    </div>}
    <div className="move-buttons">
      {(phone || tunnel) && <button className={phone ? "button secondary" : "icon-button"} aria-label="Повернуть на 180°" disabled={pending || !me || !tunnel} onClick={rotate}>{phone ? "Повернуть" : <Icon name="rotate" />}</button>}
      {(phone || discard) && <button className="button secondary" aria-label={actions.DISCARD} disabled={pending || !discard} onClick={() => { if (discard) choose(discard); }}>{phone ? "Сбросить" : actions.DISCARD}</button>}
      <button className={phone ? "button secondary" : "icon-button"} aria-label={copy.cancel} disabled={pending || !selected} onClick={() => setSelection(null)}>{phone ? "Отмена" : <Icon name="close" />}</button>
      {(phone || staged) && confirmButton}
    </div>
  </div>;

  return (
    <main className={`game-shell${solo ? " solo-game" : ""}${phone ? " phone-game" : ""}`} data-testid="room-state" data-room={room.roomId} data-match={match.matchId} data-revision={match.revision}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLDialogElement || typeof modal === "string" || scout || rolePending || summary || final) return;
        if (event.key === "Escape" && selected) setSelection(null);
        if (event.key.toLowerCase() === "r" && selected && tunnel) rotate();
      }}>
      {phone ? <header className="phone-table-header">
        <h1 className="phone-turn" aria-live="polite">{actorLabel}</h1>
        <dl className="phone-score" aria-label="Счётчики партии">
          <div><dt>Раунд</dt><dd>{match.roundNo}/{match.rounds}</dd></div>
          <div><dt>Ход</dt><dd>{match.turnNumber}{match.maxTurns !== null ? `/${match.maxTurns}` : ""}</dd></div>
          <div><dt>Колода</dt><dd>{match.deckCount}</dd></div>
          <div><dt>{profile.progress}</dt><dd>{linkedOre}/{match.requiredOre}</dd></div>
        </dl>
        <Crew snapshot={snapshot} authors={authors} compact />
        <div className="phone-utilities">
          <button className="button secondary phone-role" title={copy.role} aria-haspopup="dialog" disabled={!roleName} onClick={() => setModal("role")}>
            <span className="phone-role-label">Роль</span>
            {roleName && <span className="phone-role-name">{roleName}</span>}
          </button>
          {fullscreenControl && <button className="button secondary" aria-label={fullscreenControl.label} aria-pressed={fullscreenControl.active}
            onClick={fullscreenControl.toggle}>{fullscreenControl.active ? "Свернуть" : "Экран"}</button>}
          {match.self.scoutResults.length > 0 && <button className="icon-button" aria-label="Моя разведка" onClick={() => setModal({ roundNo: match.roundNo })}><Icon name="scout" /></button>}
          {openRules && <button className="icon-button" aria-label={copy.rules} onClick={openRules}><Icon name="info" /></button>}
          <button className="icon-button" aria-label={leaveLabel} onClick={() => setModal("leave")}><Icon name="arrow-back" /></button>
        </div>
      </header> : <header className="match-header">
        <div className="match-progress">
          <span className="eyebrow">Раунд {match.roundNo} из {match.rounds}</span>
          <h1 aria-live="polite">{actorLabel}</h1>
        </div>
        {counts}
        <div className="match-tools">
          {fullscreenControl && <button className="button secondary" onClick={fullscreenControl.toggle}>{fullscreenControl.label}</button>}
          <button className="button secondary" title={copy.role} disabled={!roleName} onClick={() => setModal("role")}><Icon name="lock" />{solo && roleName ? roleName : copy.role}</button>
          {match.self.scoutResults.length > 0 && <button className="button secondary" aria-label="Моя разведка" onClick={() => setModal({ roundNo: match.roundNo })}><Icon name="scout" />Разведка</button>}
          {send && <button className="icon-button mobile-messages" aria-label={showMessages ? "Скрыть чат и журнал" : "Открыть чат и журнал"} aria-expanded={showMessages} onClick={() => setShowMessages(!showMessages)}><Icon name="chat" /></button>}
          <button className="icon-button" aria-label={leaveLabel} onClick={() => setModal("leave")}><Icon name="arrow-back" /></button>
        </div>
      </header>}
      <Notice text={error} />
      <div className="table-layout">
        <Board key={match.matchId} tiles={match.board} authors={authors} moves={boardMoves} staged={staged} asset={handCard?.assetId} last={lastBoardMove(snapshot)} choose={choose}
          phone={phone} />
        {!phone && <aside className="table-side">
          <Crew snapshot={snapshot} authors={authors} />
          {send && <div className={`match-messages${showMessages ? " show-messages" : ""}`}><Messages snapshot={snapshot} send={send} authors={authors} compact /></div>}
          {sendLocalMessage && <Messages snapshot={snapshot} send={sendLocalMessage} authors={authors} split local />}
        </aside>}
        <section className="panel hand" aria-label="Ваша рука">
          {phone ? <>
            <div className="phone-hand-header" aria-live="polite" title={moveHint}>
              <h2>Рука <span>{match.self.hand.length}</span></h2>
              <span>{handCard ? cardLabels[handCard.typeId] ?? "Карта" : me ? "Выберите карту" : "Ход соперника"}</span>
              {phoneTargets.length > 0 && <select aria-label="Цель карты" disabled={pending}
                value={phoneTargets.findIndex((move) => JSON.stringify(move) === JSON.stringify(staged))}
                onChange={(event) => { const target = phoneTargets[Number(event.currentTarget.value)]; if (target) choose(target); }}>
                <option value={-1} disabled>Выбрать цель</option>
                {phoneTargets.map((move, index) => <option value={index} key={JSON.stringify(move)}>
                  {move.type === "PLAY_SCOUT" ? `Камера ${move.goalSlotId.replace(/^g/, "")}` : messageForMove(move, snapshot)}
                </option>)}
              </select>}
            </div>
            <div className="hand-cards">{cards()}</div>
            {actionsPanel}
          </> : <>
            <div className="hand-heading"><div><p className="eyebrow">Личные карты</p><h2>Ваша рука <span>{match.self.hand.length}</span></h2></div><p className="soft-note" aria-live="polite">{moveHint}</p></div>
            <div className="hand-body"><div className="hand-cards">{cards()}</div>{actionsPanel}</div>
          </>}
        </section>
        {phone && sendLocalMessage && <Messages snapshot={snapshot} send={sendLocalMessage} authors={authors} split local />}
      </div>
      {rolePending || (modal === "role" && !summary && !final) ? <RoleCard snapshot={snapshot} mandatory={rolePending} close={() => setModal(null)} run={run} pending={pending} error={error} /> : null}
      {!rolePending && !final && scout && <ScoutNotes snapshot={snapshot} goalSlotId={scout.goalSlotId} close={() => setModal(null)} />}
      {!rolePending && !summary && !final && modal === "leave" && <Dialog title={leaveLabel} close={() => setModal(null)}>
        <p>{solo ? "Если выйти сейчас, партия завершится." : "Вернитесь на этот адрес, чтобы снова занять своё место."}</p>
        <div className="dialog-actions"><button className="button secondary" onClick={exit}>В меню</button>
        {!solo && isHost && <button className="button secondary" disabled={pending} onClick={async () => { if (await run({ type: "ABANDON" })) setModal(null); }}>Остановить экспедицию</button>}</div>
        <Notice text={error} />
      </Dialog>}
      {summary && !scout && <RoundResults snapshot={snapshot} run={run} pending={pending} error={error} />}
      {final && <MatchResults snapshot={snapshot} run={run} pending={pending} error={error} lobby={lobby} solo={solo} />}
    </main>
  );
}
