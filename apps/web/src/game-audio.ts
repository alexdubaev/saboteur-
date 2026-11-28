import type { JournalEntry } from "../../../packages/protocol/src/index.js";
import mineSoundsUrl from "./audio/mine.mp3?url";
import sounds from "./audio/mine.json" with { type: "json" };

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

export function preloadGameSounds() {
  if (typeof AudioContext !== "undefined") void loadSamples().catch(() => {});
}

export function createGameAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  const lastVariant = new Map<SoundName, number>();
  let resuming: Promise<void> | null = null;
  let loading: Promise<void> | null = null;
  let buffer: AudioBuffer | null = null;
  let queuedCue: Cue | null = null;
  let ambience = false;
  let cave: AudioBufferSourceNode | null = null;
  let detail: AudioBufferSourceNode | null = null;
  let detailTimer: number | undefined;
  let nextDetail = 0;

  function playClip({ sound, volume }: Cue, loop = false) {
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
    if (loop) {
      source.loop = true;
      source.loopStart = offset;
      source.loopEnd = offset + duration;
      source.start(0, offset);
    } else {
      source.start(0, offset, duration);
    }
    return { source, duration };
  }

  function playQueued() {
    if (!queuedCue || !buffer || resuming || context.state !== "running" || master.gain.value === 0) return;
    const cue = queuedCue;
    queuedCue = null;
    playClip(cue);
  }

  function scheduleDetail(delay: number) {
    detailTimer = window.setTimeout(() => {
      if (!cave || context.state !== "running") return;
      const clip = playClip(background[nextDetail]);
      detail = clip?.source ?? null;
      nextDetail = (nextDetail + 1) % background.length;
      scheduleDetail((clip?.duration ?? 0) * 1000 + 4600 + Math.random() * 4400);
    }, delay);
  }

  function syncAmbience() {
    if (!ambience || !buffer || master.gain.value === 0 || context.state !== "running") {
      window.clearTimeout(detailTimer);
      cave?.stop();
      detail?.stop();
      cave = detail = null;
      return;
    }
    if (cave) return;
    cave = playClip({ sound: "mineBed", volume: .23 }, true)?.source ?? null;
    scheduleDetail(1200 + Math.random() * 1050);
  }

  context.addEventListener("statechange", syncAmbience);

  function prepareSamples() {
    if (buffer || loading) return;
    loading = loadSamples()
      .then((bytes) => context.decodeAudioData(bytes.slice(0)))
      .then((decoded) => { buffer = decoded; playQueued(); syncAmbience(); })
      .catch(() => { queuedCue = null; })
      .finally(() => { loading = null; });
  }

  return {
    setEnabled(enabled: boolean) {
      master.gain.value = enabled ? .54 : 0;
      if (!enabled) queuedCue = null;
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
        resuming ??= context.resume().finally(() => { resuming = null; });
        try { await resuming; } catch { queuedCue = null; return; }
      }
      playQueued();
      syncAmbience();
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
