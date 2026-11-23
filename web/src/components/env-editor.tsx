"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconEyeOff, IconLock, IconPlus, IconTrash } from "@tabler/icons-react";
import { getAppEnv, saveAppEnv } from "@/app/(panel)/sites/manage-actions";
import { Dialog, useToast } from "./overlay";
import { cx } from "./ui";

type Row = { key: string; value: string; shown: boolean };

const input = "w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-fg";
const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-60";
const primary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90 disabled:opacity-60";

function parse(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ key: m[1], value: m[2].replace(/^(["'])(.*)\1$/, "$2"), shown: false }));
}

function serialize(rows: Row[]): string {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key.trim()}=${/[\s#"']/.test(r.value) ? JSON.stringify(r.value) : r.value}`)
    .join("\n") + "\n";
}

function AppEnv({ project, app, type }: { project: string; app: string; type: string }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [original, setOriginal] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const current = raw ?? (rows ? serialize(rows) : "");
  const dirty = rows !== null && current !== original;
  const dupes = useMemo(() => {
    const seen = new Set<string>();
    const d = new Set<string>();
    for (const r of rows ?? []) {
      if (seen.has(r.key)) d.add(r.key);
      seen.add(r.key);
    }
    return d;
  }, [rows]);
  const badKey = (rows ?? []).some((r) => r.key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key));

  const load = () =>
    start(async () => {
      const res = await getAppEnv(project, app);
      if (res.error) return toast({ tone: "bad", title: "Couldn't load settings", body: res.error });
      const parsed = parse(res.content ?? "");
      setRows(parsed);
      setOriginal(serialize(parsed));
    });

  const save = () =>
    start(async () => {
      const res = await saveAppEnv(project, app, current);
      setConfirm(false);
      if (res.error) return toast({ tone: "bad", title: "Couldn't save settings", body: res.error });
      if (res.mode === "none") return toast({ tone: "info", title: "Nothing changed" });
      toast({ tone: "ok", title: "Settings saved", body: res.mode === "rebuild" ? "Rebuilding with the new values…" : "Applying with zero downtime…" });
      if (res.jobId) router.push(`/jobs/${res.jobId}`);
    });

  if (rows === null) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <span className="flex items-center gap-2 text-sm text-muted">
          <IconLock size={16} aria-hidden /> Settings are hidden until you open them.
        </span>
        <button onClick={load} disabled={pending} className={btn}>
          {pending ? "Loading…" : "Show settings"}
        </button>
      </div>
    );
  }

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex rounded-lg border border-line-strong p-0.5 text-sm">
          <button onClick={() => setRaw(null)} className={cx("rounded-md px-2.5 py-1", raw === null ? "bg-subtle font-medium" : "text-muted")}>Table</button>
          <button onClick={() => setRaw(serialize(rows))} className={cx("rounded-md px-2.5 py-1", raw !== null ? "bg-subtle font-medium" : "text-muted")}>Paste .env</button>
        </div>
        <span className="text-xs text-faint">{rows.length} values</span>
      </div>

      {raw !== null ? (
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setRows(parse(e.target.value));
          }}
          rows={Math.min(18, Math.max(6, raw.split("\n").length + 1))}
          spellCheck={false}
          className={`${input} resize-y`}
          placeholder={"KEY=value\nANOTHER_KEY=value"}
        />
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && <p className="py-3 text-sm text-muted">No values yet.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] items-center gap-2">
              <input
                value={r.key}
                onChange={(e) => set(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })}
                placeholder="KEY"
                className={cx(input, dupes.has(r.key) && "border-bad")}
                aria-label="Name"
              />
              <input
                value={r.value}
                onChange={(e) => set(i, { value: e.target.value })}
                type={r.shown ? "text" : "password"}
                placeholder="value"
                autoComplete="off"
                className={input}
                aria-label={`Value of ${r.key}`}
              />
              <button onClick={() => set(i, { shown: !r.shown })} className="text-faint hover:text-fg" aria-label={r.shown ? "Hide value" : "Show value"}>
                {r.shown ? <IconEyeOff size={17} /> : <IconEye size={17} />}
              </button>
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-faint hover:text-bad" aria-label={`Remove ${r.key}`}>
                <IconTrash size={17} />
              </button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { key: "", value: "", shown: true }])} className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <IconPlus size={15} /> Add value
          </button>
        </div>
      )}

      {(dupes.size > 0 || badKey) && (
        <p className="mt-3 text-xs text-bad-fg">{dupes.size > 0 ? `Duplicate names: ${[...dupes].join(", ")}. ` : ""}{badKey ? "Names can only use letters, numbers and _." : ""}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-warn-fg">Unsaved changes</span>}
        <button
          onClick={() => {
            const parsed = parse(original);
            setRows(parsed);
            setRaw(null);
          }}
          disabled={!dirty || pending}
          className={btn}
        >
          Discard
        </button>
        <button onClick={() => setConfirm(true)} disabled={!dirty || pending || dupes.size > 0 || badKey} className={primary}>
          Save and apply
        </button>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Apply new settings to ${app}?`}
        footer={
          <>
            <button onClick={() => setConfirm(false)} className={btn} disabled={pending}>Cancel</button>
            <button onClick={save} className={primary} disabled={pending}>{pending ? "Saving…" : "Save and apply"}</button>
          </>
        }
      >
        {type === "nextjs"
          ? "Shipyard saves the values and restarts the app on the idle slot with zero downtime. If you changed a NEXT_PUBLIC_ value, it rebuilds instead, because those are baked in at build time."
          : type === "static"
            ? "Shipyard saves the values and rebuilds the site."
            : "Shipyard saves the values and restarts the app. This app can't run twice at once, so expect a gap of a few seconds."}
      </Dialog>
    </div>
  );
}

export function EnvEditor({ project, apps }: { project: string; apps: { name: string; type: string }[] }) {
  return (
    <div className="space-y-4">
      {apps.map((a) => (
        <section key={a.name} className="overflow-hidden rounded-xl border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">
              {a.name} <span className="font-normal text-faint">· .env</span>
            </h2>
            <span className="text-xs text-faint">Stored privately on the server</span>
          </header>
          <AppEnv project={project} app={a.name} type={a.type} />
        </section>
      ))}
    </div>
  );
}
