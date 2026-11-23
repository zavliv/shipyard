"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@tabler/icons-react";
import { Dot, cx } from "./ui";

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function useHotkey(key: string, handler: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === key) {
        e.preventDefault();
        handler();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler]);
}

export function LiveIndicator({ fetchedAt, every = 15 }: { fetchedAt: string; every?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") start(() => router.refresh());
    }, every * 1000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router, every]);

  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  useHotkey("r", refresh);

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-2 text-xs text-muted sm:flex" suppressHydrationWarning>
        <Dot tone="ok" pulse />
        Live · updated {ago(now - Date.parse(fetchedAt))}
      </span>
      <button
        onClick={refresh}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-muted hover:bg-hover hover:text-fg"
        aria-label="Refresh (r)"
        title="Refresh (r)"
      >
        <IconRefresh size={16} className={cx(pending && "animate-spin")} aria-hidden />
      </button>
    </div>
  );
}
