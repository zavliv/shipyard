"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { clientInfo, currentSessionHash, requireUser } from "@/lib/auth";
import { collections } from "@/lib/db";
import { audit } from "@/lib/audit";
import { vpsctl } from "@/lib/vpsctl";
import { enqueueJob } from "@/lib/jobs";
import { getInventory } from "@/lib/inventory";
import { deployableApps } from "@/lib/sites";
import { shipyardUpdateSteps, restoreSteps } from "@/lib/job-defs";
import { enqueueBackup, snapshotConfigured, takeSnapshot } from "@/lib/maintenance";
import { env } from "@/lib/env";

type Result = { jobId?: string; error?: string; ok?: boolean };

export async function backupNow(project?: string): Promise<Result> {
  const user = await requireUser();
  try {
    const jobId = await enqueueBackup(user.email, project ? [project] : undefined);
    if (!jobId) return { error: "There are no Shipyard-managed sites to back up." };
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function restoreBackup(file: string): Promise<Result> {
  const user = await requireUser();
  try {
    const info = await vpsctl<{ project: string; sources: string[]; exists: boolean; domains: string[] }>(["backup-info", file]);
    if (info.exists) return { error: `${info.project} exists right now. Restore only works for deleted sites.` };
    const jobId = await enqueueJob({
      kind: "restore",
      project: info.project,
      title: `Restore ${info.project}`,
      actor: user.email,
      params: { file, sources: info.sources },
      steps: restoreSteps(info.sources),
      summary: { domain: info.domains[0] ?? "" },
    });
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteBackup(kind: "scheduled" | "deleted", file: string): Promise<Result> {
  const user = await requireUser();
  const { ip } = await clientInfo();
  try {
    await vpsctl(["backup-delete", kind, file]);
    await audit({ actor: user.email, action: "backup-delete", target: file, result: "ok", ip });
    revalidatePath("/backups");
    return { ok: true };
  } catch (e) {
    await audit({ actor: user.email, action: "backup-delete", target: file, result: "failed", detail: (e as Error).message.slice(0, 200), ip });
    return { error: (e as Error).message };
  }
}

export async function setAutoDeploy(project: string, on: boolean): Promise<Result> {
  const user = await requireUser();
  try {
    const inv = await getInventory();
    const rec = inv.projects.find((p) => p.project === project);
    const apps = deployableApps(rec ?? null);
    if (!apps.length) return { error: "This site isn't linked to GitHub." };
    for (const a of apps) await vpsctl(["app-config", project, a.name], { input: JSON.stringify({ auto_deploy: on }) });
    await audit({ actor: user.email, action: on ? "auto-deploy-on" : "auto-deploy-off", target: project, result: "ok" });
    revalidatePath("/sites");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function signOutOthers(): Promise<Result> {
  const user = await requireUser();
  const current = await currentSessionHash();
  const { sessions } = await collections();
  const res = await sessions.deleteMany({ tokenHash: { $ne: current ?? "" } });
  const { ip } = await clientInfo();
  await audit({ actor: user.email, action: "sign-out-others", result: "ok", detail: `${res.deletedCount} sessions ended`, ip });
  revalidatePath("/settings");
  return { ok: true };
}

export async function revokeSession(id: string): Promise<Result> {
  const user = await requireUser();
  if (!ObjectId.isValid(id)) return { error: "Unknown session." };
  const current = await currentSessionHash();
  const { sessions } = await collections();
  await sessions.deleteOne({ _id: new ObjectId(id), tokenHash: { $ne: current ?? "" } });
  await audit({ actor: user.email, action: "end-session", result: "ok" });
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateShipyard(): Promise<Result> {
  const user = await requireUser();
  if (env.vpsctlMode() !== "local") return { error: "Shipyard can only update itself when it runs on the server." };
  const jobId = await enqueueJob({
    kind: "shipyard-update",
    project: "shipyard",
    title: "Update Shipyard",
    actor: user.email,
    params: {},
    steps: shipyardUpdateSteps(),
  });
  return { jobId };
}

export async function snapshotNow(): Promise<Result> {
  const user = await requireUser();
  if (!snapshotConfigured()) return { error: "Add HOSTINGER_API_TOKEN to Shipyard's settings first." };
  try {
    await takeSnapshot();
    await audit({ actor: user.email, action: "server-snapshot", result: "ok" });
    return { ok: true };
  } catch (e) {
    await audit({ actor: user.email, action: "server-snapshot", result: "failed", detail: (e as Error).message.slice(0, 200) });
    return { error: (e as Error).message };
  }
}
