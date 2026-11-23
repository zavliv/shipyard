import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IconBrandGithub, IconCertificate, IconClock, IconExternalLink, IconGitCommit, IconInfoCircle, IconPlus, IconServer2, IconTrash } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { getInventory, getLogs, type Site } from "@/lib/inventory";
import { primaryDomain, siteName } from "@/lib/rows";
import { bytes, dateTime, since } from "@/lib/format";
import { deploySources, type RecordApp } from "@/lib/sites";
import { listJobs } from "@/lib/jobs";
import { LiveIndicator } from "@/components/live";
import { LogViewer } from "@/components/log-viewer";
import { SiteActions } from "@/components/site-actions";
import { EnvEditor } from "@/components/env-editor";
import { DomainsPanel } from "@/components/domains-panel";
import { serverIp } from "@/lib/server-info";
import { AutoDeployToggle } from "@/components/auto-deploy-toggle";
import { SiteMonitoring, rangeOf } from "@/components/site-monitoring";
import { Releases, type ReleaseRow } from "@/components/releases";
import { ActionButton } from "@/components/action-button";
import { removeApp } from "../actions";
import { Alert, Badge, Card, Dot, KeyValue, SslText, StateBadge, StatusBadge, Td, Th, cx, statusTone } from "@/components/ui";

const KIND_LABEL: Record<string, string> = {
  managed: "pm2 · apps",
  "legacy-pm2": "pm2 · root",
  systemd: "systemd",
  static: "nginx",
  unknown: "Unknown",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "deployments", label: "Deployments" },
  { key: "logs", label: "Logs" },
  { key: "settings", label: "Settings" },
  { key: "domains", label: "Domains" },
  { key: "apps", label: "Apps" },
  { key: "ownership", label: "Ownership" },
] as const;

export async function generateMetadata({ params }: PageProps<"/sites/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id).replace(/\.conf$/, "") };
}

const TYPE_LABEL: Record<string, string> = { nextjs: "Next.js", node: "Node.js API", python: "Python API", static: "Static site" };

function SiteApps({ project, siteId, apps, domain }: { project: string; siteId: string; apps: RecordApp[]; domain: string }) {
  return (
    <Card
      title={`Apps in ${project}`}
      action={
        <Link
          href={`/sites/${encodeURIComponent(siteId)}/add-app`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90"
        >
          <IconPlus size={15} aria-hidden />
          Add app
        </Link>
      }
      flush
    >
      <ul className="divide-y divide-line">
        {apps.map((a, i) => {
          const where = a.own_domain && a.domains?.length ? a.domains[0] : a.route ? `${domain}${a.route}` : `${domain}/`;
          return (
            <li key={a.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {a.name} <span className="font-normal text-muted">· {TYPE_LABEL[a.type ?? ""] ?? a.type ?? "app"}</span>
                </span>
                <span className="block truncate text-xs text-faint">
                  {a.repo ?? "files on server"}
                  {a.subdir ? ` · ${a.subdir}/` : " · top of repo"}
                  {a.port ? ` · port ${a.port}` : ""}
                </span>
              </span>
              <span className="font-mono text-xs text-muted">{where}</span>
              {i > 0 ? (
                <ActionButton
                  action={removeApp.bind(null, project, a.name)}
                  variant="danger"
                  icon={<IconTrash size={14} aria-hidden />}
                  confirm={{
                    title: `Remove ${a.name}?`,
                    body: `Shipyard backs up ${project} first, then stops ${a.name} and removes its code, settings, releases and ${a.own_domain ? "domain" : "route"}. The rest of the site keeps running. You can't undo this, but the backup stays 14 days.`,
                    cta: `Remove ${a.name}`,
                  }}
                >
                  Remove
                </ActionButton>
              ) : (
                <span className="w-[86px] text-right text-xs text-faint">Main app</span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AppsTable({ site }: { site: Site }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-subtle/60">
          <tr>
            <Th>Part</Th>
            <Th>Status</Th>
            <Th>Runs by</Th>
            <Th className="text-right">Port</Th>
            <Th className="text-right">CPU</Th>
            <Th className="text-right">Memory</Th>
            <Th className="text-right">Restarts</Th>
            <Th>Up for</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {site.processes.map((p, i) => (
            <tr key={`${p.label}-${i}`}>
              <Td>
                <div className="font-medium">{p.label}</div>
                <div className="max-w-xs truncate font-mono text-xs text-faint" title={p.cwd ?? ""}>{p.cwd ?? "-"}</div>
              </Td>
              <Td><StatusBadge status={p.status} /></Td>
              <Td><Badge tone={p.kind === "managed" ? "info" : "neutral"}>{KIND_LABEL[p.kind]}</Badge></Td>
              <Td className="text-right tabular-nums">{p.port ?? "-"}</Td>
              <Td className="text-right tabular-nums">{p.cpu != null ? `${p.cpu}%` : "-"}</Td>
              <Td className="text-right tabular-nums">{bytes(p.memory)}</Td>
              <Td className={cx("text-right tabular-nums", (p.restarts ?? 0) > 5 && "text-warn-fg")}>{p.restarts ?? "-"}</Td>
              <Td className="text-muted">{since(p.since)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SitePage({ params, searchParams }: PageProps<"/sites/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const inv = await getInventory();
  const site = inv.sites.find((s) => s.id === decodeURIComponent(id));
  if (!site) notFound();

  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "overview";
  const base = `/sites/${encodeURIComponent(site.id)}`;
  const domain = primaryDomain(site);
  const project = site.project?.project ?? null;
  const sources = deploySources(site.project);
  const shipyardSite = site.project?.created_by === "shipyard";
  const releases = (site.project?.releases as ReleaseRow[] | undefined) ?? [];
  const live = releases.filter((r) => r.status === "active").sort((a, b) => (b.activated ?? "").localeCompare(a.activated ?? ""))[0];
  const memory = site.processes.reduce((sum, p) => sum + (p.memory ?? 0), 0);
  const downParts = site.processes.filter((p) => p.status === "down" || p.status === "stopped");
  const jobs = project ? await listJobs(project, 15) : [];
  const logSources = site.processes.map((p, index) => ({ index, label: p.label, logRef: p.logRef })).filter((s) => s.logRef);
  const canRestart = shipyardSite && site.processes.some((p) => p.kind === "managed");
  const recApps = (site.project?.apps as { name: string; type: string; process: string }[] | undefined) ?? [];
  const deletePlan =
    shipyardSite && project
      ? {
          project,
          folder: `/srv/apps/${project}`,
          processes: recApps.map((a) => a.process),
          domains: (site.project?.domains as string[] | undefined) ?? site.domains,
          nginx: (site.project?.nginx as string[] | undefined) ?? [],
          certificates: (site.project?.certificates as string[] | undefined) ?? [],
        }
      : null;
  const mainDomain = ((site.project?.certificates as string[] | undefined) ?? [])[0] ?? site.domains[0];
  const visibleTabs = TABS.filter((t) => shipyardSite || (t.key !== "settings" && t.key !== "domains"));

  let logs: { out: string; err: string; error?: string } | null = null;
  let logIndex = -1;
  const lines = [100, 200, 500, 1000].includes(Number(sp.lines)) ? Number(sp.lines) : 200;
  if (tab === "logs" && logSources.length) {
    const wanted = Number(sp.log);
    logIndex = logSources.some((s) => s.index === wanted) ? wanted : logSources[0].index;
    logs = await getLogs(site.processes[logIndex].logRef!, lines).catch((e: Error) => ({ out: "", err: "", error: e.message }));
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/sites" className="text-sm text-muted hover:text-fg">Sites</Link>
          <h1 className="mt-0.5 flex items-center gap-2.5 truncate text-2xl font-semibold tracking-tight">
            <Dot tone={statusTone(site.status)} pulse={site.status === "up"} />
            {siteName(site)}
          </h1>
          <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            {domain}
            <IconExternalLink size={13} aria-hidden />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator fetchedAt={inv.fetchedAt} />
          <SiteActions
            siteHref={base}
            project={project}
            domain={domain}
            repo={sources[0]?.repo ?? null}
            branch={sources[0]?.branch ?? null}
            canDeploy={sources.length > 0}
            canRestart={canRestart}
            deletePlan={deletePlan}
            email={user.email}
          />
        </div>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Site sections">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? base : `${base}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              tab === t.key ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.key === "deployments" && releases.length > 0 && <span className="ml-1.5 text-xs text-faint">{releases.filter((r) => r.status !== "pruned").length}</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          {downParts.length > 0 && (
            <Alert tone="warn" icon={<IconInfoCircle size={18} aria-hidden />}>
              {downParts.map((p) => p.label).join(", ")} {downParts.length === 1 ? "isn't" : "aren't"} running.
            </Alert>
          )}
          {!shipyardSite && (
            <Alert tone="neutral" icon={<IconInfoCircle size={18} aria-hidden />}>
              This site isn&apos;t managed by Shipyard yet, so it&apos;s read-only here.
            </Alert>
          )}

          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold">Production</h2>
              <StatusBadge status={site.status} />
            </header>
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-faint">Live version</div>
                  {live ? (
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <IconGitCommit size={16} className="text-muted" aria-hidden />
                      <span className="font-mono text-xs text-muted">{live.commit ? live.commit.slice(0, 7) : "local"}</span>
                      <span className="truncate font-medium">{live.message || "Release"}</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-muted">{shipyardSite ? "Not deployed through Shipyard yet" : "Unknown"}</div>
                  )}
                  {live?.activated && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                      <IconClock size={13} aria-hidden /> Live since {dateTime(live.activated)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-faint">Source</div>
                  {sources.length ? (
                    sources.map((s) => (
                      <a key={s.source} href={`https://github.com/${s.repo}`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 text-sm hover:underline">
                        <IconBrandGithub size={16} aria-hidden />
                        {s.repo}
                        <span className="rounded bg-subtle px-1.5 font-mono text-xs text-muted">{s.branch}</span>
                      </a>
                    ))
                  ) : (
                    <div className="mt-1 text-sm text-muted">Not linked to GitHub (Deploy is off)</div>
                  )}
                </div>
                {sources.length > 0 && project && (
                  <AutoDeployToggle
                    project={project}
                    initial={((site.project?.apps as { auto_deploy?: boolean; repo?: string }[] | undefined) ?? []).some((a) => a.repo && a.auto_deploy)}
                    webhookReady={Boolean(process.env.GITHUB_WEBHOOK_SECRET)}
                  />
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-faint">Domains</div>
                  <ul className="mt-1 space-y-1">
                    {site.domains.map((d) => (
                      <li key={d}>
                        <a href={`https://${d}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm hover:underline">
                          {d}
                          <IconExternalLink size={13} className="text-faint" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    <IconCertificate size={15} className="text-muted" aria-hidden /> SSL <SslText days={site.certDaysLeft} />
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconServer2 size={15} className="text-muted" aria-hidden /> {site.processes.filter((p) => p.kind !== "static").length} apps · {memory ? bytes(memory) : "-"}
                  </span>
                  <StateBadge managed={site.managed} />
                </div>
              </div>
            </div>
          </section>

          <SiteMonitoring
            siteId={site.id}
            processes={recApps.length ? recApps.map((a) => a.process) : []}
            base={base}
            range={rangeOf(sp.range)}
          />

          <Card title="Apps" action={<Link href={`${base}?tab=apps`} className="text-xs text-muted hover:text-fg">Details</Link>} flush>
            <AppsTable site={site} />
          </Card>

          {shipyardSite && (
            <Card title="Recent releases" action={<Link href={`${base}?tab=deployments`} className="text-xs text-muted hover:text-fg">All deployments</Link>} flush>
              <Releases project={project!} releases={releases.slice(-4)} />
            </Card>
          )}
        </div>
      )}

      {tab === "deployments" && (
        <div className="space-y-4">
          {shipyardSite && (
            <Card title="Releases" flush>
              <Releases project={project!} releases={releases} />
            </Card>
          )}
          <Card title="Jobs" flush>
            {jobs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No jobs yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {jobs.map((j) => (
                  <li key={j._id!.toHexString()}>
                    <Link href={`/jobs/${j._id!.toHexString()}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-hover/60">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{j.kind === "create" ? "Created" : j.kind === "rollback" ? "Rollback" : "Deploy"}</span>
                        <span className="text-muted"> · {j.steps.find((s) => s.detail)?.detail ?? j.title}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={j.status === "done" ? "ok" : j.status === "failed" ? "bad" : "info"}>
                          {j.status === "done" ? "Done" : j.status === "failed" ? "Failed" : j.status === "queued" ? "Queued" : "Running"}
                        </Badge>
                        <span className="text-xs text-faint">{dateTime(j.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "settings" && shipyardSite && project && (
        <EnvEditor project={project} apps={recApps.map((a) => ({ name: a.name, type: a.type }))} />
      )}

      {tab === "domains" && shipyardSite && project && (
        <DomainsPanel
          serverIp={await serverIp()}
          project={project}
          domains={(site.project?.domains as string[] | undefined) ?? site.domains}
          primary={mainDomain}
          sslDays={site.certDaysLeft}
        />
      )}

      {tab === "apps" && (
        <div className="space-y-4">
          {shipyardSite && project && <SiteApps project={project} siteId={site.id} apps={(site.project?.apps as RecordApp[] | undefined) ?? []} domain={domain} />}
          <Card title="Processes" flush>
            <AppsTable site={site} />
          </Card>
        </div>
      )}

      {tab === "logs" &&
        (logs ? (
          <LogViewer
            out={logs.out}
            err={logs.err}
            error={logs.error}
            sources={logSources.map(({ index, label }) => ({ index, label }))}
            current={logIndex}
            lines={lines}
            baseHref={base}
          />
        ) : (
          <Card><p className="text-sm text-muted">This site has no app logs. Static sites are served by nginx directly.</p></Card>
        ))}

      {tab === "ownership" &&
        (site.project ? (
          <div className="space-y-4">
            <Card title="Everything this site owns on the server">
              <KeyValue
                items={[
                  ["Folder", <span key="f" className="font-mono text-xs">/srv/apps/{site.project.project}</span>],
                  ["Domains", (site.project.domains as string[] | undefined)?.join(", ") ?? "-"],
                  ["nginx", <span key="n" className="font-mono text-xs">{((site.project.nginx as string[] | undefined) ?? []).join("  ")}</span>],
                  ["SSL certificates", ((site.project.certificates as string[] | undefined) ?? []).join(", ") || "-"],
                  ["Processes", ((site.project.apps as { process: string }[] | undefined) ?? []).map((a) => a.process).join(", ")],
                ]}
              />
            </Card>
            <Card title="Full record">
              <pre className="max-h-[28rem] overflow-auto rounded-lg bg-subtle p-4 font-mono text-xs leading-relaxed">{JSON.stringify(site.project, null, 2)}</pre>
            </Card>
          </div>
        ) : (
          <Card>
            <p className="text-sm text-muted">This site has no ownership record yet.</p>
          </Card>
        ))}
    </>
  );
}
