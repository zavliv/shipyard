"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconArchive,
  IconBell,
  IconSettings,
  IconHistory,
  IconLayoutDashboard,
  IconListCheck,
  IconLogout,
  IconPlus,
  IconSearch,
  IconServer,
  IconShip,
  IconTimeline,
  IconWorld,
} from "@tabler/icons-react";
import { Dot, cx, type Tone } from "./ui";
import { ThemeSwitch } from "./theme";
import type { PaletteSite } from "./command-palette";

const items = [
  { href: "/", label: "Overview", icon: IconLayoutDashboard },
  { href: "/sites", label: "Sites", icon: IconWorld },
  { href: "/deployments", label: "Deployments", icon: IconTimeline },
  { href: "/jobs", label: "Jobs", icon: IconListCheck },
  { href: "/server", label: "Server", icon: IconServer },
  { href: "/backups", label: "Backups", icon: IconArchive },
  { href: "/history", label: "History", icon: IconHistory },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

const toneOf = (s: string): Tone => (s === "up" ? "ok" : s === "degraded" ? "warn" : "bad");

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

function openPalette() {
  window.dispatchEvent(new Event("shipyard:palette"));
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fg text-invert">
        <IconShip size={17} stroke={2} aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Shipyard</span>
    </Link>
  );
}

function SearchButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      onClick={openPalette}
      className={cx(
        "flex items-center gap-2 rounded-lg border border-line bg-bg text-sm text-faint hover:border-line-strong hover:text-muted",
        compact ? "h-9 w-9 justify-center" : "w-full px-2.5 py-1.5",
      )}
      aria-label="Search and commands"
    >
      <IconSearch size={15} aria-hidden />
      {!compact && (
        <>
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-line px-1 text-[11px]">⌘K</kbd>
        </>
      )}
    </button>
  );
}

export function Sidebar({ email, sites, unread, activeJobs = 0, host = "", logout }: { email: string; sites: PaletteSite[]; unread: number; activeJobs?: number; host?: string; logout: () => Promise<void> }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Logo />
        <Link
          href="/notifications"
          className={cx("relative flex h-8 w-8 items-center justify-center rounded-lg hover:bg-hover", path === "/notifications" ? "text-fg" : "text-muted")}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          title="Notifications"
        >
          <IconBell size={18} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
      </div>
      <div className="px-3 pb-3">
        <SearchButton />
      </div>
      <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href) && !(href === "/sites" && path.startsWith("/sites/") && path !== "/sites/new");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
                active ? "bg-subtle font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
              )}
            >
              <Icon size={17} stroke={1.75} aria-hidden />
              {label}
              {href === "/jobs" && activeJobs > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-info-bg px-1.5 text-[11px] font-semibold text-info" title={`${activeJobs} running or waiting`}>
                  {activeJobs}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-between px-5 pb-1">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Your sites</span>
        <Link href="/sites/new" className="text-faint hover:text-fg" aria-label="Add site" title="Add site">
          <IconPlus size={15} />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {sites.map((s) => {
          const href = `/sites/${encodeURIComponent(s.id)}`;
          const active = path === href;
          return (
            <Link
              key={s.id}
              href={href}
              className={cx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
                active ? "bg-subtle font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
              )}
              title={s.domain}
            >
              <Dot tone={toneOf(s.status)} />
              <span className="truncate">{s.name}</span>
            </Link>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-line p-4">
        <ThemeSwitch />
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold uppercase">
            {email.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs" title={email}>{email}</span>
            <span className="block text-[11px] text-faint">{host}</span>
          </span>
          <form action={logout}>
            <button className="text-faint hover:text-fg" aria-label="Sign out" title="Sign out">
              <IconLogout size={16} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav({ logout, unread }: { logout: () => Promise<void>; unread: number }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur md:hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Logo />
        <div className="flex items-center gap-2">
          <SearchButton compact />
          <Link href="/notifications" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-fg" aria-label="Notifications">
            <IconBell size={18} />
            {unread > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-bad" />}
          </Link>
          <form action={logout}>
            <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-fg" aria-label="Sign out">
              <IconLogout size={18} aria-hidden />
            </button>
          </form>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap",
              isActive(path, href) ? "bg-subtle font-medium text-fg" : "text-muted",
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
