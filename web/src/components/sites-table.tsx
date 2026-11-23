"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevronRight, IconSearch, IconWorldOff } from "@tabler/icons-react";
import type { SiteRow } from "@/lib/rows";
import { bytes } from "@/lib/format";
import { useHotkey } from "./live";
import { Dot, EmptyState, SslText, StateBadge, StatusBadge, Td, Th, cx, statusTone } from "./ui";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "problems", label: "Problems" },
  { key: "managed", label: "Managed" },
  { key: "legacy", label: "Not yet moved" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function matches(row: SiteRow, filter: FilterKey) {
  if (filter === "problems") return row.status !== "up" || (row.certDaysLeft != null && row.certDaysLeft < 30);
  if (filter === "managed") return row.managed;
  if (filter === "legacy") return !row.managed;
  return true;
}

export function SitesTable({ rows, compact = false }: { rows: SiteRow[]; compact?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkey("/", () => searchRef.current?.focus());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order = { down: 0, degraded: 1, up: 2 } as const;
    return rows
      .filter((r) => matches(r, filter))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.domains.some((d) => d.includes(q)))
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  }, [rows, query, filter]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => matches(r, f.key)).length])) as Record<FilterKey, number>,
    [rows],
  );

  const open = (id: string) => router.push(`/sites/${encodeURIComponent(id)}`);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter sites">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap",
                filter === f.key ? "bg-subtle font-medium text-fg" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
              <span className="text-xs text-faint tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sites"
            aria-label="Search sites"
            className="w-full rounded-lg border border-line-strong bg-surface py-1.5 pr-8 pl-8 text-sm outline-none placeholder:text-faint focus:border-fg"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line px-1 text-[11px] text-faint">/</kbd>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<IconWorldOff size={28} aria-hidden />} title="No sites match">
          Try a different search or filter.
        </EmptyState>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-subtle/60">
              <tr>
                <Th>Site</Th>
                <Th>Status</Th>
                <Th>State</Th>
                <Th>SSL</Th>
                {!compact && <Th className="text-right">Memory</Th>}
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && open(r.id)}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-hover/60 focus:bg-hover/60 focus:outline-none"
                >
                  <Td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-faint">
                      {r.domains.filter((d) => !d.startsWith("www.")).join(", ")} · {r.parts}
                    </div>
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td><StateBadge managed={r.managed} /></Td>
                  <Td><SslText days={r.certDaysLeft} /></Td>
                  {!compact && <Td className="text-right tabular-nums text-muted">{r.memory ? bytes(r.memory) : "-"}</Td>}
                  <Td className="text-faint"><IconChevronRight size={16} aria-hidden /></Td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-line md:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <Dot tone={statusTone(r.status)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-faint">
                      {r.managed ? "Managed" : "Not yet moved"} · SSL {r.certDaysLeft ?? "-"}d · {r.parts}
                    </span>
                  </span>
                  <IconChevronRight size={16} className="text-faint" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
