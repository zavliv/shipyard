import "server-only";
import type { Collection, ObjectId } from "mongodb";
import { collections } from "./db";

export type MetricDoc = {
  t: Date;
  m: { k: "s" | "a" | "v"; id: string };
  ok?: boolean;
  code?: number;
  ms?: number;
  cpu?: number;
  mem?: number;
  rs?: number;
  disk?: number;
  memp?: number;
  load?: number;
};

export type AlertDoc = {
  _id?: ObjectId;
  key: string;
  kind: "down" | "crash" | "ssl" | "disk" | "memory" | "deploy";
  target: string;
  title: string;
  detail?: string;
  href?: string;
  status: "open" | "resolved";
  openedAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date;
};

export type NotificationDoc = {
  _id?: ObjectId;
  at: Date;
  tone: "ok" | "bad" | "warn" | "info";
  title: string;
  body?: string;
  href?: string;
  read: boolean;
};

const RETENTION_S = 30 * 24 * 3600;
let ready: Promise<{ metrics: Collection<MetricDoc>; alerts: Collection<AlertDoc>; notifications: Collection<NotificationDoc> }> | null = null;

export function monitorCollections() {
  ready ??= (async () => {
    const { db } = await collections();
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!existing.has("metrics")) {
      try {
        await db.createCollection("metrics", {
          timeseries: { timeField: "t", metaField: "m", granularity: "minutes" },
          expireAfterSeconds: RETENTION_S,
        });
      } catch {
        await db.createCollection("metrics").catch(() => undefined);
        await db.collection("metrics").createIndex({ t: 1 }, { expireAfterSeconds: RETENTION_S });
      }
    }
    const metrics = db.collection<MetricDoc>("metrics");
    const alerts = db.collection<AlertDoc>("alerts");
    const notifications = db.collection<NotificationDoc>("notifications");
    await Promise.all([
      metrics.createIndex({ "m.k": 1, "m.id": 1, t: -1 }),
      alerts.createIndex({ key: 1 }, { unique: true, partialFilterExpression: { status: "open" } }),
      alerts.createIndex({ openedAt: -1 }),
      notifications.createIndex({ at: -1 }),
      notifications.createIndex({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
    ]);
    return { metrics, alerts, notifications };
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export type Bucket = { t: string; checks: number; up: number; ms: number | null };

export async function siteBuckets(ids: string[], hours: number, bucketMinutes: number): Promise<Record<string, Bucket[]>> {
  const { metrics } = await monitorCollections();
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const rows = await metrics
    .aggregate<{ _id: { id: string; t: Date }; checks: number; up: number; ms: number | null }>([
      { $match: { "m.k": "s", "m.id": { $in: ids }, t: { $gte: since } } },
      {
        $group: {
          _id: { id: "$m.id", t: { $dateTrunc: { date: "$t", unit: "minute", binSize: bucketMinutes } } },
          checks: { $sum: 1 },
          up: { $sum: { $cond: ["$ok", 1, 0] } },
          ms: { $avg: { $cond: ["$ok", "$ms", null] } },
        },
      },
      { $sort: { "_id.t": 1 } },
    ])
    .toArray();
  const out: Record<string, Bucket[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const r of rows) out[r._id.id]?.push({ t: r._id.t.toISOString(), checks: r.checks, up: r.up, ms: r.ms == null ? null : Math.round(r.ms) });
  return out;
}

export type Point = { t: string; v: number | null };

export async function appMemory(ids: string[], hours: number, bucketMinutes: number): Promise<Point[]> {
  const { metrics } = await monitorCollections();
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const rows = await metrics
    .aggregate<{ _id: { id: string; t: Date }; mem: number }>([
      { $match: { "m.k": "a", "m.id": { $in: ids }, t: { $gte: since } } },
      { $group: { _id: { id: "$m.id", t: { $dateTrunc: { date: "$t", unit: "minute", binSize: bucketMinutes } } }, mem: { $avg: "$mem" } } },
    ])
    .toArray();
  const byT = new Map<string, number>();
  for (const r of rows) {
    const k = r._id.t.toISOString();
    byT.set(k, (byT.get(k) ?? 0) + r.mem);
  }
  return [...byT.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => ({ t, v: Math.round(v) }));
}

export async function serverSeries(hours: number, bucketMinutes: number): Promise<{ t: string; disk: number; mem: number; load: number }[]> {
  const { metrics } = await monitorCollections();
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const rows = await metrics
    .aggregate<{ _id: Date; disk: number; mem: number; load: number }>([
      { $match: { "m.k": "v", t: { $gte: since } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$t", unit: "minute", binSize: bucketMinutes } },
          disk: { $avg: "$disk" },
          mem: { $avg: "$memp" },
          load: { $avg: "$load" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({ t: r._id.toISOString(), disk: Math.round(r.disk * 10) / 10, mem: Math.round(r.mem * 10) / 10, load: Math.round(r.load * 100) / 100 }));
}

export async function openAlerts(): Promise<AlertDoc[]> {
  const { alerts } = await monitorCollections();
  return alerts.find({ status: "open" }).sort({ openedAt: -1 }).toArray();
}

export async function recentAlerts(limit = 50): Promise<AlertDoc[]> {
  const { alerts } = await monitorCollections();
  return alerts.find().sort({ openedAt: -1 }).limit(limit).toArray();
}

export async function notificationsList(limit = 50): Promise<NotificationDoc[]> {
  const { notifications } = await monitorCollections();
  return notifications.find().sort({ at: -1 }).limit(limit).toArray();
}

export async function unreadCount(): Promise<number> {
  const { notifications } = await monitorCollections();
  return notifications.countDocuments({ read: false });
}

export async function markAllRead(): Promise<void> {
  const { notifications } = await monitorCollections();
  await notifications.updateMany({ read: false }, { $set: { read: true } });
}
