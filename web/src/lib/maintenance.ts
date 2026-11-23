import "server-only";
import { zonedParts } from "./locale";
import { collections } from "./db";
import { enqueueJob, jobsCollection } from "./jobs";
import { backupSteps } from "./job-defs";
import { getInventory } from "./inventory";
import { notify } from "./monitor";

type StateDoc = { _id: string; lastBackupDay?: string; lastSnapshotDay?: string; lastSnapshotAt?: Date; lastSnapshotResult?: string };

const vmId = () => process.env.HOSTINGER_VM_ID || "";

async function state() {
  const { db } = await collections();
  return db.collection<StateDoc>("schedule");
}

export async function shipyardProjects(): Promise<string[]> {
  const inv = await getInventory();
  return inv.projects.filter((p) => p.created_by === "shipyard" && p.status === "active").map((p) => p.project).sort();
}

export async function enqueueBackup(actor: string, projects?: string[]): Promise<string | null> {
  const list = projects ?? (await shipyardProjects());
  if (!list.length) return null;
  const jobs = await jobsCollection();
  const pending = await jobs.findOne({ kind: "backup", status: { $in: ["queued", "running"] } });
  if (pending) return pending._id!.toHexString();
  return enqueueJob({
    kind: "backup",
    project: "server",
    title: list.length === 1 ? `Back up ${list[0]}` : `Back up ${list.length} sites`,
    actor,
    params: { projects: list },
    steps: backupSteps(list),
  });
}

export function snapshotConfigured(): boolean {
  return Boolean(process.env.HOSTINGER_API_TOKEN && vmId());
}

export async function takeSnapshot(): Promise<string> {
  const token = process.env.HOSTINGER_API_TOKEN;
  if (!token) throw new Error("HOSTINGER_API_TOKEN is not set");
  const res = await fetch(`https://developers.hostinger.com/api/vps/v1/virtual-machines/${vmId()}/snapshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Hostinger API ${res.status}: ${body.slice(0, 200)}`);
  return body.slice(0, 200);
}

export async function maintenanceTick(): Promise<void> {
  const st = await state();
  const now = zonedParts();
  const doc = (await st.findOne({ _id: "state" })) ?? { _id: "state" };

  if (now.hour === 3 && doc.lastBackupDay !== now.day) {
    await st.updateOne({ _id: "state" }, { $set: { lastBackupDay: now.day } }, { upsert: true });
    await enqueueBackup("nightly schedule");
  }

  if (snapshotConfigured() && now.weekday === 0 && now.hour === 4 && doc.lastSnapshotDay !== now.day) {
    await st.updateOne({ _id: "state" }, { $set: { lastSnapshotDay: now.day } }, { upsert: true });
    try {
      await takeSnapshot();
      await st.updateOne({ _id: "state" }, { $set: { lastSnapshotAt: new Date(), lastSnapshotResult: "ok" } });
      await notify({ tone: "ok", title: "Weekly server snapshot taken", body: "Hostinger keeps one snapshot; this one replaced the previous." }, false);
    } catch (e) {
      await st.updateOne({ _id: "state" }, { $set: { lastSnapshotAt: new Date(), lastSnapshotResult: (e as Error).message } });
      await notify({ tone: "bad", title: "Weekly server snapshot failed", body: (e as Error).message, href: "/settings" });
    }
  }
}

export async function scheduleState(): Promise<StateDoc | null> {
  return (await state()).findOne({ _id: "state" });
}
