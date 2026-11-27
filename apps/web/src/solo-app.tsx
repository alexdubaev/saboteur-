import { useEffect, useState } from "react";
import type { WireCommand } from "../../../packages/protocol/src/index.js";
import { corridorArt, logoArt } from "./art.js";
import { Game, type MatchSnapshot } from "./game.js";
import { createSoloMatch, type SoloMatch } from "./solo-match.js";
import { copy, errorText } from "./text.js";
import { Icon, Notice, Rules } from "./ui.js";

type ActiveMatch = { game: SoloMatch; snapshot: MatchSnapshot };

export function SoloApp() {
  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [error, setError] = useState("");

  function start() {
    try {
      const game = createSoloMatch("Старатель");
      setError("");
      setActive({ game, snapshot: game.snapshot() });
    } catch {
      setError("Партию не удалось запустить. Попробуйте снова.");
    }
  }

  function menu() {
    setError("");
    setActive(null);
  }

  async function run(command: WireCommand): Promise<boolean> {
    if (!active) return false;
    const { game } = active;
    try {
      game.command(command);
      setError("");
      setActive({ game, snapshot: game.snapshot() });
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? errorText(failure.message) : "Ход не удался. Попробуйте снова.");
      return false;
    }
  }

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

  return <>
    <header className="site-header">
      <div className="site-name"><Icon name="lantern" />{copy.title}</div>
      <button className="button secondary header-rules" onClick={() => setRulesOpen(true)}><Icon name="info" />{copy.rules}</button>
    </header>
    {active
      ? <Game key={active.snapshot.match.matchId} snapshot={active.snapshot} run={run} error={error} pending={false} lobby={menu} exit={menu} />
      : <main className="home-stage">
        <div className="home-copy">
          <div className="home-inner">
            <p className="eyebrow">Тестовая игра с ботами</p>
            <h1 className="home-logo"><img src={logoArt} width={1440} height={488} alt={copy.title} /></h1>
            <p className="lead">Проложите путь к золотой камере. Среди участников может быть предатель.</p>
            <div className="entry-form">
              <Notice text={error} />
              <button className="button primary entry-submit" onClick={start}><Icon name="pickaxe" />Играть с двумя ботами</button>
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
  </>;
}
