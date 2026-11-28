import { useCallback, useEffect, useRef, useState } from "react";
import { createGameAudio } from "./game-audio.js";

export function useGameAudio(storageKey: string) {
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; }
  });
  const [needsGesture, setNeedsGesture] = useState(false);
  const audio = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const resumeSequence = useRef(0);

  const pauseAudio = useCallback(() => {
    resumeSequence.current++;
    audio.current?.setEnabled(false);
  }, []);

  const enableAudio = useCallback((preview: boolean) => {
    if (document.hidden) return;
    try {
      const player = audio.current ??= createGameAudio();
      player.setEnabled(true);
      player.setAmbience(true);
      const sequence = ++resumeSequence.current;
      void player.resume(preview).then(() => {
        if (sequence === resumeSequence.current) setNeedsGesture(false);
      }, (error: unknown) => {
        if (sequence === resumeSequence.current && error instanceof DOMException && error.name === "NotAllowedError") {
          setNeedsGesture(true);
        }
      });
    } catch {
      // Audio is optional if the browser cannot create a player.
    }
  }, []);

  function toggleSound() {
    if (sound && needsGesture) {
      enableAudio(true);
      return;
    }
    const enabled = !sound;
    setSound(enabled);
    if (enabled) enableAudio(true);
    else pauseAudio();
    try { localStorage.setItem(storageKey, enabled ? "on" : "off"); } catch { /* Apply for this page only. */ }
  }

  useEffect(() => {
    if (!sound) return;

    const syncVisibility = () => {
      if (document.hidden) pauseAudio();
      else enableAudio(false);
    };
    const startAfterGesture = (event: Event) => {
      if (event.isTrusted && !(event.target instanceof Element && event.target.closest("[data-sound-toggle]"))) {
        enableAudio(false);
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);
    document.addEventListener("touchend", startAfterGesture, { capture: true, passive: true });
    document.addEventListener("click", startAfterGesture, true);
    document.addEventListener("keydown", startAfterGesture, true);
    syncVisibility();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      document.removeEventListener("touchend", startAfterGesture, true);
      document.removeEventListener("click", startAfterGesture, true);
      document.removeEventListener("keydown", startAfterGesture, true);
      pauseAudio();
    };
  }, [sound, enableAudio, pauseAudio]);

  return { audio, sound, soundActive: sound && !needsGesture, enableAudio, toggleSound };
}
