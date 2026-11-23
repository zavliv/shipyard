import "server-only";
import { vpsctl } from "./vpsctl";
import { installationToken } from "./github";
import { open } from "./secret";
import type { JobDoc } from "./jobs";
import { spawn } from "node:child_process";

export type StepContext = {
  log: (line: string) => void;
  detail: (text: string) => void;
  state: Record<string, string>;
};

export type StepDef = { key: string; label: string; run: (ctx: StepContext) => Promise<void | "skipped"> };
export type JobPlan = { steps: StepDef[]; onFail?: (ctx: StepContext) => Promise<void> };

const LONG = 40 * 60 * 1000;

export type CreateParams = {
  owner: string;
  repo: string;
  branch: string;
  project: string;
  app: string;
  type: string;
  subdir: string;
  install: string;
  build: string;
  start: string;
  output: string;
  domains: string[];
  port: number | null;
  envSealed: string;
};

export type AddAppParams = {
  owner: string;
  repo: string;
  branch: string;
  app: string;
  type: string;
  subdir: string;
  install: string;
  build: string;
  start: string;
  port: number;
  envSealed: string;
  route: string;
  domains: string[];
};
export type RemoveAppParams = { app: string };

export type DeployParams = { sources: { source: string; repo: string; branch: string }[] };
export type RollbackParams = { source: string; release: string };
export type RestartParams = { targets: { source: string; release: string }[] };
export type RebuildParams = { sources: string[] };
export type DomainParams = { domain: string };
export type DeleteParams = { confirm: string };
export type BackupParams = { projects: string[] };
export type RestoreParams = { file: string; sources: string[] };

const SHIPYARD_DIR = "/srv/panel/shipyard";

export function createSteps(): { key: string; label: string }[] {
  return [
    { key: "init", label: "Create project folder" },
    { key: "clone", label: "Download code from GitHub" },
    { key: "env", label: "Save settings" },
    { key: "release", label: "Prepare release" },
    { key: "build", label: "Install and build" },
    { key: "start", label: "Start the app" },
    { key: "nginx", label: "Connect the domain" },
    { key: "ssl", label: "Get SSL certificate" },
    { key: "finish", label: "Finish" },
  ];
}

export function addAppSteps(app: string, route: string, domains: string[]): { key: string; label: string }[] {
  return [
    { key: "clone", label: "Download code from GitHub" },
    { key: "env", label: "Save settings" },
    { key: "release", label: "Prepare release" },
    { key: "build", label: "Install and build" },
    { key: "start", label: `Start ${app}` },
    ...(route
      ? [{ key: "route", label: `Send ${route} to ${app}` }]
      : [
          { key: "nginx", label: `Connect ${domains[0]}` },
          { key: "ssl", label: "Get SSL certificate" },
        ]),
  ];
}

export function removeAppSteps(app: string) {
  return [{ key: "remove", label: `Back up the site, then remove ${app}` }];
}

export function deploySteps(sources: string[]): { key: string; label: string }[] {
  return sources.flatMap((s) => [
    { key: `prepare:${s}`, label: `Download latest code (${s})` },
    { key: `build:${s}`, label: `Build new release (${s})` },
    { key: `activate:${s}`, label: `Switch traffic (${s})` },
  ]);
}

export function rollbackSteps(source: string): { key: string; label: string }[] {
  return [{ key: `activate:${source}`, label: `Switch back to the earlier release (${source})` }];
}

export function restartSteps(sources: string[]) {
  return sources.map((s) => ({ key: `activate:${s}`, label: `Restart with new settings (${s})` }));
}

export function rebuildSteps(sources: string[]) {
  return sources.flatMap((s) => [
    { key: `prepare:${s}`, label: `Prepare release (${s})` },
    { key: `build:${s}`, label: `Rebuild with new settings (${s})` },
    { key: `activate:${s}`, label: `Switch traffic (${s})` },
  ]);
}

export function domainSteps(kind: "domain-add" | "domain-remove", domain: string) {
  return [{ key: "domain", label: kind === "domain-add" ? `Add ${domain} and extend SSL` : `Remove ${domain}` }];
}

export function deleteSteps() {
  return [
    { key: "delete", label: "Back up and remove everything the site owns" },
  ];
}

export function backupSteps(projects: string[]) {
  return projects.map((p) => ({ key: `backup:${p}`, label: `Back up ${p}` }));
}

export function restoreSteps(sources: string[]) {
  return [
    { key: "restore", label: "Restore files from the backup" },
    ...sources.flatMap((s) => [
      { key: `prepare:${s}`, label: `Prepare release (${s})` },
      { key: `build:${s}`, label: `Install and build (${s})` },
      { key: `activate:${s}`, label: `Start and connect (${s})` },
    ]),
    { key: "finish", label: "Finish" },
  ];
}

export function shipyardUpdateSteps() {
  return [
    { key: "fetch", label: "Download the latest Shipyard from GitHub" },
    { key: "install", label: "Install dependencies" },
    { key: "build", label: "Build Shipyard" },
    { key: "restart", label: "Restart Shipyard" },
  ];
}

function runLocal(cmd: string, args: string[], cwd: string, log: (l: string) => void, extraEnv: Record<string, string> = {}, timeoutMs = 20 * 60 * 1000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv } });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach((l) => log(l));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf) log(buf);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0] ?? ""} failed (exit ${code})`));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function plainSteps(defs: { key: string; label: string }[], runs: Record<string, StepDef["run"]>): StepDef[] {
  return defs.map((d) => ({ ...d, run: runs[d.key] }));
}

export function planFor(job: JobDoc): JobPlan {
  const project = job.project;

  if (job.kind === "create") {
    const p = job.params as unknown as CreateParams;
    let initialised = false;
    const runs: Record<string, StepDef["run"]> = {
      init: async (c) => {
        await vpsctl(["site-init", project], { onLog: c.log });
        initialised = true;
      },
      clone: async (c) => {
        const head = await vpsctl<{ commit: string; message: string }>(["site-clone", project, p.app, p.owner, p.repo, p.branch], {
          input: await installationToken(),
          onLog: c.log,
          timeoutMs: 10 * 60 * 1000,
        });
        c.detail(`${head.commit.slice(0, 7)} ${head.message}`);
      },
      env: async (c) => {
        await vpsctl(["site-env", project, p.app], { input: p.envSealed ? open(p.envSealed) : "", onLog: c.log });
        await vpsctl(["app-config", project, p.app], {
          input: JSON.stringify({
            type: p.type,
            subdir: p.subdir,
            install: p.install,
            build: p.build,
            start: p.start,
            output: p.output,
            ...(p.port ? { port: p.port } : {}),
          }),
          onLog: c.log,
        });
      },
      release: async (c) => {
        const r = await vpsctl<{ release: string }>(["release-prepare", project, p.app], { input: JSON.stringify({ mode: "clean" }), onLog: c.log });
        c.state.release = r.release;
        c.detail(r.release);
      },
      build: async (c) => {
        await vpsctl(["release-build", project, p.app, c.state.release], { input: "{}", onLog: c.log, timeoutMs: LONG });
      },
      start: async (c) => {
        await vpsctl(["release-activate", project, p.app, c.state.release], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        if (p.port) c.detail(`Running on port ${p.port}`);
      },
      nginx: async (c) => {
        await vpsctl(["nginx-add", project], { input: JSON.stringify({ domains: p.domains, app: p.app }), onLog: c.log });
      },
      ssl: async (c) => {
        const res = await vpsctl<{ https_status: number }>(["ssl-issue", project], {
          input: JSON.stringify({ domains: p.domains }),
          onLog: c.log,
          timeoutMs: 6 * 60 * 1000,
        });
        c.detail(`https://${p.domains[0]} answers with HTTP ${res.https_status}`);
      },
      finish: async (c) => void (await vpsctl(["site-finish", project], { onLog: c.log })),
    };
    return {
      steps: plainSteps(createSteps(), runs),
      onFail: async (c) => {
        if (!initialised) {
          c.log("Nothing was created, so there is nothing to roll back.");
          return;
        }
        await vpsctl(["site-remove", project], { onLog: c.log, timeoutMs: 5 * 60 * 1000 });
      },
    };
  }

  if (job.kind === "app-add") {
    const p = job.params as unknown as AddAppParams;
    let cloned = false;
    const runs: Record<string, StepDef["run"]> = {
      clone: async (c) => {
        cloned = true;
        const head = await vpsctl<{ commit: string; message: string }>(["site-clone", project, p.app, p.owner, p.repo, p.branch], {
          input: await installationToken(),
          onLog: c.log,
          timeoutMs: 10 * 60 * 1000,
        });
        c.detail(`${head.commit.slice(0, 7)} ${head.message}`);
      },
      env: async (c) => {
        await vpsctl(["site-env", project, p.app], { input: p.envSealed ? open(p.envSealed) : "", onLog: c.log });
        await vpsctl(["app-config", project, p.app], {
          input: JSON.stringify({ type: p.type, subdir: p.subdir, install: p.install, build: p.build, start: p.start, port: p.port }),
          onLog: c.log,
        });
      },
      release: async (c) => {
        const r = await vpsctl<{ release: string }>(["release-prepare", project, p.app], { input: JSON.stringify({ mode: "clean" }), onLog: c.log });
        c.state.release = r.release;
        c.detail(r.release);
      },
      build: async (c) => {
        await vpsctl(["release-build", project, p.app, c.state.release], { input: "{}", onLog: c.log, timeoutMs: LONG });
      },
      start: async (c) => {
        await vpsctl(["release-activate", project, p.app, c.state.release], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        c.detail(`Running on port ${p.port}`);
      },
      route: async (c) => {
        const r = await vpsctl<{ status: number }>(["route-add", project, p.app], { input: JSON.stringify({ path: p.route }), onLog: c.log });
        c.detail(`${p.route} answers with HTTP ${r.status}`);
      },
      nginx: async (c) => {
        await vpsctl(["nginx-add", project], { input: JSON.stringify({ domains: p.domains, app: p.app, own: true }), onLog: c.log });
      },
      ssl: async (c) => {
        const res = await vpsctl<{ https_status: number }>(["ssl-issue", project], { input: JSON.stringify({ domains: p.domains }), onLog: c.log, timeoutMs: 6 * 60 * 1000 });
        c.detail(`https://${p.domains[0]} answers with HTTP ${res.https_status}`);
      },
    };
    return {
      steps: plainSteps(addAppSteps(p.app, p.route, p.domains), runs),
      onFail: async (c) => {
        if (!cloned) {
          c.log("Nothing was created, so there is nothing to roll back.");
          return;
        }
        await vpsctl(["app-remove", project, p.app], { input: JSON.stringify({ backup: false }), onLog: c.log, timeoutMs: 5 * 60 * 1000 });
        c.log(`Removed everything this job created for ${p.app}. The rest of the site was not touched.`);
      },
    };
  }

  if (job.kind === "app-remove") {
    const p = job.params as unknown as RemoveAppParams;
    return {
      steps: plainSteps(removeAppSteps(p.app), {
        remove: async (c) => {
          const r = await vpsctl<{ removed: string[] }>(["app-remove", project, p.app], { input: JSON.stringify({ backup: true }), onLog: c.log, timeoutMs: 10 * 60 * 1000 });
          c.detail(`Removed ${r.removed.length} items`);
        },
      }),
    };
  }

  if (job.kind === "deploy") {
    const p = job.params as unknown as DeployParams;
    const runs: Record<string, StepDef["run"]> = {};
    for (const s of p.sources) {
      runs[`prepare:${s.source}`] = async (c) => {
        const r = await vpsctl<{ release: string; commit: string; message: string }>(["release-prepare", project, s.source], {
          input: JSON.stringify({ mode: "fetch", token: await installationToken() }),
          onLog: c.log,
          timeoutMs: 10 * 60 * 1000,
        });
        c.state[`release:${s.source}`] = r.release;
        c.detail(`${r.commit.slice(0, 7)} ${r.message}`);
      };
      runs[`build:${s.source}`] = async (c) => {
        const rid = c.state[`release:${s.source}`];
        try {
          await vpsctl(["release-build", project, s.source, rid], { input: "{}", onLog: c.log, timeoutMs: LONG });
        } catch (e) {
          await vpsctl(["release-discard", project, s.source, rid], { onLog: c.log }).catch(() => undefined);
          c.log("The failed release was discarded. The live site was not touched.");
          throw e;
        }
      };
      runs[`activate:${s.source}`] = async (c) => {
        const rid = c.state[`release:${s.source}`];
        try {
          await vpsctl(["release-activate", project, s.source, rid], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        } catch (e) {
          await vpsctl(["release-discard", project, s.source, rid], { onLog: c.log }).catch(() => undefined);
          throw e;
        }
        c.detail(`Live: ${rid}`);
      };
    }
    return { steps: plainSteps(deploySteps(p.sources.map((s) => s.source)), runs) };
  }

  if (job.kind === "restart") {
    const p = job.params as unknown as RestartParams;
    const runs: Record<string, StepDef["run"]> = {};
    for (const t of p.targets) {
      runs[`activate:${t.source}`] = async (c) => {
        await vpsctl(["release-activate", project, t.source, t.release], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        c.detail("New settings are live");
      };
    }
    return { steps: plainSteps(restartSteps(p.targets.map((t) => t.source)), runs) };
  }

  if (job.kind === "rebuild") {
    const p = job.params as unknown as RebuildParams;
    const runs: Record<string, StepDef["run"]> = {};
    for (const s of p.sources) {
      runs[`prepare:${s}`] = async (c) => {
        const r = await vpsctl<{ release: string }>(["release-prepare", project, s], { input: JSON.stringify({ mode: "clean" }), onLog: c.log });
        c.state[`release:${s}`] = r.release;
        c.detail(r.release);
      };
      runs[`build:${s}`] = async (c) => {
        const rid = c.state[`release:${s}`];
        try {
          await vpsctl(["release-build", project, s, rid], { input: "{}", onLog: c.log, timeoutMs: LONG });
        } catch (e) {
          await vpsctl(["release-discard", project, s, rid], { onLog: c.log }).catch(() => undefined);
          throw e;
        }
      };
      runs[`activate:${s}`] = async (c) => {
        const rid = c.state[`release:${s}`];
        try {
          await vpsctl(["release-activate", project, s, rid], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        } catch (e) {
          await vpsctl(["release-discard", project, s, rid], { onLog: c.log }).catch(() => undefined);
          throw e;
        }
        c.detail(`Live: ${rid}`);
      };
    }
    return { steps: plainSteps(rebuildSteps(p.sources), runs) };
  }

  if (job.kind === "domain-add" || job.kind === "domain-remove") {
    const p = job.params as unknown as DomainParams;
    return {
      steps: plainSteps(domainSteps(job.kind, p.domain), {
        domain: async (c) => {
          if (job.kind === "domain-add") {
            const r = await vpsctl<{ https_status: number }>(["domain-add", project], { input: JSON.stringify({ domain: p.domain }), onLog: c.log, timeoutMs: 6 * 60 * 1000 });
            c.detail(`https://${p.domain} answers with HTTP ${r.https_status}`);
          } else {
            await vpsctl(["domain-remove", project], { input: JSON.stringify({ domain: p.domain }), onLog: c.log, timeoutMs: 6 * 60 * 1000 });
            c.detail(`${p.domain} removed`);
          }
        },
      }),
    };
  }

  if (job.kind === "delete") {
    const p = job.params as unknown as DeleteParams;
    return {
      steps: plainSteps(deleteSteps(), {
        delete: async (c) => {
          const r = await vpsctl<{ backup: string; backup_size: number }>(["site-delete", project], {
            input: JSON.stringify({ confirm: p.confirm }),
            onLog: c.log,
            timeoutMs: 15 * 60 * 1000,
          });
          c.detail(`Backup kept at ${r.backup}`);
        },
      }),
    };
  }

  if (job.kind === "backup") {
    const p = job.params as unknown as BackupParams;
    const runs: Record<string, StepDef["run"]> = {};
    for (const proj of p.projects) {
      runs[`backup:${proj}`] = async (c) => {
        const r = await vpsctl<{ size: number }>(["backup-create", proj], { onLog: c.log, timeoutMs: 15 * 60 * 1000 });
        c.detail(`${Math.round(r.size / 1024)} KB`);
      };
    }
    return { steps: plainSteps(backupSteps(p.projects), runs) };
  }

  if (job.kind === "restore") {
    const p = job.params as unknown as RestoreParams;
    const runs: Record<string, StepDef["run"]> = {
      restore: async (c) => void (await vpsctl(["backup-restore", p.file], { onLog: c.log, timeoutMs: 15 * 60 * 1000 })),
      finish: async (c) => void (await vpsctl(["site-finish", project], { onLog: c.log })),
    };
    for (const s of p.sources) {
      runs[`prepare:${s}`] = async (c) => {
        const r = await vpsctl<{ release: string }>(["release-prepare", project, s], { input: JSON.stringify({ mode: "clean" }), onLog: c.log });
        c.state[`release:${s}`] = r.release;
      };
      runs[`build:${s}`] = async (c) =>
        void (await vpsctl(["release-build", project, s, c.state[`release:${s}`]], { input: "{}", onLog: c.log, timeoutMs: LONG }));
      runs[`activate:${s}`] = async (c) =>
        void (await vpsctl(["release-activate", project, s, c.state[`release:${s}`]], { onLog: c.log, timeoutMs: 10 * 60 * 1000 }));
    }
    return { steps: plainSteps(restoreSteps(p.sources), runs) };
  }

  if (job.kind === "shipyard-update") {
    const node = "/opt/node/current/bin";
    const env = { PATH: `${node}:/usr/bin:/bin`, HOME: "/home/panel", GIT_TERMINAL_PROMPT: "0" };
    return {
      steps: plainSteps(shipyardUpdateSteps(), {
        fetch: async (c) => {
          const token = await installationToken();
          const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
          await runLocal("git", ["fetch", "--depth", "1", "origin", "main"], SHIPYARD_DIR, c.log, {
            ...env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
          });
          await runLocal("git", ["reset", "--hard", "FETCH_HEAD"], SHIPYARD_DIR, c.log, env);
          const lines: string[] = [];
          await runLocal("git", ["log", "-1", "--format=%h %s"], SHIPYARD_DIR, (l) => lines.push(l), env);
          c.detail(lines.join(" "));
        },
        install: async (c) => void (await runLocal("npm", ["ci", "--include=dev", "--no-audit", "--no-fund", "--loglevel=error"], `${SHIPYARD_DIR}/web`, c.log, env)),
        build: async (c) => void (await runLocal("npm", ["run", "build"], `${SHIPYARD_DIR}/web`, c.log, env)),
        restart: async (c) => {
          await vpsctl(["shipyard-restart", "web"], { onLog: c.log });
          c.detail("Shipyard is restarting; the worker restarts right after this job");
        },
      }),
    };
  }

  const p = job.params as unknown as RollbackParams;
  return {
    steps: plainSteps(rollbackSteps(p.source), {
      [`activate:${p.source}`]: async (c) => {
        await vpsctl(["release-activate", project, p.source, p.release], { onLog: c.log, timeoutMs: 10 * 60 * 1000 });
        c.detail(`Live: ${p.release}`);
      },
    }),
  };
}
