"use server";

import { requireUser, clientInfo } from "@/lib/auth";
import { getInventory, type ProjectRecord } from "@/lib/inventory";
import { vpsctl } from "@/lib/vpsctl";
import { audit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs";
import { pointsHere, sourceOf, type RecordApp } from "@/lib/sites";
import { serverIp } from "@/lib/server-info";
import { deleteSteps, domainSteps, rebuildSteps, restartSteps } from "@/lib/job-defs";
import { requestActionCode, verifyActionCode } from "@/lib/action-codes";

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

async function shipyardProject(project: string): Promise<{ record: ProjectRecord; apps: RecordApp[] }> {
  if (!NAME.test(project)) throw new Error("Invalid site name.");
  const inv = await getInventory();
  const record = inv.projects.find((p) => p.project === project);
  if (!record || record.created_by !== "shipyard") throw new Error("This site isn't managed by Shipyard.");
  return { record, apps: (record.apps as RecordApp[] | undefined) ?? [] };
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function getAppEnv(project: string, app: string): Promise<{ content?: string; error?: string }> {
  const user = await requireUser();
  try {
    const { apps } = await shipyardProject(project);
    if (!apps.some((a) => a.name === app)) return { error: "Unknown app." };
    const r = await vpsctl<{ content: string }>(["env-get", project, app]);
    await audit({ actor: user.email, action: "view-settings", target: `${project}/${app}`, result: "ok" });
    return { content: r.content };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveAppEnv(project: string, app: string, content: string): Promise<{ jobId?: string; error?: string; mode?: string }> {
  const user = await requireUser();
  try {
    if (content.length > 64 * 1024) return { error: "Settings are too long (64 KB max)." };
    const { apps } = await shipyardProject(project);
    const a = apps.find((x) => x.name === app);
    if (!a) return { error: "Unknown app." };
    const before = await vpsctl<{ content: string }>(["env-get", project, app]);
    await vpsctl(["site-env", project, app], { input: content });
    const oldEnv = parseEnv(before.content);
    const newEnv = parseEnv(content);
    const publicChanged = Object.keys({ ...oldEnv, ...newEnv }).some((k) => k.startsWith("NEXT_PUBLIC_") && oldEnv[k] !== newEnv[k]);
    const source = sourceOf(a);
    const changedKeys = Object.keys({ ...oldEnv, ...newEnv }).filter((k) => oldEnv[k] !== newEnv[k]);
    await audit({ actor: user.email, action: "change-settings", target: `${project}/${app}`, result: "ok", detail: changedKeys.length ? `changed: ${changedKeys.join(", ")}` : "no changes" });
    if (!changedKeys.length) return { mode: "none" };
    if (a.type === "static" || (a.type === "nextjs" && publicChanged)) {
      const jobId = await enqueueJob({
        kind: "rebuild",
        project,
        title: `Rebuild ${project} with new settings`,
        actor: user.email,
        params: { sources: [source] },
        steps: rebuildSteps([source]),
      });
      return { jobId, mode: "rebuild" };
    }
    if (!a.release) return { error: "Saved, but this app has no live release to restart yet." };
    const jobId = await enqueueJob({
      kind: "restart",
      project,
      title: `Apply new settings to ${project}`,
      actor: user.email,
      params: { targets: [{ source, release: a.release }] },
      steps: restartSteps([source]),
    });
    return { jobId, mode: "restart" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addDomain(project: string, raw: string): Promise<{ jobId?: string; error?: string }> {
  const user = await requireUser();
  const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN.test(domain)) return { error: "Enter a valid domain, like shop.example.com." };
  try {
    const { record } = await shipyardProject(project);
    if (((record.domains as string[] | undefined) ?? []).includes(domain)) return { error: "That domain is already on this site." };
    const inv = await getInventory();
    const owner = inv.sites.find((s) => s.domains.includes(domain));
    if (owner) return { error: `${domain} is already used by ${owner.project?.project ?? owner.id}.` };
    if (!(await pointsHere(domain))) return { error: `${domain} doesn't point to this server yet. Add an A record for ${await serverIp()}, wait a few minutes and try again.` };
    const jobId = await enqueueJob({
      kind: "domain-add",
      project,
      title: `Add ${domain} to ${project}`,
      actor: user.email,
      params: { domain },
      steps: domainSteps("domain-add", domain),
      summary: { domain },
    });
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeDomain(project: string, domain: string): Promise<{ jobId?: string; error?: string }> {
  const user = await requireUser();
  try {
    const { record } = await shipyardProject(project);
    const domains = (record.domains as string[] | undefined) ?? [];
    if (!domains.includes(domain)) return { error: "That domain isn't on this site." };
    const jobId = await enqueueJob({
      kind: "domain-remove",
      project,
      title: `Remove ${domain} from ${project}`,
      actor: user.email,
      params: { domain },
      steps: domainSteps("domain-remove", domain),
    });
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function requestDeleteCode(project: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await shipyardProject(project);
    const { ip } = await clientInfo();
    const res = await requestActionCode(user.email, `delete:${project}`, `delete the site ${project}`, ip);
    if (res.error) return { error: res.error };
    await audit({ actor: user.email, action: "delete-code", target: project, result: "ok", ip });
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteSite(project: string, confirm: string, code: string): Promise<{ jobId?: string; error?: string }> {
  const user = await requireUser();
  const { ip } = await clientInfo();
  try {
    await shipyardProject(project);
    if (confirm.trim() !== project) return { error: "The name you typed doesn't match." };
    if (!(await verifyActionCode(`delete:${project}`, code.replace(/\s/g, "")))) {
      await audit({ actor: user.email, action: "delete-site", target: project, result: "refused", detail: "wrong or expired code", ip });
      return { error: "The code is wrong or has expired." };
    }
    const jobId = await enqueueJob({
      kind: "delete",
      project,
      title: `Delete ${project}`,
      actor: user.email,
      params: { confirm: project },
      steps: deleteSteps(),
    });
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
