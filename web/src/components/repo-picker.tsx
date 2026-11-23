"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IconBrandGithub, IconChevronRight, IconLock, IconSearch, IconSettings } from "@tabler/icons-react";
import type { Repo } from "@/lib/github";
import { useHotkey } from "./live";
import { EmptyState } from "./ui";

function ago(iso: string | null) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function RepoPicker({ repos, account, manageUrl }: { repos: Repo[]; account: string; manageUrl: string | null }) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useHotkey("/", () => ref.current?.focus());
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            ref={ref}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${repos.length} repositories`}
            aria-label="Search repositories"
            className="w-full rounded-lg border border-line-strong bg-surface py-2 pr-3 pl-8 text-sm outline-none placeholder:text-faint focus:border-fg"
          />
        </label>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <IconBrandGithub size={16} aria-hidden />
            {account}
          </span>
          {manageUrl && (
            <a href={manageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              <IconSettings size={15} aria-hidden />
              Choose repos
            </a>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<IconBrandGithub size={28} aria-hidden />} title="No repositories match">
          If a repository is missing, give Shipyard access to it with “Choose repos”.
        </EmptyState>
      ) : (
        <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={`/sites/new/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    {r.name}
                    {r.private && <IconLock size={13} className="text-faint" aria-label="Private" />}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {[r.language, r.description, `updated ${ago(r.pushedAt)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <IconChevronRight size={16} className="text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
