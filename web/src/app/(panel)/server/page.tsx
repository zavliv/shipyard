import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { serverIp } from "@/lib/server-info";
import { serverSeries } from "@/lib/metrics";
import { LineChart } from "@/components/charts";
import { siteName } from "@/lib/rows";
import { bytes, duration, percent } from "@/lib/format";
import { LiveIndicator } from "@/components/live";
import { Alert, Badge, Card, KeyValue, PageHeader, Stat, StatusBadge, Td, Th } from "@/components/ui";
import { IconAlertTriangle } from "@tabler/icons-react";

export const metadata: Metadata = { title: "Server" };

export default async function ServerPage() {
  await requireUser();
  const [inv, series] = await Promise.all([getInventory(), serverSeries(24, 10)]);
  const s = inv.server;
  const ip = await serverIp();
  const memUsed = s.memory.total - s.memory.available;
  const apps = inv.sites
    .flatMap((site) => site.processes.filter((p) => p.kind !== "static").map((p) => ({ ...p, siteId: site.id, site: siteName(site) })))
    .sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0));
  const appMemory = apps.reduce((sum, p) => sum + (p.memory ?? 0), 0);

  return (
    <>
      <PageHeader title="Server" sub={`${s.hostname} · running for ${duration(s.uptime_seconds)}`} actions={<LiveIndicator fetchedAt={inv.fetchedAt} />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Disk used" value={bytes(s.disk.used)} meter={percent(s.disk.used, s.disk.total)} sub={`${bytes(s.disk.free)} free of ${bytes(s.disk.total)}`} />
        <Stat label="Memory used" value={bytes(memUsed)} meter={percent(memUsed, s.memory.total)} sub={`${bytes(s.memory.available)} available`} />
        <Stat label="Managed apps" value={s.managedCount} sub="In /srv/apps, user apps" />
        <Stat label="Not yet moved" value={s.legacyCount} sub="root pm2 and systemd" />
      </div>

      {inv.projects.filter((p) => p.status === "creating").map((p) => (
        <div key={p.project} className="mt-4">
          <Alert tone="warn" icon={<IconAlertTriangle size={18} aria-hidden />}>
            <span className="font-medium">{p.project}</span> was left half-created in <code className="font-mono">/srv/apps/{p.project}</code> (Shipyard may have restarted during the job). It isn&apos;t live; it will be cleaned up by the upcoming delete feature.
          </Alert>
        </div>
      ))}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Disk used · 24h">
          <LineChart points={series.map((p) => ({ t: p.t, v: p.disk }))} format="percent" height={120} />
        </Card>
        <Card title="Memory used · 24h">
          <LineChart points={series.map((p) => ({ t: p.t, v: p.mem }))} format="percent" height={120} />
        </Card>
        <Card title="Load · 24h">
          <LineChart points={series.map((p) => ({ t: p.t, v: p.load }))} format="load" height={120} />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`All apps · ${apps.length}`} action={<span className="text-xs text-muted">{bytes(appMemory)} in use</span>} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle/60">
                  <tr>
                    <Th>App</Th>
                    <Th>Status</Th>
                    <Th>Runs as</Th>
                    <Th className="text-right">Port</Th>
                    <Th className="text-right">CPU</Th>
                    <Th className="text-right">Memory</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {apps.map((p, i) => (
                    <tr key={`${p.label}-${i}`}>
                      <Td>
                        <div className="font-medium">{p.label}</div>
                        <Link href={`/sites/${encodeURIComponent(p.siteId)}`} className="text-xs text-faint hover:text-fg">{p.site}</Link>
                      </Td>
                      <Td><StatusBadge status={p.status} /></Td>
                      <Td>{p.user === "root" ? <Badge tone="warn">root</Badge> : <span className="text-muted">{p.user ?? "-"}</span>}</Td>
                      <Td className="text-right tabular-nums">{p.port ?? "-"}</Td>
                      <Td className="text-right tabular-nums">{p.cpu != null ? `${p.cpu}%` : "-"}</Td>
                      <Td className="text-right tabular-nums">{bytes(p.memory)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Machine">
            <KeyValue
              items={[
                ["Host", s.hostname],
                ["IP", ip],
                ["System", s.system || "Linux"],
                ["Size", `${s.cpus ?? "?"} CPU · ${bytes(s.memory.total)} memory · ${bytes(s.disk.total)} disk`],
                ["Load", `${s.load.map((l) => l.toFixed(2)).join(" / ")}`],
              ]}
            />
          </Card>
          {inv.orphans.length > 0 && (
            <Card title="Not linked to a site" flush>
              <ul className="divide-y divide-line text-sm">
                {inv.orphans.map((p) => (
                  <li key={p.port ?? p.label} className="px-4 py-2.5">
                    <div className="font-medium">Port {p.port}</div>
                    <div className="truncate font-mono text-xs text-faint">{p.cwd ?? "-"}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
