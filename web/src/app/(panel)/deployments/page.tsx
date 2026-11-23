import Link from "next/link";
import type { Metadata } from "next";
import { IconArrowBackUp, IconCircleCheck, IconCircleX, IconClockHour4, IconLoader2, IconPlus, IconRocket, IconTimeline } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { listJobs, type JobDoc } from "@/lib/jobs";
import { dateTime } from "@/lib/format";
import { EmptyState, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Deployments" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "failed", label: "Failed" },
] as const;

function duration(j: JobDoc) {
  if (!j.startedAt) return "";
  const end = j.finishedAt ?? new Date();
  const s = Math.round((end.getTime() - j.startedAt.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "create") return <IconPlus size={15} aria-hidden />;
  if (kind === "rollback") return <IconArrowBackUp size={15} aria-hidden />;
  return <IconRocket size={15} aria-hidden />;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <IconCircleCheck size={17} className="text-ok" aria-label="Done" />;
  if (status === "failed") return <IconCircleX size={17} className="text-bad" aria-label="Failed" />;
  if (status === "queued") return <IconClockHour4 size={17} className="text-faint" aria-label="Queued" />;
  return <IconLoader2 size={17} className="animate-spin text-info" aria-label="Running" />;
}

export default async function DeploymentsPage({ searchParams }: PageProps<"/deployments">) {
  await requireUser();
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as (typeof FILTERS)[number]["key"]) : "all";
  const all = await listJobs(undefined, 200);
  const jobs = all.filter((j) =>
    filter === "running" ? j.status === "running" || j.status === "queued" : filter === "failed" ? j.status === "failed" : true,
  );

  return (
    <>
      <PageHeader title="Deployments" sub="Every create, deploy and rollback across your sites" />
      <div className="mb-3 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/deployments" : `/deployments?filter=${f.key}`}
            className={cx("rounded-lg px-3 py-1.5 text-sm", filter === f.key ? "bg-subtle font-medium" : "text-muted hover:text-fg")}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {jobs.length === 0 ? (
          <EmptyState icon={<IconTimeline size={28} aria-hidden />} title={filter === "all" ? "No deployments yet" : "Nothing here"}>
            {filter === "all" ? "Deploys, new sites and rollbacks will show up here." : "Try another filter."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => {
              const commit = j.steps.find((s) => s.detail && /^[0-9a-f]{7} /.test(s.detail))?.detail;
              return (
                <li key={j._id!.toHexString()}>
                  <Link href={`/jobs/${j._id!.toHexString()}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-hover/50 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                    <StatusIcon status={j.status} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <span className="text-muted"><KindIcon kind={j.kind} /></span>
                        {j.project}
                      </span>
                      <span className="block truncate text-xs text-faint">
                        {j.status === "failed" ? <span className="text-bad-fg">{j.error}</span> : commit ?? j.title}
                      </span>
                    </span>
                    <span className="hidden truncate text-xs text-muted sm:block">{j.actor}</span>
                    <span className="text-right text-xs text-faint">
                      <span className="block">{dateTime(j.createdAt)}</span>
                      <span className="block tabular-nums">{duration(j)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
