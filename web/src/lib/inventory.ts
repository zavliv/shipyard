import "server-only";
import { sshPorts } from "./server-info";
import { vpsctl } from "./vpsctl";

type Pm2Proc = {
  name: string;
  status: string;
  pid: number;
  restarts: number;
  uptime_since: number | null;
  cpu: number;
  memory: number;
  cwd: string;
};

type LegacyPm2 = Pm2Proc & { id: number };

type RawInventory = {
  server: {
    disk: { total: number; used: number; free: number };
    memory: { total: number; available: number };
    load: number[];
    processes: Pm2Proc[];
    uptime_seconds: number;
    hostname: string;
    system?: string;
    cpus?: number;
  };
  nginx: { file: string; target: string; server_names: string[]; upstream_ports: number[]; roots: string[] }[];
  certificates: { name: string; domains: string[]; expires: string | null }[];
  listeners: { port: number; host: string; pid: number; user: string | null; cwd: string | null; ancestors: number[] }[];
  legacy_pm2: LegacyPm2[];
  legacy_units: { unit: string; active: string; pid: number; cwd: string; since: string }[];
  projects: ProjectRecord[];
};

export type ProjectRecord = {
  project: string;
  apps?: { name: string; process: string; port?: number; path?: string; repo?: string; branch?: string }[];
  domains?: string[];
  error?: string;
  [key: string]: unknown;
};

export type ProcessKind = "managed" | "legacy-pm2" | "systemd" | "unknown" | "static";

export type SiteProcess = {
  label: string;
  kind: ProcessKind;
  port: number | null;
  status: "online" | "stopped" | "down" | "static";
  user: string | null;
  cwd: string | null;
  cpu: number | null;
  memory: number | null;
  restarts: number | null;
  since: string | null;
  logRef: string[] | null;
};

export type Site = {
  id: string;
  domains: string[];
  nginxFile: string;
  managed: boolean;
  project: ProjectRecord | null;
  status: "up" | "degraded" | "down";
  processes: SiteProcess[];
  certExpires: string | null;
  certDaysLeft: number | null;
};

export type Inventory = {
  fetchedAt: string;
  server: RawInventory["server"] & { managedCount: number; legacyCount: number };
  sites: Site[];
  orphans: SiteProcess[];
  projects: ProjectRecord[];
};

let cached: { at: number; value: Inventory } | null = null;
const TTL_MS = 5_000;

export async function getInventory(): Promise<Inventory> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const raw = await vpsctl<RawInventory>(["inventory"]);
  const value = buildInventory(raw);
  cached = { at: Date.now(), value };
  return value;
}

function iso(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function buildInventory(raw: RawInventory): Inventory {
  const listenerByPort = new Map(raw.listeners.map((l) => [l.port, l]));
  const projectByProcess = new Map<string, { project: ProjectRecord; app: string }>();
  for (const p of raw.projects) {
    for (const a of p.apps ?? []) {
      for (const name of [a.process, `${a.process}-blue`, `${a.process}-green`]) projectByProcess.set(name, { project: p, app: a.name });
    }
  }
  const usedPorts = new Set<number>();

  function describePort(port: number): SiteProcess {
    const l = listenerByPort.get(port);
    const base: SiteProcess = {
      label: `port ${port}`,
      kind: "unknown",
      port,
      status: l ? "online" : "down",
      user: l?.user ?? null,
      cwd: l?.cwd ?? null,
      cpu: null,
      memory: null,
      restarts: null,
      since: null,
      logRef: null,
    };
    if (!l) return base;
    usedPorts.add(port);
    const chain = new Set(l.ancestors);

    const managed = raw.server.processes.find((p) => p.pid && chain.has(p.pid));
    if (managed) {
      const owner = projectByProcess.get(managed.name);
      return {
        ...base,
        label: managed.name,
        kind: "managed",
        status: managed.status === "online" ? "online" : "stopped",
        cwd: managed.cwd,
        cpu: managed.cpu,
        memory: managed.memory,
        restarts: managed.restarts,
        since: iso(managed.uptime_since),
        logRef: owner ? ["logs", owner.project.project, owner.app] : null,
      };
    }
    const legacy = raw.legacy_pm2.find((p) => p.pid && chain.has(p.pid));
    if (legacy) {
      return {
        ...base,
        label: legacy.name,
        kind: "legacy-pm2",
        status: legacy.status === "online" ? "online" : "stopped",
        cwd: legacy.cwd,
        cpu: legacy.cpu,
        memory: legacy.memory,
        restarts: legacy.restarts,
        since: iso(legacy.uptime_since),
        logRef: ["legacy-logs", "pm2", String(legacy.id)],
      };
    }
    const unit = raw.legacy_units.find((u) => u.pid && chain.has(u.pid));
    if (unit) {
      return {
        ...base,
        label: unit.unit,
        kind: "systemd",
        status: unit.active === "active" ? "online" : "stopped",
        cwd: unit.cwd,
        since: unit.since || null,
        logRef: ["legacy-logs", "unit", unit.unit],
      };
    }
    return base;
  }

  const sites: Site[] = raw.nginx
    .filter((n) => n.file !== "00-default-catchall")
    .map((n) => {
      const domains = n.server_names.filter((d) => d !== "_");
      const processes = n.upstream_ports.map(describePort);
      for (const root of n.roots) {
        processes.push({
          label: "static files",
          kind: "static",
          port: null,
          status: "static",
          user: "www-data",
          cwd: root,
          cpu: null,
          memory: null,
          restarts: null,
          since: null,
          logRef: null,
        });
      }
      const certs = raw.certificates.filter((c) => c.expires && c.domains.some((d) => domains.includes(d)));
      const certExpires = certs.map((c) => c.expires!).sort()[0] ?? null;
      const live = processes.filter((p) => p.kind !== "static");
      const healthy = live.filter((p) => p.status === "online").length;
      const status: Site["status"] =
        live.length === 0 || healthy === live.length ? "up" : healthy === 0 ? "down" : "degraded";
      const managedProc = live.find((p) => p.kind === "managed");
      const project =
        (managedProc ? projectByProcess.get(managedProc.label)?.project : undefined) ??
        raw.projects.find((p) => Array.isArray(p.nginx) && (p.nginx as string[]).some((f) => f === n.target || f.endsWith(`/${n.file}`))) ??
        null;
      return {
        id: n.file,
        domains,
        nginxFile: n.target,
        managed: project !== null && live.every((p) => p.kind === "managed"),
        project,
        status,
        processes,
        certExpires,
        certDaysLeft: certExpires ? Math.floor((Date.parse(certExpires) - Date.now()) / 86_400_000) : null,
      };
    });

  const ignored = new Set([22, 53, 80, 443, 6379, ...sshPorts()]);
  const orphans = raw.listeners
    .filter((l) => !usedPorts.has(l.port) && !ignored.has(l.port))
    .map((l) => describePort(l.port));

  return {
    fetchedAt: new Date().toISOString(),
    server: {
      ...raw.server,
      managedCount: raw.server.processes.length,
      legacyCount: raw.legacy_pm2.length + raw.legacy_units.length,
    },
    sites,
    orphans,
    projects: raw.projects,
  };
}

export async function getLogs(logRef: string[], lines: number): Promise<{ out: string; err: string }> {
  const n = String(Math.max(20, Math.min(lines, 2000)));
  return vpsctl<{ out: string; err: string }>([...logRef, n]);
}
