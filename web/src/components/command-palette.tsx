"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconArchive,
  IconBell,
  IconSettings,
  IconCommand,
  IconFileText,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPlus,
  IconRocket,
  IconSearch,
  IconServer,
  IconSun,
  IconTimeline,
  IconWorld,
} from "@tabler/icons-react";
import { deploySite } from "@/app/(panel)/sites/actions";
import { Dot, cx, type Tone } from "./ui";
import { setTheme } from "./theme";

export type PaletteSite = { id: string; name: string; domain: string; status: string; deployable: boolean; project: string | null };

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  keywords: string;
  run: () => void | Promise<void>;
};

const toneOf = (s: string): Tone => (s === "up" ? "ok" : s === "degraded" ? "warn" : "bad");

export function CommandPalette({ sites, logout }: { sites: PaletteSite[]; logout: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") close();
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("shipyard:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("shipyard:palette", onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Item[] = [
      { id: "nav-overview", group: "Go to", label: "Overview", icon: <IconLayoutDashboard size={17} />, keywords: "home dashboard", run: go("/") },
      { id: "nav-sites", group: "Go to", label: "Sites", icon: <IconWorld size={17} />, keywords: "projects", run: go("/sites") },
      { id: "nav-deploys", group: "Go to", label: "Deployments", icon: <IconTimeline size={17} />, keywords: "jobs releases builds", run: go("/deployments") },
      { id: "nav-server", group: "Go to", label: "Server", icon: <IconServer size={17} />, keywords: "vps disk memory", run: go("/server") },
      { id: "nav-notifications", group: "Go to", label: "Notifications", icon: <IconBell size={17} />, keywords: "alerts bell problems", run: go("/notifications") },
      { id: "nav-backups", group: "Go to", label: "Backups", icon: <IconArchive size={17} />, keywords: "restore snapshot", run: go("/backups") },
      { id: "nav-settings", group: "Go to", label: "Settings", icon: <IconSettings size={17} />, keywords: "sessions update shipyard webhook", run: go("/settings") },
      { id: "nav-history", group: "Go to", label: "History", icon: <IconHistory size={17} />, keywords: "audit activity", run: go("/history") },
      { id: "add-site", group: "Actions", label: "Add site from GitHub", icon: <IconPlus size={17} />, keywords: "new create repo", run: go("/sites/new") },
    ];
    for (const s of sites) {
      list.push({
        id: `site-${s.id}`,
        group: "Sites",
        label: s.name,
        hint: s.domain,
        icon: <Dot tone={toneOf(s.status)} />,
        keywords: `${s.domain} ${s.project ?? ""}`,
        run: go(`/sites/${encodeURIComponent(s.id)}`),
      });
      list.push({
        id: `logs-${s.id}`,
        group: "Actions",
        label: `Open logs: ${s.name}`,
        icon: <IconFileText size={17} />,
        keywords: `logs errors ${s.domain}`,
        run: go(`/sites/${encodeURIComponent(s.id)}?tab=logs`),
      });
      if (s.deployable && s.project) {
        const project = s.project;
        list.push({
          id: `deploy-${s.id}`,
          group: "Actions",
          label: `Deploy ${s.name}`,
          icon: <IconRocket size={17} />,
          keywords: `deploy release ship ${s.domain}`,
          run: () => start(async () => void (await deploySite(project))),
        });
      }
    }
    list.push(
      { id: "theme-light", group: "Preferences", label: "Light theme", icon: <IconSun size={17} />, keywords: "appearance", run: () => setTheme("light") },
      { id: "theme-dark", group: "Preferences", label: "Dark theme", icon: <IconMoon size={17} />, keywords: "appearance", run: () => setTheme("dark") },
      { id: "theme-system", group: "Preferences", label: "Match system theme", icon: <IconCommand size={17} />, keywords: "appearance auto", run: () => setTheme("system") },
      { id: "logout", group: "Account", label: "Sign out", icon: <IconLogout size={17} />, keywords: "logout exit", run: () => start(() => logout()) },
    );
    return list;
  }, [sites, router, logout]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.filter((i) => i.group !== "Actions" || i.id === "add-site");
    const words = q.split(/\s+/);
    return items.filter((i) => words.every((w) => `${i.label} ${i.keywords} ${i.group}`.toLowerCase().includes(w)));
  }, [items, query]);

  const choose = (i: Item | undefined) => {
    if (!i) return;
    close();
    void i.run();
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={close}>
      <div
        className="animate-in w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <IconSearch size={18} className="text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(shown[active]);
              }
            }}
            placeholder="Search sites, pages and actions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="Search commands"
          />
          {pending && <span className="text-xs text-faint">Working…</span>}
          <kbd className="rounded border border-line px-1.5 text-[11px] text-faint">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {shown.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{query}”.</li>}
          {shown.map((item, idx) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id}>
                {header && <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{header}</div>}
                <button
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(item)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", idx === active ? "bg-subtle" : "")}
                >
                  <span className="flex w-5 justify-center text-muted">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="truncate text-xs text-faint">{item.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">⌘K anywhere</span>
        </div>
      </div>
    </div>
  );
}
