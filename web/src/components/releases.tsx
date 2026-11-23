"use client";

import { LOCALE, TIME_ZONE } from "@/lib/locale";
import { useState, useTransition } from "react";
import { IconArrowBackUp, IconCircleCheck, IconCircleX, IconGitCommit } from "@tabler/icons-react";
import { rollbackSite } from "@/app/(panel)/sites/actions";
import { Badge, cx } from "./ui";

export type ReleaseRow = {
  id: string;
  source: string;
  commit: string;
  message: string;
  created: string;
  activated?: string;
  status: string;
};

function when(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE });
}

function RollbackButton({ project, release }: { project: string; release: ReleaseRow }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-xs hover:bg-hover"
      >
        <IconArrowBackUp size={14} aria-hidden />
        Roll back
      </button>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted">Make this live again?</span>
        <button onClick={() => setConfirming(false)} disabled={pending} className="rounded px-2 py-1 text-muted hover:text-fg">
          Cancel
        </button>
        <button
          onClick={() =>
            start(async () => {
              const res = await rollbackSite(project, release.source, release.id);
              if (res?.error) setError(res.error);
            })
          }
          disabled={pending}
          className="rounded-md bg-fg px-2.5 py-1 font-medium text-invert disabled:opacity-60"
        >
          {pending ? "Starting…" : "Roll back"}
        </button>
      </span>
      {error && <span className="text-xs text-bad-fg">{error}</span>}
    </span>
  );
}

export function Releases({ project, releases }: { project: string; releases: ReleaseRow[] }) {
  const rows = releases.filter((r) => r.status !== "pruned").slice().reverse();
  if (!rows.length) {
    return <p className="px-4 py-6 text-sm text-muted">No releases yet. The first deploy creates one.</p>;
  }
  const multiSource = new Set(rows.map((r) => r.source)).size > 1;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const live = r.status === "active";
        const failed = r.status === "failed";
        return (
          <li key={`${r.source}-${r.id}`} className={cx("flex items-center gap-3 px-4 py-3", live && "bg-ok-bg/30")}>
            <span className="shrink-0">
              {failed ? (
                <IconCircleX size={18} className="text-bad" aria-label="Failed" />
              ) : live ? (
                <IconCircleCheck size={18} className="text-ok" aria-label="Live" />
              ) : (
                <IconGitCommit size={18} className="text-faint" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted">{r.commit ? r.commit.slice(0, 7) : "local"}</span>
                <span className={cx("truncate", live && "font-medium")}>{r.message || "Release"}</span>
                {live && <Badge tone="ok">Live</Badge>}
                {failed && <Badge tone="bad">Build failed</Badge>}
                {multiSource && <Badge>{r.source}</Badge>}
              </span>
              <span className="block text-xs text-faint">
                {live && r.activated ? `Live since ${when(r.activated)}` : `Built ${when(r.created)}`}
                {failed && " · the live site was not affected"}
              </span>
            </span>
            {(r.status === "previous" || r.status === "built") && <RollbackButton project={project} release={r} />}
          </li>
        );
      })}
    </ul>
  );
}
