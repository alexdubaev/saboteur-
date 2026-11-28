import type { JournalEntry } from "../../../packages/protocol/src/index.js";
import ambienceUrl from "./audio/mine-ambience.mp3?url";
import mineSoundsUrl from "./audio/mine.mp3?url";
import startUrl from "./audio/mine-start.mp3?url";
import turnUrl from "./audio/mine-turn.mp3?url";
import bank from "./audio/mine.json" with { type: "json" };
import tonesUrl from "./audio/mine-tones.mp3?url";
import tones from "./audio/mine-tones.json" with { type: "json" };

const sounds = { ...bank, turn: [[bank.minePick[0][0] + .168, .32]] };

type SoundName = keyof typeof sounds;
type Cue = { sound: SoundName; volume: number };

const cues: Partial<Record<string, SoundName>> = {
  PLAY_TUNNEL: "tunnel",
  PLAY_BREAK: "break",
  PLAY_REPAIR: "repair",
  PLAY_COLLAPSE: "collapse",
  PLAY_SCOUT: "scout",
  DISCARD: "discard",
  GOAL_REVEALED: "reveal",
  ROUND_RESOLVED: "round",
};
const start: Cue = { sound: "start", volume: 1 };
const turnAlert: Cue = { sound: "turn", volume: .78 };
const botVolume = .43;
const background: readonly Cue[] = [
  { sound: "minePick", volume: .34 },
  { sound: "mineCart", volume: .38 },
  { sound: "minePick", volume: .34 },
  { sound: "mineVoices", volume: .35 },
];
let samplesRequest: Promise<ArrayBuffer> | null = null;

function loadSamples() {
  return samplesRequest ??= fetch(mineSoundsUrl).then((response) => {
    if (!response.ok) throw new Error("Mine sound effects are unavailable");
    return response.arrayBuffer();
  }).catch((error) => {
    samplesRequest = null;
    throw error;
  });
}

function createEffectsAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  const lastVariant = new Map<SoundName, number>();
  let resuming: Promise<void> | null = null;
  let loading: Promise<void> | null = null;
  let loadingTones: Promise<void> | null = null;
  let buffer: AudioBuffer | null = null;
  let tonalBuffer: AudioBuffer | null = null;
  let queuedCue: Cue | null = null;
  let notifiedTurn: string | null = null;
  let turnQueued = false;
  let ambience = false;
  let detail: AudioBufferSourceNode | null = null;
  let detailTimer: number | undefined;
  let nextDetail = 0;

  function playTone(name: keyof typeof tones, volume: number, when: number) {
    if (!tonalBuffer) return;
    const [offset, duration] = tones[name];
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = tonalBuffer;
    gain.gain.value = volume;
    source.connect(gain).connect(master);
    source.addEventListener("ended", () => { source.disconnect(); gain.disconnect(); }, { once: true });
    source.start(when, offset, duration);
  }

  function playClip({ sound, volume }: Cue, when = 0) {
    if (!buffer) return;
    const variants = sounds[sound];
    const last = lastVariant.get(sound);
    // Choose freely on the first play, then exclude the previous variation.
    const index = last === undefined ? Math.floor(Math.random() * variants.length) :
      (last + 1 + Math.floor(Math.random() * (variants.length - 1))) % variants.length;
    lastVariant.set(sound, index);
    const [offset, duration] = variants[index];
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    const pan = sound === "mineCart" && typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    if (pan) {
      const direction = Math.random() < .5 ? -1 : 1;
      pan.pan.setValueAtTime(.65 * direction, context.currentTime);
      pan.pan.linearRampToValueAtTime(-.65 * direction, context.currentTime + duration);
      gain.connect(pan).connect(master);
    } else {
      gain.connect(master);
    }
    source.addEventListener("ended", () => {
      if (detail === source) detail = null;
      source.disconnect();
      gain.disconnect();
      pan?.disconnect();
    }, { once: true });
    source.start(when, offset, duration);
    if (sound === "start" || sound === "reveal" || sound === "gold" || sound === "round") {
      playTone(sound, volume, when);
    }
    return { source, duration };
  }

  function playQueued() {
    if (!buffer || context.state !== "running" || master.gain.value === 0) return;
    if (queuedCue) {
      const cue = queuedCue;
      queuedCue = null;
      playClip(cue);
    }
    if (turnQueued) {
      turnQueued = false;
      playClip(turnAlert, context.currentTime + .16);
      playClip(turnAlert, context.currentTime + .46);
      playTone("turn", .8, context.currentTime + .16);
    }
  }

  function scheduleDetail(delay: number) {
    detailTimer = window.setTimeout(() => {
      detailTimer = undefined;
      if (!ambience || context.state !== "running") return;
      const clip = playClip(background[nextDetail]);
      detail = clip?.source ?? null;
      nextDetail = (nextDetail + 1) % background.length;
      scheduleDetail((clip?.duration ?? 0) * 1000 + 4600 + Math.random() * 4400);
    }, delay);
  }

  function syncAmbience() {
    if (!ambience || !buffer || master.gain.value === 0 || context.state !== "running") {
      window.clearTimeout(detailTimer);
      detailTimer = undefined;
      detail?.stop();
      detail = null;
      return;
    }
    if (detailTimer === undefined) scheduleDetail(1200 + Math.random() * 1050);
  }

  context.addEventListener("statechange", () => {
    playQueued();
    syncAmbience();
  });

  function prepareSamples() {
    if (!buffer && !loading) {
      loading = loadSamples()
        .then((bytes) => context.decodeAudioData(bytes.slice(0)))
        .then((decoded) => { buffer = decoded; playQueued(); syncAmbience(); })
        .catch(() => { queuedCue = null; })
        .finally(() => { loading = null; });
    }
    if (!tonalBuffer && !loadingTones) {
      loadingTones = fetch(tonesUrl).then((response) => {
        if (!response.ok) throw new Error("Tonal sounds are unavailable");
        return response.arrayBuffer();
      }).then((bytes) => context.decodeAudioData(bytes))
        .then((decoded) => { tonalBuffer = decoded; })
        .catch(() => { /* Optional: retry on a later resume. */ })
        .finally(() => { loadingTones = null; });
    }
  }

  return {
    setEnabled(enabled: boolean) {
      master.gain.value = enabled ? .54 : 0;
      if (!enabled) {
        queuedCue = null;
        turnQueued = false;
      }
      syncAmbience();
    },
    setAmbience(active: boolean) {
      ambience = active;
      syncAmbience();
    },
    async resume(preview: boolean) {
      if (preview) queuedCue ??= start;
      prepareSamples();
      if (context.state !== "running") {
        // An autoplay attempt can stay pending until a trusted gesture retries resume().
        const attempt = context.resume();
        resuming = attempt;
        try { await attempt; } catch {
          if (resuming === attempt) queuedCue = null;
          return;
        } finally {
          if (resuming === attempt) resuming = null;
        }
      }
      playQueued();
      syncAmbience();
    },
    setOwnTurn(turnKey: string | null) {
      if (turnKey && turnKey === notifiedTurn) return;
      if (turnKey) notifiedTurn = turnKey;
      turnQueued = turnKey !== null && master.gain.value > 0;
      playQueued();
    },
    playLatest(events: readonly JournalEntry[], ownSeatId: string, foundGold: boolean) {
      if (master.gain.value === 0 || (context.state !== "running" && !resuming)) return;
      const event = events.findLast(({ type }) => cues[type] !== undefined);
      if (!event) return;
      const roundEnd = event.type === "ROUND_RESOLVED";
      const bot = !roundEnd && event.actorSeatId !== null && event.actorSeatId !== ownSeatId;
      queuedCue = {
        sound: roundEnd && foundGold ? "gold" : cues[event.type]!,
        volume: bot ? botVolume : 1,
      };
      playQueued();
    },
  };
}

export function createGameAudio() {
  const background = new Audio(ambienceUrl);
  background.loop = true;
  let effects: ReturnType<typeof createEffectsAudio> | undefined;
  try {
    if (typeof AudioContext !== "undefined") effects = createEffectsAudio();
  } catch {
    // A media element can still play the ambience and alerts when Web Audio is unavailable.
  }
  const fallback = effects ? undefined : new Audio();
  let fallbackSource: string | undefined;
  let seenTurn: string | null = null;
  let pendingTurn: string | null = null;
  let playingTurn: string | null = null;
  let enabled = false;
  let ambience = false;

  function playFallback(url: string) {
    if (!fallback || !enabled || !ambience) return;
    if (fallbackSource === url) fallback.currentTime = 0;
    else {
      fallback.src = url;
      fallbackSource = url;
    }
    return fallback.play();
  }

  function playPendingTurn() {
    const turn = pendingTurn;
    if (!turn || playingTurn === turn) return;
    const playback = playFallback(turnUrl);
    if (!playback) return;
    playingTurn = turn;
    void playback.then(() => {
      if (pendingTurn === turn) pendingTurn = null;
    }, () => {}).finally(() => {
      if (playingTurn === turn) playingTurn = null;
    });
  }

  function pauseMedia() {
    if (!background.paused) background.pause();
    if (fallback && !fallback.paused) fallback.pause();
  }

  return {
    setEnabled(active: boolean) {
      enabled = active;
      effects?.setEnabled(active);
      if (!active) pauseMedia();
    },
    setAmbience(active: boolean) {
      ambience = active;
      effects?.setAmbience(active);
      if (!active) pauseMedia();
    },
    resume(preview: boolean) {
      // Keep play() in the gesture handler call stack on iOS.
      const started = enabled && ambience && background.paused ? background.play() : Promise.resolve();
      if (effects) void effects.resume(preview).catch(() => {});
      else if (pendingTurn) playPendingTurn();
      else if (preview) void playFallback(startUrl)?.catch(() => {});
      return started;
    },
    setOwnTurn(turnKey: string | null) {
      if (effects) effects.setOwnTurn(turnKey);
      else if (turnKey && seenTurn !== turnKey) {
        seenTurn = pendingTurn = turnKey;
        playPendingTurn();
      } else if (!turnKey) {
        pendingTurn = null;
        if (fallbackSource === turnUrl) fallback?.pause();
      }
    },
    playLatest(events: readonly JournalEntry[], ownSeatId: string, foundGold: boolean) {
      effects?.playLatest(events, ownSeatId, foundGold);
    },
  };
}
