import { useCallback, useEffect, useRef, useState } from "react";
import { createGameAudio } from "./game-audio.js";

export function useGameAudio(storageKey: string) {
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; }
  });
  const audio = useRef<ReturnType<typeof createGameAudio> | null>(null);

  const enableAudio = useCallback((preview: boolean) => {
    if (document.hidden) return;
    try {
      const player = audio.current ??= createGameAudio();
      player.setEnabled(true);
      player.setAmbience(true);
      void player.resume(preview).catch(() => {});
    } catch {
      // The game is still playable when Web Audio is unavailable.
    }
  }, []);

  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    if (enabled) enableAudio(true);
    else audio.current?.setEnabled(false);
    try { localStorage.setItem(storageKey, enabled ? "on" : "off"); } catch { /* Apply for this page only. */ }
  }

  useEffect(() => {
    if (!sound) return;

    const syncVisibility = () => {
      if (document.hidden) audio.current?.setEnabled(false);
      else enableAudio(false);
    };
    const startAfterGesture = (event: Event) => {
      if (event.isTrusted) enableAudio(false);
    };

    document.addEventListener("visibilitychange", syncVisibility);
    document.addEventListener("click", startAfterGesture, true);
    document.addEventListener("keydown", startAfterGesture, true);
    syncVisibility();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      document.removeEventListener("click", startAfterGesture, true);
      document.removeEventListener("keydown", startAfterGesture, true);
      audio.current?.setEnabled(false);
    };
  }, [sound, enableAudio]);

  return { audio, sound, enableAudio, toggleSound };
}
