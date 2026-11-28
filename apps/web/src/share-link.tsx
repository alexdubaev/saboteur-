import { useState } from "react";
import { copy } from "./text.js";
import { Icon } from "./ui.js";

export function shareUrl(inviteCode?: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (inviteCode) url.searchParams.set("join", inviteCode);
  return url.href;
}

export function ShareLink({ url, label, showCopy = false }: { url: string; label: string; showCopy?: boolean }) {
  const [fallback, setFallback] = useState<"copied" | "manual" | null>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setFallback("copied");
    } catch {
      setFallback("manual");
    }
  }

  async function shareLink() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: copy.title, url });
        setFallback(null);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyLink();
  }

  return <div className="share-link">
    <button className="button secondary" type="button" onClick={() => void shareLink()}><Icon name="invite" />Поделиться</button>
    {showCopy && <button className="button secondary" type="button" onClick={() => void copyLink()}><Icon name="copy" />Скопировать ссылку</button>}
    {fallback === "copied" && <p className="soft-note" role="status">Ссылка скопирована</p>}
    {fallback === "manual" && <input className="chat-input" aria-label={label} value={url} readOnly autoFocus onFocus={(event) => event.currentTarget.select()} />}
  </div>;
}
