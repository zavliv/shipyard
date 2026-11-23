"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconArchive, IconCheck, IconTrash } from "@tabler/icons-react";
import { deleteSite, requestDeleteCode } from "@/app/(panel)/sites/manage-actions";
import { Dialog } from "./overlay";

const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-60";
const danger = "inline-flex h-9 items-center gap-1.5 rounded-lg bg-bad px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export type DeletePlan = { project: string; folder: string; processes: string[]; domains: string[]; nginx: string[]; certificates: string[] };

export function DeleteDialog({ open, onClose, plan, email }: { open: boolean; onClose: () => void; plan: DeletePlan; email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const masked = email.replace(/^(.).*(@.*)$/, "$1•••••$2");

  const send = () =>
    start(async () => {
      setError(null);
      const res = await requestDeleteCode(plan.project);
      if (res.error) return setError(res.error);
      setSent(true);
    });

  const doDelete = () =>
    start(async () => {
      setError(null);
      const res = await deleteSite(plan.project, name, code);
      if (res.error) return setError(res.error);
      onClose();
      router.push(`/jobs/${res.jobId}`);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={`Delete ${plan.project}?`}
      icon={<IconTrash size={20} className="text-bad" />}
      footer={
        <>
          <button onClick={onClose} className={btn} disabled={pending}>Cancel</button>
          <button onClick={doDelete} className={danger} disabled={pending || name !== plan.project || !/^\d{6}$/.test(code)}>
            {pending ? "Working…" : "Back up and delete"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-bad/30 bg-bad-bg p-3 text-bad-fg">
          This removes the live site. Shipyard first saves a full backup, then removes everything below.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium tracking-wide text-faint uppercase">Will be removed</div>
            <ul className="space-y-1 text-fg">
              <li className="font-mono text-xs">{plan.folder}</li>
              {plan.processes.map((p) => <li key={p} className="font-mono text-xs">process {p}</li>)}
              {plan.nginx.filter((f) => f.includes("sites-available")).map((f) => <li key={f} className="font-mono text-xs">{f}</li>)}
              {plan.certificates.map((c) => <li key={c} className="font-mono text-xs">SSL certificate {c}</li>)}
              <li className="text-xs">Domains: {plan.domains.join(", ")}</li>
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium tracking-wide text-faint uppercase">Not touched</div>
            <ul className="space-y-1 text-xs text-muted">
              <li>Databases (MongoDB Atlas)</li>
              <li>The GitHub repository</li>
              <li>DNS records at your provider</li>
              <li>Other sites on the server</li>
            </ul>
            <div className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <IconArchive size={14} className="mt-0.5 shrink-0" aria-hidden />
              Backup saved to /srv/backups/deleted (code, settings, nginx and SSL files).
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">Type <span className="font-mono font-semibold text-fg">{plan.project}</span> to confirm</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-fg" />
        </label>

        <div>
          {!sent ? (
            <button onClick={send} disabled={pending || name !== plan.project} className={btn}>
              {pending ? "Sending…" : `Email a confirmation code to ${masked}`}
            </button>
          ) : (
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                <IconCheck size={14} className="text-ok" /> Code sent to {masked}
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-fg"
              />
            </label>
          )}
        </div>
        {error && <p className="text-sm text-bad-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
