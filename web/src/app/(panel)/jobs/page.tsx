import Link from "next/link";
import type { Metadata } from "next";
import { IconCircleCheck, IconCircleMinus, IconCircleX, IconClockHour4, IconListCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { jobCounts, jobProjects, listJobsFiltered, KEEP_FINISHED_DAYS, RETRYABLE, type JobDoc, type JobFilter, type JobKind } from "@/lib/jobs";
import { since } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, EmptyState, PageHeader, cx, type Tone } from "@/components/ui";
import { cancelJob, retryFailedJob } from "./actions";

export const metadata: Metadata = { title: "Jobs" };

const STATUSES = [
  { key: "", label: "All" },
  { key: "active", label: "Running and waiting" },
  { key: "failed", label: "Failed" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const KINDS: { key: JobKind; label: string }[] = [
  { key: "deploy", label: "Deploy" },
  { key: "create", label: "New site" },
  { key: "rollback", label: "Rollback" },
  { key: "restart", label: "Restart" },
  { key: "rebuild", label: "Rebuild" },
  { key: "domain-add", label: "Add domain" },
  { key: "domain-remove", label: "Remove domain" },
  { key: "backup", label: "Backup" },
  { key: "restore", label: "Restore" },
  { key: "delete", label: "Delete site" },
  { key: "shipyard-update", label: "Shipyard update" },
  { key: "app-add", label: "Add app" },
  { key: "app-remove", label: "Remove app" },
];

function duration(j: JobDoc) {
  if (!j.startedAt) return "—";
  const s = Math.max(0, Math.round(((j.finishedAt ?? new Date()).getTime() - j.startedAt.getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function by(actor: string) {
  return actor.includes("@") ? "by you" : `· ${actor}`;
}

const look: Record<string, { tone: Tone; label: string; icon: React.ReactNode }> = {
  running: { tone: "info", label: "Running", icon: <IconLoader2 size={17} className="animate-spin text-info" aria-hidden /> },
  queued: { tone: "neutral", label: "Waiting", icon: <IconClockHour4 size={17} className="text-faint" aria-hidden /> },
  done: { tone: "ok", label: "Done", icon: <IconCircleCheck size={17} className="text-ok" aria-hidden /> },
  failed: { tone: "bad", label: "Failed", icon: <IconCircleX size={17} className="text-bad" aria-hidden /> },
  cancelled: { tone: "neutral", label: "Cancelled", icon: <IconCircleMinus size={17} className="text-faint" aria-hidden /> },
};

function subline(j: JobDoc) {
  const when = since((j.startedAt ?? j.createdAt).toISOString());
  if (j.status === "running") {
    const step = j.steps.find((s) => s.status === "running");
    return `${step ? `${step.label} · ` : ""}started ${when} ago ${by(j.actor)}`;
  }
  if (j.status === "queued") return `Waits for the server · queued ${since(j.createdAt.toISOString())} ago ${by(j.actor)}`;
  if (j.status === "failed") {
    const step = j.steps.find((s) => s.status === "failed");
    return `${step ? `Failed at ${step.label} · ` : ""}${since(j.createdAt.toISOString())} ago ${by(j.actor)}`;
  }
  const detail = j.steps.find((s) => s.detail)?.detail;
  return `${detail ? `${detail.slice(0, 60)} · ` : ""}${since(j.createdAt.toISOString())} ago ${by(j.actor)}`;
}

function Row({ j }: { j: JobDoc }) {
  const id = j._id!.toHexString();
  const l = look[j.status] ?? look.done;
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-hover/50">
      <Link href={`/jobs/${id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {l.icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{j.title}</span>
          <span className={cx("block truncate text-xs", j.status === "failed" ? "text-bad-fg" : "text-faint")}>{subline(j)}</span>
        </span>
        <span className="hidden sm:block">
          <Badge tone={l.tone}>{l.label}</Badge>
        </span>
        <span className="w-12 text-right text-xs tabular-nums text-faint">{duration(j)}</span>
      </Link>
      <span className="flex w-[84px] justify-end">
        {j.status === "queued" && (
          <ActionButton
            action={cancelJob.bind(null, id)}
            icon={<IconX size={14} aria-hidden />}
            success="Job cancelled"
            confirm={{
              title: "Cancel this job?",
              body: `“${j.title}” hasn't started yet. Cancelling removes it from the queue and changes nothing on the server.`,
              cta: "Cancel job",
            }}
          >
            Cancel
          </ActionButton>
        )}
        {j.status === "failed" && RETRYABLE.includes(j.kind) && (
          <ActionButton
            action={retryFailedJob.bind(null, id)}
            icon={<IconRefresh size={14} aria-hidden />}
            confirm={{ title: "Retry this job?", body: `Shipyard runs “${j.title}” again with the same settings.`, cta: "Retry" }}
          >
            Retry
          </ActionButton>
        )}
      </span>
    </li>
  );
}

function Section({ title, jobs, empty }: { title: string; jobs: JobDoc[]; empty?: string }) {
  if (!jobs.length && !empty) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {jobs.length ? (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <Row key={j._id!.toHexString()} j={j} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<IconListCheck size={28} aria-hidden />} title={empty!}>
            Try another filter.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function Count({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("text-2xl font-semibold tabular-nums", bad && value > 0 && "text-bad-fg")}>{value}</div>
    </div>
  );
}

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  await requireUser();
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const status = STATUSES.some((s) => s.key === pick(sp.status)) ? (pick(sp.status) as JobFilter["status"] | "") : "";
  const kind = KINDS.some((k) => k.key === pick(sp.kind)) ? (pick(sp.kind) as JobKind) : undefined;
  const projects = await jobProjects();
  const project = projects.includes(pick(sp.site)) ? pick(sp.site) : undefined;

  const [counts, jobs] = await Promise.all([jobCounts(), listJobsFiltered({ status: status || undefined, project, kind }, 150)]);
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const recent = jobs.filter((j) => j.status !== "running" && j.status !== "queued");
  const filtered = Boolean(status || kind || project);

  return (
    <>
      {counts.running + counts.queued > 0 && <AutoRefresh every={3} />}
      <PageHeader title="Jobs" sub={`Everything Shipyard is doing or has done · finished jobs are kept ${KEEP_FINISHED_DAYS} days`} />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Count label="Running" value={counts.running} />
        <Count label="Waiting" value={counts.queued} />
        <Count label="Failed in 24 h" value={counts.failed24h} bad />
      </div>

      <form method="get" className="mb-5 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status} className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-sm">
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key ? s.label : "All statuses"}
            </option>
          ))}
        </select>
        <select name="site" defaultValue={project ?? ""} className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">All sites</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select name="kind" defaultValue={kind ?? ""} className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-sm">
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <button className="h-8 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-hover">Apply</button>
        {filtered && (
          <Link href="/jobs" className="px-1 text-sm text-muted hover:text-fg">
            Clear
          </Link>
        )}
      </form>

      {jobs.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <EmptyState icon={<IconListCheck size={28} aria-hidden />} title={filtered ? "No jobs match" : "No jobs yet"}>
            {filtered ? "Try another filter." : "Deploys, backups and other actions show up here as they run."}
          </EmptyState>
        </div>
      ) : (
        <>
          <Section title="Running and waiting" jobs={active} />
          <Section title={active.length ? "Recent" : "Jobs"} jobs={recent} />
        </>
      )}
    </>
  );
}
