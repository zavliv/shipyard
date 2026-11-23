"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconCheck, IconCopy, IconPlayerPause, IconPlayerPlay, IconSearch } from "@tabler/icons-react";
import { cx } from "./ui";

type Props = {
  out: string;
  err: string;
  error?: string;
  sources: { index: number; label: string }[];
  current: number;
  lines: number;
  baseHref: string;
};

export function LogViewer({ out, err, error, sources, current, lines, baseHref }: Props) {
  const router = useRouter();
  const [stream, setStream] = useState<"out" | "err">("out");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, start] = useTransition();
  const boxRef = useRef<HTMLPreElement>(null);

  const text = stream === "out" ? out : err;
  const shown = useMemo(() => {
    const all = text.replace(/\s+$/, "").split("\n").filter((l) => l.length > 0);
    const q = query.trim().toLowerCase();
    return q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
  }, [text, query]);

  useEffect(() => {
    if (!follow) return;
    const id = setInterval(() => start(() => router.refresh()), 5000);
    return () => clearInterval(id);
  }, [follow, router]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const copy = async () => {
    await navigator.clipboard.writeText(shown.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const href = (index: number, n: number) => `${baseHref}?tab=logs&log=${index}&lines=${n}`;
  const errCount = err.trim() ? err.trim().split("\n").length : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <select
          value={current}
          onChange={(e) => router.push(href(Number(e.target.value), lines))}
          aria-label="App"
          className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
        >
          {sources.map((s) => (
            <option key={s.index} value={s.index}>{s.label}</option>
          ))}
        </select>
        <div className="flex rounded-lg border border-line-strong p-0.5 text-sm" role="tablist" aria-label="Log stream">
          {(["out", "err"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={stream === s}
              onClick={() => setStream(s)}
              className={cx("rounded-md px-2.5 py-1", stream === s ? "bg-subtle font-medium" : "text-muted hover:text-fg")}
            >
              {s === "out" ? "Output" : "Errors"}
              {s === "err" && errCount > 0 && <span className="ml-1 text-xs text-bad-fg tabular-nums">{errCount}</span>}
            </button>
          ))}
        </div>
        <label className="relative min-w-40 flex-1">
          <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter lines"
            aria-label="Filter log lines"
            className="w-full rounded-lg border border-line-strong bg-surface py-1.5 pr-2 pl-8 text-sm outline-none placeholder:text-faint focus:border-fg"
          />
        </label>
        <div className="flex items-center gap-1 text-xs text-muted">
          {[100, 200, 500, 1000].map((n) => (
            <Link key={n} href={href(current, n)} className={cx("rounded px-1.5 py-1", n === lines ? "bg-subtle font-medium text-fg" : "hover:text-fg")}>
              {n}
            </Link>
          ))}
        </div>
        <button
          onClick={() => setFollow((f) => !f)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm",
            follow ? "border-ok/40 bg-ok-bg text-ok-fg" : "border-line-strong text-muted hover:text-fg",
          )}
          aria-pressed={follow}
        >
          {follow ? <IconPlayerPause size={15} aria-hidden /> : <IconPlayerPlay size={15} aria-hidden />}
          {follow ? "Following" : "Follow"}
        </button>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-muted hover:text-fg"
        >
          {copied ? <IconCheck size={15} aria-hidden /> : <IconCopy size={15} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error ? (
        <p className="px-4 py-6 text-sm text-bad-fg">Couldn&apos;t read the logs: {error}</p>
      ) : (
        <pre
          ref={boxRef}
          className="h-[28rem] overflow-auto bg-code-bg px-4 py-3 font-mono text-xs leading-relaxed text-code-fg"
        >
          {shown.length === 0 ? (
            <span className="text-faint">{query ? "No lines match the filter." : "No log lines yet."}</span>
          ) : (
            shown.map((l, i) => (
              <div key={i} className={cx("whitespace-pre-wrap break-all", /error|fail|exception|refused/i.test(l) && "text-red-300")}>
                {l}
              </div>
            ))
          )}
        </pre>
      )}
      <div className="border-t border-line px-4 py-2 text-xs text-faint">
        Showing {shown.length} of the last {lines} lines{follow ? " · refreshing every 5 seconds" : ""}
      </div>
    </div>
  );
}
