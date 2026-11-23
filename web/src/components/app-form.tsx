"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrandNextjs,
  IconBrandNodejs,
  IconBrandPython,
  IconCircleCheck,
  IconInfoCircle,
  IconPlus,
} from "@tabler/icons-react";
import type { AppType, Detection } from "@/lib/github";
import { addApp, previewApp, type AppPreviewState } from "@/app/(panel)/sites/actions";
import { cx } from "./ui";
import { WILDCARD_DOMAIN } from "@/lib/locale";

const TYPES: { key: AppType; label: string; hint: string; icon: typeof IconBrandNextjs }[] = [
  { key: "node", label: "Node.js API", hint: "Express or similar", icon: IconBrandNodejs },
  { key: "python", label: "Python API", hint: "FastAPI, Flask…", icon: IconBrandPython },
  { key: "nextjs", label: "Next.js", hint: "Needs basePath on a path", icon: IconBrandNextjs },
];

const DEFAULTS: Record<string, { install: string; build: string; start: string }> = {
  nextjs: { install: "npm ci", build: "npm run build", start: "node_modules/.bin/next start -p $PORT -H 127.0.0.1" },
  node: { install: "npm ci", build: "", start: "npm start" },
  python: {
    install: "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
    build: "",
    start: ".venv/bin/uvicorn main:app --host 127.0.0.1 --port $PORT",
  },
};

const input =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-fg/40 focus:ring-4 focus:ring-fg/[0.06]";
const mono = `${input} font-mono text-[13px]`;

function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-xs text-bad-fg">
          <IconAlertCircle size={14} className="mt-px shrink-0" aria-hidden />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>
      )}
    </label>
  );
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-xs font-semibold">{step}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Choice({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx("rounded-lg border p-3 text-left", on ? "border-fg bg-subtle" : "border-line-strong hover:bg-hover")}
    >
      <span className="block text-sm font-medium">{title}</span>
      {children}
    </button>
  );
}

type Props = {
  project: string;
  siteId: string;
  siteDomain: string;
  mainRepo: string;
  repos: string[];
  repo: string;
  branches: string[];
  branch: string;
  subdir: string;
  detection: Detection;
  taken: string[];
};

export function AppForm({ project, siteId, siteDomain, mainRepo, repos, repo, branches, branch, subdir, detection, taken }: Props) {
  const router = useRouter();
  const detected: AppType = detection.type === "static" ? "node" : detection.type;
  const [type, setType] = useState<AppType>(detected);
  const [cmds, setCmds] = useState(() =>
    detection.type === "static" ? DEFAULTS.node : { install: detection.install, build: detection.build, start: detection.start },
  );
  const [v, setV] = useState({ app: taken.includes("api") ? "worker" : "api", reach: "path" as "path" | "domain", route: "/api", domains: "", envText: "" });
  const [subdirDraft, setSubdirDraft] = useState(subdir);
  const [version, setVersion] = useState(0);
  const [reviewedVersion, setReviewedVersion] = useState(-1);
  const [preview, reviewAction, reviewing] = useActionState<AppPreviewState, FormData>(previewApp.bind(null, project), null);
  const [created, createAction, creating] = useActionState<AppPreviewState, FormData>(addApp.bind(null, project), null);
  const [owner, name] = repo.split("/");

  const errors = (created && !created.ok ? created.errors : preview && !preview.ok ? preview.errors : {}) as Record<string, string>;
  const plan = preview?.ok && reviewedVersion === version ? preview.plan : null;
  const touch = () => setVersion((n) => n + 1);

  const go = (r: string, b: string, s: string) => {
    const q = new URLSearchParams({ repo: r });
    if (b) q.set("branch", b);
    if (s) q.set("subdir", s);
    router.push(`/sites/${encodeURIComponent(siteId)}/add-app?${q}`);
  };

  const chooseType = (t: AppType) => {
    setType(t);
    setCmds(t === detection.type ? { install: detection.install, build: detection.build, start: detection.start } : DEFAULTS[t]);
    touch();
  };

  return (
    <form onChange={touch} className="space-y-4 pb-24">
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="repo" value={name} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="subdir" value={subdir} />
      <input type="hidden" name="reach" value={v.reach} />

      <Section step={1} title="Where is the code?">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Repository" hint={repo === mainRepo ? "Same repository as the site" : "A different repository"} error={errors.repo}>
            <select value={repo} onChange={(e) => go(e.target.value, "", "")} className={input}>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                  {r === mainRepo ? " (this site)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Branch" error={errors.branch}>
            <select name="branch" value={branch} onChange={(e) => go(repo, e.target.value, subdir)} className={input}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Folder" hint="Where the backend lives, like backend. Empty means the top." error={errors.subdir}>
            <div className="flex gap-2">
              <input value={subdirDraft} onChange={(e) => setSubdirDraft(e.target.value)} placeholder="backend" className={mono} />
              {subdirDraft.replace(/^\/+|\/+$/g, "") !== subdir && (
                <button
                  type="button"
                  onClick={() => go(repo, branch, subdirDraft.replace(/^\/+|\/+$/g, ""))}
                  className="shrink-0 rounded-lg border border-line-strong px-3 text-sm hover:bg-hover"
                >
                  Apply
                </button>
              )}
            </div>
          </Field>
        </div>
      </Section>

      <Section step={2} title="App">
        <div className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2 text-sm text-info-fg">
          <IconInfoCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Detected: {detection.reason}
            {detection.type === "static" ? " Static sites can't be added as a second app, so Node.js is selected." : ""}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App name" hint={`Process name: ${project}-${v.app || "…"}`} error={errors.app}>
            <input name="app" value={v.app} onChange={(e) => setV({ ...v, app: e.target.value })} required pattern="[a-z0-9][a-z0-9\-]{0,40}" className={mono} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="App type">
          {TYPES.map(({ key, label, hint, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={type === key}
              onClick={() => chooseType(key)}
              className={cx(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left",
                type === key ? "border-fg bg-subtle" : "border-line-strong hover:bg-hover",
              )}
            >
              <Icon size={20} aria-hidden />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-faint">{hint}</span>
            </button>
          ))}
        </div>
        {errors.type && <p className="text-xs text-bad-fg">{errors.type}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Install command" hint="Leave empty to skip." error={errors.install}>
            <input name="install" value={cmds.install} onChange={(e) => setCmds({ ...cmds, install: e.target.value })} className={mono} />
          </Field>
          <Field label="Build command" hint="Leave empty to skip." error={errors.build}>
            <input name="build" value={cmds.build} onChange={(e) => setCmds({ ...cmds, build: e.target.value })} className={mono} />
          </Field>
          <Field
            label="Start command"
            hint={
              <>
                <code className="font-mono">$PORT</code> is set for you.
              </>
            }
            error={errors.start}
          >
            <input name="start" value={cmds.start} onChange={(e) => setCmds({ ...cmds, start: e.target.value })} required className={mono} />
          </Field>
        </div>
      </Section>

      <Section step={3} title="How visitors reach it">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How visitors reach it">
          <Choice on={v.reach === "path"} onClick={() => (setV({ ...v, reach: "path" }), touch())} title="A path on the site (recommended)">
            <span className="mt-1 block text-xs text-faint">No CORS and no new domain. The site calls it at {v.route || "/api"}.</span>
          </Choice>
          <Choice on={v.reach === "domain"} onClick={() => (setV({ ...v, reach: "domain" }), touch())} title="Its own domain">
            <span className="mt-1 block text-xs text-faint">Like api.{siteDomain}, with its own SSL certificate.</span>
          </Choice>
        </div>
        {v.reach === "path" ? (
          <Field
            label="Path"
            hint={
              <>
                Visitors reach it at{" "}
                <code className="font-mono">
                  {siteDomain}
                  {v.route || "/api"}/…
                </code>
              </>
            }
            error={errors.route}
          >
            <input name="route" value={v.route} onChange={(e) => setV({ ...v, route: e.target.value })} placeholder="/api" className={mono} />
          </Field>
        ) : (
          <Field
            label="Domain"
            hint={
              WILDCARD_DOMAIN ? (
                <>
                  Any <code className="font-mono">*.{WILDCARD_DOMAIN}</code> address already points to this server.
                </>
              ) : (
                "Point the domain's A record to this server first."
              )
            }
            error={errors.domains}
          >
            <input
              name="domains"
              value={v.domains}
              onChange={(e) => setV({ ...v, domains: e.target.value })}
              placeholder={`api.${siteDomain}`}
              autoComplete="off"
              className={mono}
            />
          </Field>
        )}
      </Section>

      <Section step={4} title="Settings (.env)">
        <Field label="Environment variables" hint="One KEY=value per line. Stored privately on the server." error={errors.envText}>
          <textarea
            name="envText"
            value={v.envText}
            onChange={(e) => setV({ ...v, envText: e.target.value })}
            rows={5}
            spellCheck={false}
            placeholder={"MONGODB_URI=...\nJWT_SECRET=..."}
            className={`${mono} resize-y`}
          />
        </Field>
      </Section>

      {errors.form && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad-fg">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {errors.form}
        </p>
      )}

      {plan && (
        <section className="rounded-xl border-2 border-fg bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconCircleCheck size={18} className="text-ok" aria-hidden />
            Plan ready. Shipyard will create:
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {plan.creates.map((c) => (
              <li key={c} className="flex gap-2">
                <IconArrowRight size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          {plan.warnings.map((w) => (
            <p key={w} className="mt-3 text-sm text-warn-fg">
              {w}
            </p>
          ))}
          <p className="mt-4 text-xs text-muted">Your site keeps running the whole time. If a step fails, Shipyard removes only what it created for this app.</p>
        </section>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center justify-end gap-3">
          <span className="mr-auto hidden text-xs text-faint sm:block">
            {plan ? "Review the plan above, then add the app." : "Check everything, then review the plan."}
          </span>
          <button
            formAction={(fd) => {
              setReviewedVersion(version);
              reviewAction(fd);
            }}
            disabled={reviewing || creating}
            className={cx(
              "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60",
              plan ? "border border-line-strong bg-surface hover:bg-hover" : "bg-fg text-invert hover:opacity-90",
            )}
          >
            {reviewing ? "Checking…" : plan ? "Check again" : "Review plan"}
          </button>
          {plan && (
            <button
              formAction={createAction}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-4 py-2 text-sm font-medium text-invert hover:opacity-90 disabled:opacity-60"
            >
              <IconPlus size={16} aria-hidden />
              {creating ? "Starting…" : "Add app"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
