"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { vpsctl } from "@/lib/vpsctl";
import { audit } from "@/lib/audit";
import { addAppJob, createSiteJob, deploySources, deployJob, parseAppInput, parseInput, planApp, planSite, removeAppJob, rollbackJob, type AppPlanResult, type PlanResult } from "@/lib/sites";

export type PreviewState = PlanResult | { ok: false; errors: Record<string, string> } | null;

export async function previewSite(_: PreviewState, form: FormData): Promise<PreviewState> {
  await requireUser();
  try {
    return await planSite(parseInput(form));
  } catch (e) {
    return { ok: false, errors: { form: `Couldn't check the plan: ${(e as Error).message}` } };
  }
}

export async function createSite(_: PreviewState, form: FormData): Promise<PreviewState> {
  const user = await requireUser();
  const input = parseInput(form);
  let jobId: string;
  try {
    const result = await planSite(input);
    if (!result.ok) return result;
    jobId = await createSiteJob(input, result.plan, user.email);
  } catch (e) {
    return { ok: false, errors: { form: `Couldn't start: ${(e as Error).message}` } };
  }
  redirect(`/jobs/${jobId}`);
}

export async function deploySite(project: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = await getInventory();
  const record = inv.projects.find((p) => p.project === project) ?? null;
  if (!record || !deploySources(record).length) return { error: "This site isn't linked to GitHub, so it can't be deployed from Shipyard." };
  let jobId: string;
  try {
    jobId = await deployJob(project, record, user.email);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/jobs/${jobId}`);
}

export async function rollbackSite(project: string, source: string, release: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = await getInventory();
  const record = inv.projects.find((p) => p.project === project);
  const releases = (record?.releases as { id: string; source: string; status: string }[] | undefined) ?? [];
  const target = releases.find((r) => r.id === release && r.source === source);
  if (!record || !target || !["previous", "built"].includes(target.status)) return { error: "That release can't be restored." };
  let jobId: string;
  try {
    jobId = await rollbackJob(project, source, release, user.email);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/jobs/${jobId}`);
}

export async function restartSite(project: string): Promise<{ error?: string; restarted?: string[] }> {
  const user = await requireUser();
  const inv = await getInventory();
  const record = inv.projects.find((p) => p.project === project);
  const apps = ((record?.apps as { name: string; type?: string }[] | undefined) ?? []).filter((a) => a.type !== "static");
  if (!record || !apps.length) return { error: "This site has no apps Shipyard can restart." };
  const restarted: string[] = [];
  try {
    for (const a of apps) {
      await vpsctl(["restart", project, a.name], { timeoutMs: 60_000 });
      restarted.push(a.name);
    }
  } catch (e) {
    await audit({ actor: user.email, action: "restart", target: project, result: "failed", detail: (e as Error).message.slice(0, 200) });
    return { error: (e as Error).message, restarted };
  }
  await audit({ actor: user.email, action: "restart", target: project, result: "ok", detail: restarted.join(", ") });
  return { restarted };
}

export type AppPreviewState = AppPlanResult | null;

export async function previewApp(project: string, _: AppPreviewState, form: FormData): Promise<AppPreviewState> {
  await requireUser();
  try {
    return await planApp(project, parseAppInput(form));
  } catch (e) {
    return { ok: false, errors: { form: `Couldn't check the plan: ${(e as Error).message}` } };
  }
}

export async function addApp(project: string, _: AppPreviewState, form: FormData): Promise<AppPreviewState> {
  const user = await requireUser();
  const input = parseAppInput(form);
  let jobId: string;
  try {
    const result = await planApp(project, input);
    if (!result.ok) return result;
    jobId = await addAppJob(project, input, result.plan, user.email);
  } catch (e) {
    return { ok: false, errors: { form: `Couldn't start: ${(e as Error).message}` } };
  }
  redirect(`/jobs/${jobId}`);
}

export async function removeApp(project: string, app: string): Promise<{ jobId?: string; error?: string }> {
  const user = await requireUser();
  const inv = await getInventory();
  const rec = inv.projects.find((p) => p.project === project);
  const apps = (rec?.apps as { name: string }[] | undefined) ?? [];
  const idx = apps.findIndex((a) => a.name === app);
  if (!rec || rec.created_by !== "shipyard" || idx < 1) return { error: "Only apps added to a site can be removed here." };
  try {
    return { jobId: await removeAppJob(project, app, user.email) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
