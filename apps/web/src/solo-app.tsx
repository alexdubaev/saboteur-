import { useCallback, useEffect, useRef, useState } from "react";
import { chatSchema, type ChatMessage, type JournalEntry, type WireCommand } from "../../../packages/protocol/src/index.js";
import { corridorArt, logoArt } from "./art.js";
import { Game, type MatchSnapshot } from "./game.js";
import { createSoloMatch, soloBotRange, type SoloMatch } from "./solo-match.js";
import { copy, errorText } from "./text.js";
import { getGoldFinale } from "./turn-presentation.js";
import { Dialog, Icon, Notice, Rules } from "./ui.js";
import { useGameAudio } from "./use-game-audio.js";

type ActiveMatch = { game: SoloMatch; snapshot: MatchSnapshot };

const soundKey = "zoloto.solo-sound";

export function SoloApp() {
  const [botRange] = useState(soloBotRange);
  const [botCount, setBotCount] = useState(botRange.min);
  const { audio, sound, soundActive, enableAudio, toggleSound } = useGameAudio(soundKey);
  const heardSequence = useRef(0);
  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [fullscreenHelp, setFullscreenHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [error, setError] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const appleMobile = /iPhone|iPad|iPod/u.test(navigator.userAgent);
  const fullscreenLabel = fullscreen ? "Выйти из полноэкранного режима" : standalone ? "Режим экрана" : "Во весь экран";

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (!standalone && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return;
      }
    } catch {
      // The browser or its host can reject a fullscreen request.
    }
    setFullscreenHelp(true);
  }

  function start() {
    try {
      const game = createSoloMatch("Старатель", botCount);
      const snapshot = game.snapshot();
      heardSequence.current = snapshot.sequence;
      if (sound) enableAudio(true);
      setError("");
      setChat([]);
      setActive({ game, snapshot });
    } catch {
      setError("Партию не удалось запустить. Попробуйте снова.");
    }
  }

  function menu() {
    setError("");
    setChat([]);
    setActive(null);
  }

  async function sendLocalMessage(text: string): Promise<boolean> {
    const author = active?.snapshot.room.seats[0];
    const parsed = chatSchema.safeParse({ text });
    if (!author || !parsed.success) return false;
    const message = { messageId: crypto.randomUUID(), seatId: author.seatId, name: author.name, text: parsed.data.text, at: new Date().toISOString() };
    setChat((current) => [...current.slice(-99), message]);
    return true;
  }

  async function run(command: WireCommand): Promise<boolean> {
    if (!active) return false;
    const { game } = active;
    try {
      game.command(command);
      if (sound) enableAudio(false);
      setError("");
      setActive({ game, snapshot: game.snapshot() });
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? errorText(failure.message) : "Ход не удался. Попробуйте снова.");
      return false;
    }
  }

  const snapshot = active?.snapshot;
  const playGold = useCallback((event: JournalEntry) => {
    if (!document.hidden) audio.current?.playLatest([event], "", true);
  }, [audio]);
  const ownTurnChanged = useCallback((turnKey: string | null) => audio.current?.setOwnTurn(turnKey), [audio]);

  useEffect(() => {
    if (!snapshot || snapshot.sequence <= heardSequence.current) return;
    const previous = heardSequence.current;
    heardSequence.current = snapshot.sequence;
    const events = snapshot.journal.filter(({ sequence }) => sequence > previous);
    const gold = getGoldFinale(snapshot, events);
    audio.current?.playLatest(
      gold ? events.filter(({ type }) => type === "PLAY_TUNNEL") : events,
      snapshot.room.mySeatId,
      snapshot.match.outcome?.reason === "ore",
    );
  }, [snapshot, audio]);

  useEffect(() => {
    if (!active?.game.hasBotTurn()) return;
    const { game } = active;
    const timeout = window.setTimeout(() => {
      try {
        if (!game.botTurn()) return;
        const snapshot = game.snapshot();
        setActive((current) => current?.game === game ? { game, snapshot } : current);
      } catch {
        setError("Бот не смог сделать ход. Начните новую партию.");
      }
    }, active.snapshot.match.phase === "TURN" ? 320 : 100);
    return () => window.clearTimeout(timeout);
  }, [active]);

  const soundControl = <button type="button" className="icon-button" data-sound-toggle aria-label={soundActive ? copy.soundOn : copy.soundOff}
    title={soundActive ? copy.soundOn : copy.soundOff} aria-pressed={soundActive} onClick={toggleSound}>
    <Icon name="volume" className={soundActive ? "" : "muted-icon"} />
  </button>;

  return <div className="solo-app">
    <header className="site-header">
      <div className="site-name"><Icon name="lantern" />{copy.title}</div>
      <div className="header-actions">
        {!active && soundControl}
        <button className="button secondary header-rules" onClick={() => setRulesOpen(true)}><Icon name="info" />{copy.rules}</button>
      </div>
    </header>
    {active
      ? <Game key={active.snapshot.match.matchId} snapshot={{ ...active.snapshot, chat }} run={run} error={error} pending={false} lobby={menu} exit={menu}
          sendLocalMessage={sendLocalMessage} openRules={() => setRulesOpen(true)} soundControl={soundControl} onGoldReveal={playGold} onTurnChange={ownTurnChanged}
          fullscreenControl={{ label: fullscreenLabel, active: fullscreen, toggle: () => void toggleFullscreen() }} />
      : <main className="home-stage">
        <div className="home-copy">
          <div className="home-inner">
            <p className="eyebrow">Тестовая игра с ботами</p>
            <h1 className="home-logo"><img src={logoArt} width={1440} height={488} alt={copy.title} /></h1>
            <p className="lead">Проложите путь к золотой камере. Среди участников может быть предатель.</p>
            <div className="entry-form">
              <Notice text={error} />
              <div className="solo-start-controls">
                <label>Боты
                  <select aria-label="Число ботов" value={botCount} onChange={(event) => setBotCount(Number(event.currentTarget.value))}>
                    {Array.from({ length: botRange.max - botRange.min + 1 }, (_, index) => {
                      const count = botRange.min + index;
                      return <option key={count} value={count}>{count}</option>;
                    })}
                  </select>
                </label>
                <button className="button primary entry-submit" onClick={start}><Icon name="pickaxe" />Начать игру</button>
              </div>
              <button className="button secondary entry-fullscreen" onClick={() => void toggleFullscreen()}>{fullscreenLabel}</button>
              <p className="soft-note">Партия проходит в этой вкладке и сбрасывается при обновлении.</p>
            </div>
          </div>
        </div>
        <figure className="home-art">
          <img src={corridorArt} alt="" fetchPriority="high" width={1254} height={1254} />
          <figcaption><Icon name="lantern" /><span>Вход в шахту</span></figcaption>
        </figure>
      </main>}
    {rulesOpen && <Rules close={() => setRulesOpen(false)} />}
    {fullscreenHelp && <Dialog title={standalone ? "Режим экрана" : "Во весь экран"} close={() => setFullscreenHelp(false)}>
      {standalone ? <p>Игра открыта как отдельное веб-приложение. Чтобы вернуться к виду с панелями браузера, откройте эту же ссылку в обычной вкладке.</p>
        : appleMobile ? <p>Откройте игру в Safari. Нажмите «Поделиться», выберите «На экран “Домой”» и включите «Открывать как веб-приложение», если этот пункт есть. Затем запустите игру с её значка.</p>
        : <p>Откройте игру в отдельной вкладке браузера и нажмите «Во весь экран» ещё раз.</p>}
    </Dialog>}
  </div>;
}
