import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://api.github.com";

export type Repo = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
};

export type AppType = "nextjs" | "node" | "static" | "python";

export type Detection = {
  type: AppType;
  reason: string;
  install: string;
  build: string;
  start: string;
  output: string;
};

export class GitHubError extends Error {}

function config() {
  const appId = process.env.GITHUB_APP_ID;
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!appId || !keyPath) return null;
  return { appId, keyPath, slug: process.env.GITHUB_APP_SLUG || "" };
}

export function githubConfigured(): boolean {
  return config() !== null;
}

export function githubInstallUrl(): string | null {
  const c = config();
  return c?.slug ? `https://github.com/apps/${c.slug}/installations/new` : null;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function appJwt(): string {
  const c = config();
  if (!c) throw new GitHubError("GitHub App is not configured");
  const key = readFileSync(c.keyPath, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: c.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(key))}`;
}

async function gh<T>(path: string, auth: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shipyard-panel",
      Authorization: `Bearer ${auth}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubError(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

let installationCache: { id: number; account: string } | null = null;
let tokenCache: { token: string; expires: number } | null = null;

export async function installation(): Promise<{ id: number; account: string } | null> {
  if (installationCache) return installationCache;
  const list = await gh<{ id: number; account: { login: string } }[]>("/app/installations", appJwt());
  if (!list.length) return null;
  installationCache = { id: list[0].id, account: list[0].account.login };
  return installationCache;
}

export async function installationToken(): Promise<string> {
  if (tokenCache && tokenCache.expires - Date.now() > 10 * 60 * 1000) return tokenCache.token;
  const inst = await installation();
  if (!inst) throw new GitHubError("The Shipyard GitHub App is not installed on your account yet");
  const res = await gh<{ token: string; expires_at: string }>(`/app/installations/${inst.id}/access_tokens`, appJwt(), {
    method: "POST",
  });
  tokenCache = { token: res.token, expires: Date.parse(res.expires_at) };
  return res.token;
}

type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  pushed_at: string | null;
  language: string | null;
  owner: { login: string };
};

export async function listRepos(): Promise<Repo[]> {
  const token = await installationToken();
  const repos: Repo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await gh<{ repositories: RawRepo[]; total_count: number }>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    for (const r of res.repositories) {
      repos.push({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description,
        defaultBranch: r.default_branch,
        pushedAt: r.pushed_at,
        language: r.language,
      });
    }
    if (repos.length >= res.total_count || res.repositories.length < 100) break;
  }
  return repos.sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
}

export async function getRepo(owner: string, name: string): Promise<Repo> {
  const r = await gh<RawRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, await installationToken());
  return {
    id: r.id,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    language: r.language,
  };
}

export async function listBranches(owner: string, name: string): Promise<string[]> {
  const res = await gh<{ name: string }[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100`,
    await installationToken(),
  );
  return res.map((b) => b.name);
}

async function readFile(owner: string, name: string, path: string, ref: string): Promise<string | null> {
  try {
    const res = await gh<{ content?: string; encoding?: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
      await installationToken(),
    );
    return res.content && res.encoding === "base64" ? Buffer.from(res.content, "base64").toString("utf8") : null;
  } catch {
    return null;
  }
}

async function listDir(owner: string, name: string, path: string, ref: string): Promise<string[]> {
  try {
    const res = await gh<{ name: string }[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}?ref=${encodeURIComponent(ref)}`,
      await installationToken(),
    );
    return Array.isArray(res) ? res.map((f) => f.name) : [];
  } catch {
    return [];
  }
}

const ASGI_CANDIDATES = ["main.py", "app.py", "server.py", "asgi.py", "app/main.py", "app/app.py", "app/server.py", "api/main.py", "src/main.py", "src/app/main.py", "src/app.py"];

async function findAsgiApp(owner: string, name: string, prefix: string, ref: string, top: string[]) {
  const candidates = ASGI_CANDIDATES.filter((c) => top.includes(c.split("/")[0]));
  for (const file of candidates) {
    const text = await readFile(owner, name, `${prefix}${file}`, ref);
    const m = text?.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[\w.]+\s*)?=\s*(?:fastapi\.)?(?:FastAPI|Starlette)\s*\(/m);
    if (!m) continue;
    const src = file.startsWith("src/");
    const rel = src ? file.slice(4) : file;
    return { file: `${prefix}${file}`, dir: src ? "src" : "", module: rel.replace(/\.py$/, "").split("/").join("."), variable: m[1] };
  }
  return null;
}

export async function detect(owner: string, name: string, ref: string, subdir = ""): Promise<Detection> {
  const prefix = subdir ? `${subdir.replace(/^\/+|\/+$/g, "")}/` : "";
  const files = await listDir(owner, name, prefix.replace(/\/$/, ""), ref);
  const has = (f: string) => files.includes(f);
  const npmInstall = has("package-lock.json") ? "npm ci" : has("pnpm-lock.yaml") ? "npx pnpm install --frozen-lockfile" : "npm install";

  if (has("package.json")) {
    const pkg = JSON.parse((await readFile(owner, name, `${prefix}package.json`, ref)) || "{}") as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts ?? {};
    if (deps.next) {
      return {
        type: "nextjs",
        reason: `Next.js ${deps.next} found in package.json`,
        install: npmInstall,
        build: "npm run build",
        start: "node_modules/.bin/next start -p $PORT -H 127.0.0.1",
        output: "",
      };
    }
    const isStaticBuild = (deps.vite || deps["react-scripts"] || deps.astro) && !scripts.start?.includes("node ");
    if (isStaticBuild && scripts.build) {
      return {
        type: "static",
        reason: "Front-end build tool found (Vite, CRA or Astro) with no server",
        install: npmInstall,
        build: "npm run build",
        start: "",
        output: deps["react-scripts"] ? "build" : "dist",
      };
    }
    return {
      type: "node",
      reason: scripts.start ? `Node.js app with start script "${scripts.start}"` : "package.json found",
      install: npmInstall,
      build: scripts.build ? "npm run build" : "",
      start: scripts.start ? "npm start" : "node index.js",
      output: "",
    };
  }

  if (has("requirements.txt") || has("pyproject.toml")) {
    const req = ((await readFile(owner, name, `${prefix}requirements.txt`, ref)) || "") +
      ((await readFile(owner, name, `${prefix}pyproject.toml`, ref)) || "");
    const fastapi = /fastapi|uvicorn|starlette/i.test(req);
    const install =
      has("uv.lock") || has("pyproject.toml")
        ? "uv sync --no-dev"
        : "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt";
    if (fastapi) {
      const found = await findAsgiApp(owner, name, prefix, ref, files);
      const target = found ? `${found.dir ? `--app-dir ${found.dir} ` : ""}${found.module}:${found.variable}` : "main:app";
      return {
        type: "python",
        reason: found ? `FastAPI app found in ${found.file}` : "Python project using FastAPI / Uvicorn (entry file not found, check the start command)",
        install,
        build: "",
        start: `.venv/bin/uvicorn ${target} --host 127.0.0.1 --port $PORT`,
        output: "",
      };
    }
    const entry = has("main.py") ? "main" : has("app.py") ? "app" : "main";
    return {
      type: "python",
      reason: "Python project found",
      install,
      build: "",
      start: `.venv/bin/python ${entry}.py`,
      output: "",
    };
  }

  return {
    type: "static",
    reason: has("index.html") ? "index.html found, served as a static site" : "No package.json or Python files found",
    install: "",
    build: "",
    start: "",
    output: "",
  };
}

export async function latestCommit(owner: string, name: string, branch: string): Promise<{ sha: string; message: string; date: string } | null> {
  try {
    const res = await gh<{ sha: string; commit: { message: string; committer: { date: string } } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(branch)}`,
      await installationToken(),
    );
    return { sha: res.sha, message: res.commit.message.split("\n")[0], date: res.commit.committer.date };
  } catch {
    return null;
  }
}
