"use client";

import { WILDCARD_DOMAIN } from "@/lib/locale";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconExternalLink, IconPlus, IconStar, IconTrash, IconWorld } from "@tabler/icons-react";
import { addDomain, removeDomain } from "@/app/(panel)/sites/manage-actions";
import { Dialog, useToast } from "./overlay";
import { Badge } from "./ui";

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-60";
const primary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90 disabled:opacity-60";

export function DomainsPanel({ project, domains, primary: main, sslDays, serverIp }: { project: string; domains: string[]; primary: string; sslDays: number | null; serverIp: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      setError(null);
      const res = await addDomain(project, value);
      if (res.error) return setError(res.error);
      toast({ tone: "ok", title: `Adding ${value.trim()}`, body: "Connecting nginx and extending SSL…" });
      setValue("");
      router.push(`/jobs/${res.jobId}`);
    });

  const remove = (d: string) =>
    start(async () => {
      const res = await removeDomain(project, d);
      setRemoving(null);
      if (res.error) return toast({ tone: "bad", title: "Couldn't remove the domain", body: res.error });
      router.push(`/jobs/${res.jobId}`);
    });

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Domains</h2>
          <span className="text-xs text-faint">SSL {sslDays != null ? `valid ${sslDays} more days` : "-"}</span>
        </header>
        <ul className="divide-y divide-line">
          {domains.map((d) => (
            <li key={d} className="flex items-center gap-3 px-4 py-3">
              <IconWorld size={17} className="text-faint" aria-hidden />
              <a href={`https://${d}`} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm hover:underline">
                <span className="truncate">{d}</span>
                <IconExternalLink size={13} className="shrink-0 text-faint" aria-hidden />
              </a>
              {d === main ? (
                <Badge tone="info"><IconStar size={12} /> Main</Badge>
              ) : (
                <button onClick={() => setRemoving(d)} className="text-faint hover:text-bad" aria-label={`Remove ${d}`}>
                  <IconTrash size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Add a domain</h2>
        <p className="mt-1 text-sm text-muted">
          Point the domain&apos;s A record to <span className="font-mono text-fg">{serverIp}</span> first.{WILDCARD_DOMAIN && <> Any <span className="font-mono">*.{WILDCARD_DOMAIN}</span> address already does.</>}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="www.example.com"
            className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-mono text-[13px] outline-none focus:border-fg"
            aria-label="Domain to add"
          />
          <button type="submit" disabled={pending || !value.trim()} className={primary}>
            <IconPlus size={15} /> {pending ? "Checking…" : "Add domain"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-bad-fg">{error}</p>}
      </section>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing}?`}
        icon={<IconTrash size={20} className="text-bad" />}
        footer={
          <>
            <button onClick={() => setRemoving(null)} className={btn} disabled={pending}>Cancel</button>
            <button onClick={() => removing && remove(removing)} className={primary} disabled={pending}>{pending ? "Removing…" : "Remove domain"}</button>
          </>
        }
      >
        Visitors to <span className="font-mono text-fg">{removing}</span> will no longer reach this site. The SSL certificate is re-issued without it. The DNS record
        at your provider is not changed.
      </Dialog>
    </div>
  );
}
