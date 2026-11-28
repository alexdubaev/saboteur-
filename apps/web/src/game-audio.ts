type Cue = { wave: OscillatorType; notes: readonly number[]; seconds: number };

const start: Cue = { wave: "sine", notes: [392, 523], seconds: .09 };
const cues: Partial<Record<string, Cue>> = {
  PLAY_TUNNEL: { wave: "triangle", notes: [196], seconds: .11 },
  PLAY_BREAK: { wave: "triangle", notes: [260, 135], seconds: .08 },
  PLAY_REPAIR: { wave: "sine", notes: [440, 660], seconds: .1 },
  PLAY_COLLAPSE: { wave: "sawtooth", notes: [90, 56], seconds: .115 },
  PLAY_SCOUT: { wave: "sine", notes: [540, 450], seconds: .09 },
  DISCARD: { wave: "triangle", notes: [330], seconds: .07 },
  GOAL_REVEALED: { wave: "sine", notes: [523, 659], seconds: .095 },
  ROUND_RESOLVED: { wave: "sine", notes: [330, 440, 588], seconds: .12 },
};

export function createGameAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);

  function playCue(cue: Cue) {
    if (context.state !== "running" || master.gain.value === 0) return;
    cue.notes.forEach((frequency, index) => {
      const time = context.currentTime + index * cue.seconds;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = cue.wave;
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(.22, time + .008);
      envelope.gain.linearRampToValueAtTime(0, time + cue.seconds);
      oscillator.connect(envelope).connect(master);
      oscillator.addEventListener("ended", () => { oscillator.disconnect(); envelope.disconnect(); }, { once: true });
      oscillator.start(time);
      oscillator.stop(time + cue.seconds);
    });
  }

  return {
    setEnabled(enabled: boolean) { master.gain.value = enabled ? .25 : 0; },
    async resume(preview: boolean) {
      if (context.state !== "running") await context.resume();
      if (preview) playCue(start);
    },
    playLatest(events: readonly { type: string }[]) {
      const event = events.findLast(({ type }) => cues[type] !== undefined);
      if (event) playCue(cues[event.type]!);
    },
  };
}
