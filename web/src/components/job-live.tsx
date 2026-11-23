"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleXFilled,
  IconClockHour4,
  IconExternalLink,
  IconLoader2,
  IconPlayerSkipForward,
} from "@tabler/icons-react";
import { Alert, Badge, cx } from "./ui";

export type LiveStep = { key: string; label: string; status: string; startedAt?: string; endedAt?: string; detail?: string };
export type LiveJob = {
  id: string;
  kind: string;
  project: string;
  status: string;
  error: string | null;
  steps: LiveStep[];
  log: string[];
  logCount: number;
  domain?: string;
};

function StepIcon({ status }: { status: string }) {
  if (status === "done") return <IconCircleCheckFilled size={20} className="text-ok" aria-label="Done" />;
  if (status === "failed") return <IconCircleXFilled size={20} className="text-bad" aria-label="Failed" />;
  if (status === "running") return <IconLoader2 size={20} className="animate-spin text-info" aria-label="Running" />;
  if (status === "skipped") return <IconPlayerSkipForward size={18} className="text-faint" aria-label="Skipped" />;
  return <IconCircleDashed size={20} className="text-faint" aria-label="Waiting" />;
}

function took(s: LiveStep, now: number) {
  if (!s.startedAt) return "";
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  const sec = Math.max(0, Math.round((end - Date.parse(s.startedAt)) / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function JobLive({ initial }: { initial: LiveJob }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const live = job.status === "queued" || job.status === "running";

  useEffect(() => {
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let cursor = initial.logCount;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource(`/api/jobs/${initial.id}/events?from=${cursor}`);
      es.onopen = () => setConnected(true);
      es.addEventListener("update", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { lines: string[]; steps: LiveStep[]; status: string; error: string | null; cursor: number };
        cursor = d.cursor;
        setJob((j) => ({ ...j, steps: d.steps, status: d.status, error: d.error, log: [...j.log, ...d.lines].slice(-4000), logCount: d.cursor }));
      });
      es.addEventListener("end", () => {
        es?.close();
        setConnected(false);
        router.refresh();
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      clearInterval(tick);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [live, initial.id, initial.logCount, router]);

  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [job.log.length]);

  return (
    <>
      {job.status === "queued" && (
        <div className="mb-4">
          <Alert tone="info" icon={<IconClockHour4 size={18} aria-hidden />}>
            Waiting in the queue. It starts as soon as the previous job for this site, or another build on the server, finishes.
          </Alert>
        </div>
      )}
      {job.status === "done" && (
        <div className="mb-4">
          <Alert
            tone="ok"
            icon={<IconCircleCheckFilled size={18} aria-hidden />}
            action={
              job.domain ? (
                <a href={`https://${job.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  Open site <IconExternalLink size={14} aria-hidden />
                </a>
              ) : undefined
            }
          >
            {job.kind === "create" ? (
              <><span className="font-medium">{job.project}</span> is live{job.domain ? ` at https://${job.domain}` : ""}</>
            ) : job.kind === "rollback" ? (
              "The earlier release is live again."
            ) : job.kind === "restart" ? (
              "The new settings are live."
            ) : job.kind === "rebuild" ? (
              "Rebuilt with the new settings and switched over without downtime."
            ) : job.kind === "domain-add" ? (
              "The domain is connected and covered by SSL."
            ) : job.kind === "domain-remove" ? (
              "The domain was removed from this site."
            ) : job.kind === "delete" ? (
              <><span className="font-medium">{job.project}</span> was deleted. A full backup was kept in /srv/backups/deleted.</>
            ) : (
              "The new version is live. Visitors were switched over without downtime."
            )}
          </Alert>
        </div>
      )}
      {job.status === "failed" && (
        <div className="mb-4">
          <Alert tone="bad" icon={<IconCircleXFilled size={18} aria-hidden />}>
            <div className="font-medium">{job.error}</div>
            <div className="mt-0.5 text-xs opacity-80">
              {job.kind === "create"
                ? "Everything Shipyard created for this site was removed. Fix the problem and try again."
                : job.kind === "delete"
                  ? "Nothing was deleted unless the output below says so."
                  : job.kind === "domain-add" || job.kind === "domain-remove"
                    ? "The site's domains were left as they were."
                    : "The live site kept running its previous version. The output below shows what went wrong."}
            </div>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Steps</h2>
            <Badge tone={job.status === "done" ? "ok" : job.status === "failed" ? "bad" : job.status === "cancelled" ? "neutral" : "info"}>
              {job.status === "done" ? "Finished" : job.status === "failed" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.status === "queued" ? "Queued" : "Running"}
            </Badge>
          </header>
          <ol className="divide-y divide-line">
            {job.steps.map((s) => (
              <li key={s.key} className={cx("flex items-start gap-3 px-4 py-3", s.status === "running" && "bg-info-bg/40")}>
                <span className="mt-0.5"><StepIcon status={s.status} /></span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-sm", s.status === "pending" || s.status === "skipped" ? "text-muted" : "font-medium")}>{s.label}</span>
                  {s.detail && (
                    <span className={cx("block truncate text-xs", s.status === "failed" ? "text-bad-fg" : "text-faint")} title={s.detail}>
                      {s.detail}
                    </span>
                  )}
                </span>
                <span className="text-xs text-faint tabular-nums">{took(s, now)}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="overflow-hidden rounded-xl border border-line bg-surface lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Output</h2>
            <span className="flex items-center gap-1.5 text-xs text-faint">
              {live && <span className={cx("h-1.5 w-1.5 rounded-full", connected ? "bg-ok" : "bg-warn")} />}
              {live ? (connected ? "Live" : "Reconnecting…") : `${job.logCount} lines`}
            </span>
          </div>
          <pre
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="h-[32rem] overflow-auto bg-code-bg px-4 py-3 font-mono text-xs leading-relaxed text-code-fg"
          >
            {job.log.length === 0 ? (
              <span className="text-faint">{job.status === "queued" ? "Waiting to start…" : "Waiting for output…"}</span>
            ) : (
              job.log.map((l, i) => (
                <div
                  key={i}
                  className={cx(
                    "break-all whitespace-pre-wrap",
                    l.startsWith("▸") && "mt-2 font-semibold text-white",
                    l.startsWith("✖") && "font-semibold text-red-300",
                    l.startsWith("✔") && "font-semibold text-green-300",
                  )}
                >
                  {l}
                </div>
              ))
            )}
            {live && <div className="mt-1 animate-pulse text-faint">▍</div>}
          </pre>
        </div>
      </div>
      {!live && (
        <div className="mt-4 text-sm">
          <Link href="/sites" className="text-muted hover:text-fg">Back to sites</Link>
        </div>
      )}
    </>
  );
}
