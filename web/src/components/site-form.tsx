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
  IconFileCode,
  IconInfoCircle,
  IconRocket,
} from "@tabler/icons-react";
import type { AppType, Detection } from "@/lib/github";
import { createSite, previewSite, type PreviewState } from "@/app/(panel)/sites/actions";
import { cx } from "./ui";
import { WILDCARD_DOMAIN } from "@/lib/locale";

const TYPES: { key: AppType; label: string; hint: string; icon: typeof IconBrandNextjs }[] = [
  { key: "nextjs", label: "Next.js", hint: "Website with next start", icon: IconBrandNextjs },
  { key: "node", label: "Node.js API", hint: "Express or similar", icon: IconBrandNodejs },
  { key: "static", label: "Static site", hint: "HTML served by nginx", icon: IconFileCode },
  { key: "python", label: "Python API", hint: "FastAPI, Flask…", icon: IconBrandPython },
];

const DEFAULTS: Record<AppType, Pick<Detection, "install" | "build" | "start" | "output">> = {
  nextjs: { install: "npm ci", build: "npm run build", start: "node_modules/.bin/next start -p $PORT -H 127.0.0.1", output: "" },
  node: { install: "npm ci", build: "", start: "npm start", output: "" },
  static: { install: "", build: "", start: "", output: "" },
  python: { install: "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt", build: "", start: ".venv/bin/uvicorn main:app --host 127.0.0.1 --port $PORT", output: "" },
};

const input = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-fg focus:ring-2 focus:ring-fg/10";
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

type Props = {
  owner: string;
  repo: string;
  branches: string[];
  branch: string;
  subdir: string;
  detection: Detection;
  defaults: { project: string; app: string };
};

export function SiteForm({ owner, repo, branches, branch, subdir, detection, defaults }: Props) {
  const router = useRouter();
  const [type, setType] = useState<AppType>(detection.type);
  const [cmds, setCmds] = useState(() => ({ install: detection.install, build: detection.build, start: detection.start, output: detection.output }));
  const [subdirDraft, setSubdirDraft] = useState(subdir);
  const [site, setSite] = useState({ project: defaults.project, app: defaults.app, domains: "", envText: "" });
  const [version, setVersion] = useState(0);
  const [preview, reviewAction, reviewing] = useActionState<PreviewState, FormData>(previewSite, null);
  const [created, createAction, creating] = useActionState<PreviewState, FormData>(createSite, null);
  const [reviewedVersion, setReviewedVersion] = useState(-1);

  const errors = (created && !created.ok ? created.errors : preview && !preview.ok ? preview.errors : {}) as Record<string, string>;
  const plan = preview?.ok && reviewedVersion === version ? preview.plan : null;
  const touch = () => setVersion((v) => v + 1);

  const chooseType = (t: AppType) => {
    setType(t);
    setCmds(t === detection.type ? { install: detection.install, build: detection.build, start: detection.start, output: detection.output } : DEFAULTS[t]);
    touch();
  };

  const nav = (b: string, s: string) => {
    const q = new URLSearchParams();
    if (b) q.set("branch", b);
    if (s) q.set("subdir", s);
    router.push(`/sites/new/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${q}`);
  };

  return (
    <form onChange={touch} className="space-y-4 pb-24">
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="repo" value={repo} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="subdir" value={subdir} />

      <Section step={1} title="Source">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Branch" error={errors.branch}>
            <select name="branch" defaultValue={branch} onChange={(e) => nav(e.target.value, subdir)} className={input}>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Folder inside the repository" hint="Leave empty if the app is at the top of the repository." error={errors.subdir}>
            <div className="flex gap-2">
              <input value={subdirDraft} onChange={(e) => setSubdirDraft(e.target.value)} placeholder="apps/web" className={mono} />
              {subdirDraft.replace(/^\/+|\/+$/g, "") !== subdir && (
                <button type="button" onClick={() => nav(branch, subdirDraft.replace(/^\/+|\/+$/g, ""))} className="shrink-0 rounded-lg border border-line-strong px-3 text-sm hover:bg-hover">
                  Apply
                </button>
              )}
            </div>
          </Field>
        </div>
      </Section>

      <Section step={2} title="Site">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site name" hint={`Folder /srv/apps/<name>`} error={errors.project}>
            <input name="project" value={site.project} onChange={(e) => setSite({ ...site, project: e.target.value })} required pattern="[a-z0-9][a-z0-9\-]{0,40}" className={mono} />
          </Field>
          <Field label="App name" hint="Used in the process name, like name-web." error={errors.app}>
            <input name="app" value={site.app} onChange={(e) => setSite({ ...site, app: e.target.value })} required pattern="[a-z0-9][a-z0-9\-]{0,40}" className={mono} />
          </Field>
        </div>
        <Field
          label="Domains"
          hint={<>Separate with spaces or commas, like <code className="font-mono">shop.example.com www.shop.example.com</code>.{WILDCARD_DOMAIN && <> Any <code className="font-mono">*.{WILDCARD_DOMAIN}</code> address already points to this server.</>}</>}
          error={errors.domains}
        >
          <input name="domains" value={site.domains} onChange={(e) => setSite({ ...site, domains: e.target.value })} required placeholder={WILDCARD_DOMAIN ? `myapp.${WILDCARD_DOMAIN}` : "myapp.example.com"} autoComplete="off" className={mono} />
        </Field>
      </Section>

      <Section step={3} title="How to build and run it">
        <div className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2 text-sm text-info-fg">
          <IconInfoCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>Detected: {detection.reason}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Project type">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Install command" hint="Leave empty to skip." error={errors.install}>
            <input name="install" value={cmds.install} onChange={(e) => setCmds({ ...cmds, install: e.target.value })} className={mono} />
          </Field>
          <Field label="Build command" hint="Leave empty to skip." error={errors.build}>
            <input name="build" value={cmds.build} onChange={(e) => setCmds({ ...cmds, build: e.target.value })} className={mono} />
          </Field>
        </div>
        {type === "static" ? (
          <Field label="Output folder" hint="Folder with index.html after the build, like dist or out. Empty means the repository itself." error={errors.output}>
            <input name="output" value={cmds.output} onChange={(e) => setCmds({ ...cmds, output: e.target.value })} placeholder="dist" className={mono} />
          </Field>
        ) : (
          <Field label="Start command" hint={<>Runs as user <code className="font-mono">apps</code>. <code className="font-mono">$PORT</code> is set for you.</>} error={errors.start}>
            <input name="start" value={cmds.start} onChange={(e) => setCmds({ ...cmds, start: e.target.value })} required className={mono} />
          </Field>
        )}
      </Section>

      <Section step={4} title="Settings (.env)">
        <Field label="Environment variables" hint="One KEY=value per line. Stored privately on the server, never in the database or logs." error={errors.envText}>
          <textarea
            name="envText"
            value={site.envText}
            onChange={(e) => setSite({ ...site, envText: e.target.value })}
            rows={6}
            spellCheck={false}
            placeholder={"DATABASE_URL=...\nNEXT_PUBLIC_SITE_URL=https://myapp.example.com"}
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
            <p key={w} className="mt-3 text-sm text-warn-fg">{w}</p>
          ))}
          <p className="mt-4 text-xs text-muted">If any step fails, Shipyard stops and removes everything it created.</p>
        </section>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center justify-end gap-3">
          <span className="mr-auto hidden text-xs text-faint sm:block">
            {plan ? "Review the plan above, then create the site." : "Check everything, then review the plan."}
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
              <IconRocket size={16} aria-hidden />
              {creating ? "Starting…" : "Create site"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
