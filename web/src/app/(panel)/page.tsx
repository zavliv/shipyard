import Link from "next/link";
import type { Metadata } from "next";
import { IconAlertTriangle, IconBrandGithub, IconCertificate, IconPlus, IconRocket, IconTimeline } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { listJobs } from "@/lib/jobs";
import { openAlerts, siteBuckets } from "@/lib/metrics";
import { UptimeStrip } from "@/components/charts";
import { uptimePct } from "@/lib/uptime";
import { primaryDomain, siteName } from "@/lib/rows";
import { deploySources } from "@/lib/sites";
import { bytes, duration, percent, since } from "@/lib/format";
import { LiveIndicator } from "@/components/live";
import { Alert, Dot, EmptyState, Meter, PageHeader, statusTone } from "@/components/ui";

export const metadata: Metadata = { title: "Overview" };

function problemText(status: string, down: string[]) {
  const parts = down.length ? `: ${down.join(", ")} not running` : "";
  return status === "down" ? `is down${parts}` : `is partly down${parts}`;
}

export default async function OverviewPage() {
  await requireUser();
  const [inv, jobs] = await Promise.all([getInventory(), listJobs(undefined, 8)]);
  const [uptime, alerts] = await Promise.all([siteBuckets(inv.sites.map((x) => x.id), 24, 60), openAlerts()]);
  const s = inv.server;
  const memUsed = s.memory.total - s.memory.available;
  const problems = inv.sites.filter((x) => x.status !== "up");
  const sslSoon = inv.sites.filter((x) => x.certDaysLeft != null && x.certDaysLeft < 30);
  const sites = [...inv.sites].sort((a, b) => siteName(a).localeCompare(siteName(b)));
  const lastJob = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (!lastJob.has(j.project)) lastJob.set(j.project, j);

  return (
    <>
      <PageHeader
        title="Overview"
        sub={`${inv.sites.length - problems.length} of ${inv.sites.length} sites up · server running for ${duration(s.uptime_seconds)}`}
        actions={
          <>
            <LiveIndicator fetchedAt={inv.fetchedAt} />
            <Link href="/sites/new" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90">
              <IconPlus size={15} aria-hidden />
              Add site
            </Link>
          </>
        }
      />

      {alerts.length > 0 && (
        <div className="mb-3 space-y-2">
          {alerts.filter((a) => a.kind !== "down" && a.kind !== "ssl").map((a) => (
            <Alert
              key={a._id!.toHexString()}
              tone="bad"
              icon={<IconAlertTriangle size={18} aria-hidden />}
              action={a.href ? <Link href={a.href} className="hover:underline">View</Link> : undefined}
            >
              <span className="font-medium">{a.title}</span> · {a.detail}
            </Alert>
          ))}
        </div>
      )}

      {(problems.length > 0 || sslSoon.length > 0) && (
        <div className="mb-5 space-y-2">
          {problems.map((x) => (
            <Alert
              key={x.id}
              tone={x.status === "down" ? "bad" : "warn"}
              icon={<IconAlertTriangle size={18} aria-hidden />}
              action={<Link href={`/sites/${encodeURIComponent(x.id)}`} className="hover:underline">View</Link>}
            >
              <span className="font-medium">{siteName(x)}</span>{" "}
              {problemText(x.status, x.processes.filter((p) => p.status === "down" || p.status === "stopped").map((p) => p.label))}
            </Alert>
          ))}
          {sslSoon.map((x) => (
            <Alert key={`ssl-${x.id}`} tone="warn" icon={<IconCertificate size={18} aria-hidden />}>
              SSL for <span className="font-medium">{siteName(x)}</span> expires in {x.certDaysLeft} days
            </Alert>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Disk", value: `${percent(s.disk.used, s.disk.total)}%`, meter: percent(s.disk.used, s.disk.total), sub: `${bytes(s.disk.free)} free` },
          { label: "Memory", value: `${percent(memUsed, s.memory.total)}%`, meter: percent(memUsed, s.memory.total), sub: `${bytes(s.memory.available)} available` },
          { label: "Load", value: s.load[0].toFixed(2), sub: `15 min ${s.load[2].toFixed(2)} · 2 CPUs` },
          { label: "Apps running", value: `${s.processes.filter((p) => p.status === "online").length}`, sub: `${inv.sites.length} sites` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{c.value}</div>
            {c.meter != null && <Meter value={c.meter} />}
            <div className="mt-1 text-xs text-faint">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Sites</h2>
        <Link href="/sites" className="text-xs text-muted hover:text-fg">Table view</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sites.map((x) => {
          const src = deploySources(x.project)[0];
          const job = x.project ? lastJob.get(x.project.project) : undefined;
          const mem = x.processes.reduce((sum, p) => sum + (p.memory ?? 0), 0);
          const buckets = uptime[x.id] ?? [];
          const pct = uptimePct(buckets);
          return (
            <Link
              key={x.id}
              href={`/sites/${encodeURIComponent(x.id)}`}
              className="group rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Dot tone={statusTone(x.status)} />
                    <span className="truncate">{siteName(x)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted">{primaryDomain(x)}</div>
                </div>
                <span className="shrink-0 text-xs text-faint tabular-nums">{mem ? bytes(mem) : ""}</span>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] text-faint">
                  <span>24h uptime</span>
                  <span className="tabular-nums">{pct == null ? "collecting…" : `${pct >= 99.995 ? "100" : pct.toFixed(2)}%`}</span>
                </div>
                <UptimeStrip buckets={buckets} slots={24} bucketMinutes={60} height={16} />
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-muted">
                <div className="flex items-center gap-1.5 truncate">
                  <IconBrandGithub size={14} className="shrink-0 text-faint" aria-hidden />
                  {src ? <span className="truncate">{src.repo} <span className="text-faint">· {src.branch}</span></span> : <span className="text-faint">Not linked to GitHub</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <IconRocket size={14} className="shrink-0 text-faint" aria-hidden />
                  {job ? (
                    <span className={job.status === "failed" ? "text-bad-fg" : ""}>
                      {job.kind === "create" ? "Created" : job.kind === "rollback" ? "Rolled back" : "Deployed"} {since(job.createdAt.toISOString())} ago
                      {job.status === "failed" ? " · failed" : job.status === "running" ? " · running" : ""}
                    </span>
                  ) : (
                    <span className="text-faint">No deploys through Shipyard yet</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
        <Link
          href="/sites/new"
          className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted hover:border-fg hover:text-fg"
        >
          <IconPlus size={20} aria-hidden />
          Add site from GitHub
        </Link>
      </div>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent deployments</h2>
        <Link href="/deployments" className="text-xs text-muted hover:text-fg">View all</Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {jobs.length === 0 ? (
          <EmptyState icon={<IconTimeline size={26} aria-hidden />} title="No deployments yet">
            Deploy a site or add a new one, and it shows up here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.slice(0, 6).map((j) => (
              <li key={j._id!.toHexString()}>
                <Link href={`/jobs/${j._id!.toHexString()}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-hover/50">
                  <span className="flex min-w-0 items-center gap-2">
                    <Dot tone={j.status === "done" ? "ok" : j.status === "failed" ? "bad" : "info"} pulse={j.status === "running"} />
                    <span className="font-medium">{j.project}</span>
                    <span className="truncate text-muted">{j.kind === "create" ? "created" : j.kind === "rollback" ? "rolled back" : "deployed"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-faint">{since(j.createdAt.toISOString())} ago</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
