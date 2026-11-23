import "server-only";
import { getInventory } from "./inventory";
import { primaryDomain, siteName } from "./rows";
import { monitorCollections, type AlertDoc, type MetricDoc, type NotificationDoc } from "./metrics";
import { sendAlertEmail } from "./mail";
import { env } from "./env";

const CHECK_TIMEOUT_MS = 10_000;
const DOWN_AFTER = 2;
const CRASH_RESTARTS = 5;
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const SSL_DAYS = 14;
const DISK_PCT = 85;
const MEM_AVAILABLE_PCT = 10;

const failures = new Map<string, number>();
const restartHistory = new Map<string, { t: number; rs: number }[]>();
let tick = 0;

async function check(domain: string): Promise<{ ok: boolean; code: number; ms: number }> {
  const started = performance.now();
  try {
    const res = await fetch(`https://${domain}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { "User-Agent": "shipyard-uptime/1.0" },
      cache: "no-store",
    });
    await res.arrayBuffer().catch(() => undefined);
    const ms = Math.round(performance.now() - started);
    return { ok: res.status > 0 && res.status < 500, code: res.status, ms };
  } catch {
    return { ok: false, code: 0, ms: Math.round(performance.now() - started) };
  }
}

export async function notify(n: Omit<NotificationDoc, "_id" | "at" | "read">, email = true) {
  const { notifications } = await monitorCollections();
  await notifications.insertOne({ ...n, at: new Date(), read: false });
  if (email) {
    await sendAlertEmail(env.adminEmail(), n.title, n.body ?? "", n.href).catch((e) => console.log(`alert email failed: ${(e as Error).message}`));
  }
}

async function openAlert(a: Pick<AlertDoc, "key" | "kind" | "target" | "title" | "detail" | "href">) {
  const { alerts } = await monitorCollections();
  const now = new Date();
  const existing = await alerts.findOne({ key: a.key, status: "open" });
  if (existing) {
    await alerts.updateOne({ _id: existing._id }, { $set: { lastSeenAt: now, detail: a.detail } });
    return;
  }
  await alerts.insertOne({ ...a, status: "open", openedAt: now, lastSeenAt: now });
  await notify({ tone: a.kind === "ssl" ? "warn" : "bad", title: a.title, body: a.detail, href: a.href });
}

async function resolveAlert(key: string, title: string, body: string, href?: string) {
  const { alerts } = await monitorCollections();
  const res = await alerts.findOneAndUpdate({ key, status: "open" }, { $set: { status: "resolved", resolvedAt: new Date() } });
  if (res) {
    const mins = Math.max(1, Math.round((Date.now() - res.openedAt.getTime()) / 60000));
    await notify({ tone: "ok", title, body: `${body} (was open for ${mins} min)`, href });
  }
}

export async function monitorTick(): Promise<void> {
  tick++;
  const { metrics } = await monitorCollections();
  const inv = await getInventory();
  const now = new Date();
  const docs: MetricDoc[] = [];

  const results = await Promise.all(
    inv.sites.map(async (s) => ({ site: s, domain: primaryDomain(s), ...(await check(primaryDomain(s))) })),
  );
  for (const r of results) {
    docs.push({ t: now, m: { k: "s", id: r.site.id }, ok: r.ok, code: r.code, ms: r.ms });
    const href = `/sites/${encodeURIComponent(r.site.id)}`;
    const name = siteName(r.site);
    if (r.ok) {
      failures.set(r.site.id, 0);
      await resolveAlert(`down:${r.site.id}`, `${name} is back up`, `https://${r.domain} answers again (HTTP ${r.code}).`, href);
    } else {
      const n = (failures.get(r.site.id) ?? 0) + 1;
      failures.set(r.site.id, n);
      if (n >= DOWN_AFTER) {
        await openAlert({
          key: `down:${r.site.id}`,
          kind: "down",
          target: r.site.id,
          title: `${name} is down`,
          detail: `https://${r.domain} ${r.code ? `returned HTTP ${r.code}` : "did not answer"} on ${n} checks in a row.`,
          href,
        });
      }
    }
    if (r.site.certDaysLeft != null) {
      if (r.site.certDaysLeft < SSL_DAYS) {
        await openAlert({
          key: `ssl:${r.site.id}`,
          kind: "ssl",
          target: r.site.id,
          title: `SSL for ${name} expires in ${r.site.certDaysLeft} days`,
          detail: "Certbot normally renews at 30 days left, so automatic renewal may be failing.",
          href,
        });
      } else {
        await resolveAlert(`ssl:${r.site.id}`, `SSL for ${name} renewed`, `Valid for ${r.site.certDaysLeft} more days.`, href);
      }
    }
  }

  for (const p of inv.server.processes) {
    const id = p.name.replace(/-(blue|green)$/, "");
    if (tick % 5 === 1) docs.push({ t: now, m: { k: "a", id }, cpu: p.cpu, mem: p.memory, rs: p.restarts });
    const hist = (restartHistory.get(id) ?? []).filter((h) => now.getTime() - h.t < CRASH_WINDOW_MS);
    hist.push({ t: now.getTime(), rs: p.restarts });
    restartHistory.set(id, hist);
    const increase = hist[hist.length - 1].rs - Math.min(...hist.map((h) => h.rs));
    if (increase > CRASH_RESTARTS || p.status === "errored") {
      await openAlert({
        key: `crash:${id}`,
        kind: "crash",
        target: id,
        title: `${id} keeps crashing`,
        detail: p.status === "errored" ? "pm2 gave up restarting it." : `It restarted ${increase} times in the last 10 minutes.`,
        href: "/server",
      });
    } else if (increase === 0 && p.status === "online") {
      await resolveAlert(`crash:${id}`, `${id} is stable again`, "No restarts in the last 10 minutes.", "/server");
    }
  }

  const s = inv.server;
  const diskPct = (s.disk.used / s.disk.total) * 100;
  const memAvailPct = (s.memory.available / s.memory.total) * 100;
  docs.push({ t: now, m: { k: "v", id: "server" }, disk: diskPct, memp: 100 - memAvailPct, load: s.load[0] });
  if (diskPct > DISK_PCT) {
    await openAlert({ key: "disk", kind: "disk", target: "server", title: `Disk is ${Math.round(diskPct)}% full`, detail: "Free up space before it reaches 100%, or builds and logs will fail.", href: "/server" });
  } else {
    await resolveAlert("disk", "Disk space is back to normal", `${Math.round(diskPct)}% used.`, "/server");
  }
  if (memAvailPct < MEM_AVAILABLE_PCT) {
    await openAlert({ key: "memory", kind: "memory", target: "server", title: `Memory is almost full`, detail: `Only ${Math.round(memAvailPct)}% available.`, href: "/server" });
  } else {
    await resolveAlert("memory", "Memory is back to normal", `${Math.round(memAvailPct)}% available.`, "/server");
  }

  if (docs.length) await metrics.insertMany(docs);
}
