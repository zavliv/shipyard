import "server-only";
import { resolve4 } from "node:dns/promises";
import { vpsctl } from "./vpsctl";
import { serverIp } from "./server-info";
import { getInventory } from "./inventory";
import { type AppType } from "./github";
import { enqueueJob } from "./jobs";
import { seal } from "./secret";
import { addAppSteps, createSteps, deploySteps, removeAppSteps, rollbackSteps, type AddAppParams, type CreateParams } from "./job-defs";

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GH = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;
const SUBDIR = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._/-]{0,120}$/;
const TYPES: AppType[] = ["nextjs", "node", "static", "python"];

export type SiteInput = {
  owner: string;
  repo: string;
  branch: string;
  project: string;
  app: string;
  type: AppType;
  subdir: string;
  install: string;
  build: string;
  start: string;
  output: string;
  domains: string[];
  envText: string;
};

export type SitePlan = {
  input: Omit<SiteInput, "envText"> & { envKeys: string[] };
  port: number | null;
  process: string | null;
  folder: string;
  nginxFile: string;
  creates: string[];
  warnings: string[];
};

export type PlanResult = { ok: true; plan: SitePlan } | { ok: false; errors: Record<string, string> };

export function parseInput(form: FormData): SiteInput {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    owner: s("owner"),
    repo: s("repo"),
    branch: s("branch"),
    project: s("project").toLowerCase(),
    app: s("app").toLowerCase(),
    type: s("type") as AppType,
    subdir: s("subdir").replace(/^\/+|\/+$/g, ""),
    install: s("install"),
    build: s("build"),
    start: s("start"),
    output: s("output").replace(/^\/+|\/+$/g, ""),
    domains: s("domains")
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter(Boolean),
    envText: String(form.get("envText") ?? ""),
  };
}

function envKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((k): k is string => Boolean(k));
}

function badCommand(c: string) {
  return c.length > 500 || /[\r\n\0]/.test(c);
}

export async function pointsHere(domain: string): Promise<boolean> {
  try {
    return (await resolve4(domain)).includes(await serverIp());
  } catch {
    return false;
  }
}

export async function planSite(input: SiteInput): Promise<PlanResult> {
  const errors: Record<string, string> = {};
  if (!GH.test(input.owner) || !GH.test(input.repo)) errors.repo = "Pick a repository.";
  if (!BRANCH.test(input.branch)) errors.branch = "Pick a valid branch.";
  if (!NAME.test(input.project)) errors.project = "Use lowercase letters, numbers and dashes (max 41).";
  if (!NAME.test(input.app)) errors.app = "Use lowercase letters, numbers and dashes.";
  if (!TYPES.includes(input.type)) errors.type = "Pick a project type.";
  if (!SUBDIR.test(input.subdir)) errors.subdir = "Use a folder path inside the repository, like apps/web.";
  if (!SUBDIR.test(input.output)) errors.output = "Use a folder path, like dist.";
  for (const [k, v] of [["install", input.install], ["build", input.build], ["start", input.start]] as const) {
    if (badCommand(v)) errors[k] = "Keep the command on one line, under 500 characters.";
  }
  if (input.type !== "static" && !input.start) errors.start = "A start command is needed to run the app.";
  if (input.envText.length > 64 * 1024) errors.envText = "Settings are too long (64 KB max).";
  if (!input.domains.length) errors.domains = "Add at least one domain.";
  else if (input.domains.length > 10) errors.domains = "Use 10 domains or fewer.";
  else {
    const bad = input.domains.filter((d) => !DOMAIN.test(d));
    if (bad.length) errors.domains = `Not a valid domain: ${bad.join(", ")}`;
  }

  const inv = await getInventory();
  if (!errors.project) {
    const exists =
      inv.projects.some((p) => p.project === input.project) ||
      inv.server.processes.some((p) => p.name.startsWith(`${input.project}-`)) ||
      inv.sites.some((s) => s.project?.project === input.project);
    if (exists) errors.project = "A site or folder with this name already exists in /srv/apps.";
  }
  if (!errors.domains) {
    const taken = new Map<string, string>();
    for (const s of inv.sites) for (const d of s.domains) taken.set(d, s.project?.project ?? s.id);
    const clash = input.domains.filter((d) => taken.has(d));
    if (clash.length) errors.domains = `Already used by another site: ${clash.map((d) => `${d} (${taken.get(d)})`).join(", ")}`;
  }
  if (!errors.domains) {
    const notHere = [];
    for (const d of input.domains) if (!(await pointsHere(d))) notHere.push(d);
    if (notHere.length) {
      errors.domains = `${notHere.join(", ")} ${notHere.length === 1 ? "doesn't" : "don't"} point to this server yet. Add an A record for ${await serverIp()} at your DNS provider, wait a few minutes, then try again.`;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  let port: number | null = null;
  if (input.type !== "static") {
    const { used } = await vpsctl<{ used: number[] }>(["ports"]);
    const taken = new Set(used);
    const [from, to] = input.type === "nextjs" ? [3500, 3999] : [4500, 4999];
    for (let p = from; p <= to; p++) if (!taken.has(p) && !taken.has(p + 10000)) { port = p; break; }
    if (!port) return { ok: false, errors: { project: "No free port left in the range." } };
  }

  const folder = `/srv/apps/${input.project}`;
  const process = input.type === "static" ? null : `${input.project}-${input.app}`;
  const keys = envKeys(input.envText);
  const warnings: string[] = [];
  if (input.envText.trim() && !keys.length) warnings.push("The settings box has text but no KEY=value lines.");

  const creates = [
    `Folder ${folder}/${input.app} with the code from ${input.owner}/${input.repo} (${input.branch}${input.subdir ? `, folder ${input.subdir}` : ""})`,
    keys.length ? `Settings file with ${keys.length} value${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}` : "Empty settings file (you can add values later)",
    [input.install, input.build].filter(Boolean).length ? `Install and build: ${[input.install, input.build].filter(Boolean).join(" → ")}` : "No build step",
    process ? `Process ${process} on port ${port}, running as user apps` : `Static files published to /var/www/shipyard/${input.project}/${input.app}`,
    `nginx config /etc/nginx/sites-available/${input.domains[0]}.conf for ${input.domains.join(", ")}`,
    `Free SSL certificate for ${input.domains.join(", ")}, with http → https redirect`,
  ];

  const { envText, ...rest } = input;
  void envText;
  return {
    ok: true,
    plan: {
      input: { ...rest, envKeys: keys },
      port,
      process,
      folder,
      nginxFile: `/etc/nginx/sites-available/${input.domains[0]}.conf`,
      creates,
      warnings,
    },
  };
}

export async function createSiteJob(input: SiteInput, plan: SitePlan, actor: string): Promise<string> {
  const params: CreateParams = {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    project: input.project,
    app: input.app,
    type: input.type,
    subdir: input.subdir,
    install: input.install,
    build: input.build,
    start: input.start,
    output: input.output,
    domains: input.domains,
    port: plan.port,
    envSealed: input.envText ? seal(input.envText) : "",
  };
  return enqueueJob({
    kind: "create",
    project: input.project,
    title: `Create ${input.project} from ${input.owner}/${input.repo}`,
    actor,
    params: params as unknown as Record<string, unknown>,
    steps: createSteps(),
    summary: { repo: `${input.owner}/${input.repo}`, branch: input.branch, domain: input.domains[0], type: input.type },
  });
}

export type RecordApp = {
  name: string;
  path?: string;
  repo?: string;
  branch?: string;
  type?: AppType;
  subdir?: string;
  install?: string;
  build?: string;
  start?: string;
  output?: string;
  port?: number;
  release?: string;
  slot?: string;
  route?: string;
  domains?: string[];
  own_domain?: boolean;
};

export type ReleaseInfo = {
  id: string;
  source: string;
  commit: string;
  message: string;
  created: string;
  activated?: string;
  status: string;
};

export function sourceOf(a: RecordApp): string {
  return (a.path ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
}

export function deployableApps(record: { created_by?: unknown; apps?: unknown[] } | null): RecordApp[] {
  if (!record || record.created_by !== "shipyard" || !Array.isArray(record.apps)) return [];
  return (record.apps as RecordApp[]).filter((a) => a.repo && a.type);
}

export function deploySources(record: { created_by?: unknown; apps?: unknown[] } | null) {
  const seen = new Map<string, { source: string; repo: string; branch: string }>();
  for (const a of deployableApps(record)) {
    const source = sourceOf(a);
    if (!seen.has(source)) seen.set(source, { source, repo: a.repo!, branch: a.branch ?? "main" });
  }
  return [...seen.values()];
}

export async function deployJob(project: string, record: { created_by?: unknown; apps?: unknown[] }, actor: string): Promise<string> {
  const sources = deploySources(record);
  if (!sources.length) throw new Error("This site isn't linked to GitHub, so it can't be deployed from Shipyard.");
  return enqueueJob({
    kind: "deploy",
    project,
    title: `Deploy ${project}`,
    actor,
    params: { sources } as unknown as Record<string, unknown>,
    steps: deploySteps(sources.map((s) => s.source)),
  });
}

export async function rollbackJob(project: string, source: string, release: string, actor: string): Promise<string> {
  return enqueueJob({
    kind: "rollback",
    project,
    title: `Roll back ${project} to ${release}`,
    actor,
    params: { source, release },
    steps: rollbackSteps(source),
  });
}

const ROUTE = /^\/[a-z0-9][a-z0-9_-]{0,30}(?:\/[a-z0-9][a-z0-9_-]{0,30}){0,3}$/;
const RESERVED = new Set(["env", "pm2", "logs", "releases", "shared", "project", "backups"]);
const APP_TYPES: AppType[] = ["nextjs", "node", "python"];

export type AppInput = {
  owner: string;
  repo: string;
  branch: string;
  app: string;
  type: AppType;
  subdir: string;
  install: string;
  build: string;
  start: string;
  reach: "path" | "domain";
  route: string;
  domains: string[];
  envText: string;
};

export type AppPlan = { port: number; process: string; creates: string[]; warnings: string[] };
export type AppPlanResult = { ok: true; plan: AppPlan } | { ok: false; errors: Record<string, string> };

export function parseAppInput(form: FormData): AppInput {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    owner: s("owner"),
    repo: s("repo"),
    branch: s("branch"),
    app: s("app").toLowerCase(),
    type: s("type") as AppType,
    subdir: s("subdir").replace(/^\/+|\/+$/g, ""),
    install: s("install"),
    build: s("build"),
    start: s("start"),
    reach: s("reach") === "domain" ? "domain" : "path",
    route: ("/" + s("route").replace(/^\/+|\/+$/g, "")).toLowerCase(),
    domains: s("domains")
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter(Boolean),
    envText: String(form.get("envText") ?? ""),
  };
}

export async function planApp(project: string, input: AppInput): Promise<AppPlanResult> {
  const errors: Record<string, string> = {};
  const inv = await getInventory();
  const rec = inv.projects.find((p) => p.project === project) as { created_by?: string; status?: string; apps?: RecordApp[]; domains?: string[] } | undefined;
  if (!rec || rec.created_by !== "shipyard") return { ok: false, errors: { form: "This site isn't managed by Shipyard." } };
  if (rec.status && rec.status !== "active") return { ok: false, errors: { form: "This site is still being set up. Try again when it's live." } };
  const apps = rec.apps ?? [];

  if (!GH.test(input.owner) || !GH.test(input.repo)) errors.repo = "Pick a repository.";
  if (!BRANCH.test(input.branch)) errors.branch = "Pick a valid branch.";
  if (!NAME.test(input.app)) errors.app = "Use lowercase letters, numbers and dashes.";
  else if (RESERVED.has(input.app)) errors.app = `${input.app} is reserved. Try api or worker.`;
  else if (apps.some((a) => a.name === input.app || sourceOf(a) === input.app)) errors.app = "This site already has an app or folder with that name.";
  if (!APP_TYPES.includes(input.type)) errors.type = "Pick Next.js, Node.js API or Python API.";
  if (!SUBDIR.test(input.subdir)) errors.subdir = "Use a folder path inside the repository, like backend.";
  for (const [k, v] of [["install", input.install], ["build", input.build], ["start", input.start]] as const) {
    if (badCommand(v)) errors[k] = "Keep the command on one line, under 500 characters.";
  }
  if (!input.start) errors.start = "A start command is needed to run the app.";
  if (input.envText.length > 64 * 1024) errors.envText = "Settings are too long (64 KB max).";

  if (input.reach === "path") {
    if (input.route === "/" || !ROUTE.test(input.route)) errors.route = "Use a path like /api (lowercase letters, numbers, - and _).";
    else if (apps.some((a) => a.route === input.route)) errors.route = `${input.route} already goes to another app.`;
  } else {
    if (!input.domains.length) errors.domains = "Add a domain, like api.example.com.";
    else if (input.domains.length > 5) errors.domains = "Use 5 domains or fewer.";
    else {
      const bad = input.domains.filter((d) => !DOMAIN.test(d));
      if (bad.length) errors.domains = `Not a valid domain: ${bad.join(", ")}`;
    }
    if (!errors.domains) {
      const taken = new Map<string, string>();
      for (const s of inv.sites) for (const d of s.domains) taken.set(d, s.project?.project ?? s.id);
      for (const d of rec.domains ?? []) taken.set(d, project);
      const clash = input.domains.filter((d) => taken.has(d));
      if (clash.length) errors.domains = `Already used: ${clash.map((d) => `${d} (${taken.get(d)})`).join(", ")}`;
    }
    if (!errors.domains) {
      const notHere = [];
      for (const d of input.domains) if (!(await pointsHere(d))) notHere.push(d);
      if (notHere.length) errors.domains = `${notHere.join(", ")} ${notHere.length === 1 ? "doesn't" : "don't"} point to this server yet. Add an A record for ${await serverIp()} first.`;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const { used } = await vpsctl<{ used: number[] }>(["ports"]);
  const taken = new Set(used);
  const [from, to] = input.type === "nextjs" ? [3500, 3999] : [4500, 4999];
  let port = 0;
  for (let p = from; p <= to; p++) if (!taken.has(p) && !taken.has(p + 10000)) { port = p; break; }
  if (!port) return { ok: false, errors: { form: "No free port left in the range." } };

  const keys = envKeys(input.envText);
  const process = `${project}-${input.app}`;
  const main = apps[0];
  const siteDomain = (rec.domains ?? []).find((d) => !d.startsWith("www.")) ?? project;
  const warnings: string[] = [];
  if (input.envText.trim() && !keys.length) warnings.push("The settings box has text but no KEY=value lines.");
  if (input.reach === "path" && main?.type === "nextjs") {
    warnings.push(`If your Next.js site has its own ${input.route} routes (like app${input.route}), those requests will go to ${input.app} instead.`);
  }
  if (input.reach === "path" && input.type === "nextjs") {
    warnings.push(`A Next.js app on a path needs basePath: "${input.route}" in its next.config, or its pages and assets won't load.`);
  }
  if (input.reach === "path") warnings.push(`Requests keep the full path, so ${input.app} receives ${input.route}/users, not /users.`);

  const creates = [
    `Folder /srv/apps/${project}/${input.app} with the code from ${input.owner}/${input.repo} (${input.branch}${input.subdir ? `, folder ${input.subdir}` : ""})`,
    keys.length ? `Settings file with ${keys.length} value${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}` : "Empty settings file (you can add values later)",
    [input.install, input.build].filter(Boolean).length ? `Install and build: ${[input.install, input.build].filter(Boolean).join(" → ")}` : "No build step",
    `Process ${process} on port ${port}, running as user apps`,
    input.reach === "path"
      ? `Route ${siteDomain}${input.route}/… to ${input.app} (nginx is tested before reload)`
      : `nginx config for ${input.domains.join(", ")} with a free SSL certificate`,
    `${input.app} is added to ${project}'s record, so backups and delete include it`,
  ];
  return { ok: true, plan: { port, process, creates, warnings } };
}

export async function addAppJob(project: string, input: AppInput, plan: AppPlan, actor: string): Promise<string> {
  const route = input.reach === "path" ? input.route : "";
  const domains = input.reach === "domain" ? input.domains : [];
  const params: AddAppParams = {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    app: input.app,
    type: input.type,
    subdir: input.subdir,
    install: input.install,
    build: input.build,
    start: input.start,
    port: plan.port,
    envSealed: input.envText ? seal(input.envText) : "",
    route,
    domains,
  };
  return enqueueJob({
    kind: "app-add",
    project,
    title: `Add ${input.app} to ${project}`,
    actor,
    params: params as unknown as Record<string, unknown>,
    steps: addAppSteps(input.app, route, domains),
    summary: { repo: `${input.owner}/${input.repo}`, branch: input.branch, app: input.app, route: route || domains[0] },
  });
}

export async function removeAppJob(project: string, app: string, actor: string): Promise<string> {
  return enqueueJob({
    kind: "app-remove",
    project,
    title: `Remove ${app} from ${project}`,
    actor,
    params: { app },
    steps: removeAppSteps(app),
  });
}
