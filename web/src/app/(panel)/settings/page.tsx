import type { Metadata } from "next";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { IconBrandGithub, IconCamera, IconCheck, IconCloudDownload, IconDeviceDesktop, IconLogout, IconMail, IconX } from "@tabler/icons-react";
import { currentSessionHash, requireUser } from "@/lib/auth";
import { collections } from "@/lib/db";
import { githubConfigured, latestCommit } from "@/lib/github";
import { scheduleState, snapshotConfigured } from "@/lib/maintenance";
import { env } from "@/lib/env";
import { panelUrl, updateRepo } from "@/lib/server-info";
import { dateTime, since } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, KeyValue, PageHeader } from "@/components/ui";
import { revokeSession, signOutOthers, snapshotNow, updateShipyard } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function runningCommit(): { sha: string; message: string } | null {
  try {
    const out = execFileSync("git", ["-C", path.resolve(process.cwd(), ".."), "log", "-1", "--format=%H%x00%s"], { encoding: "utf8", timeout: 3000 });
    const [sha, message] = out.trim().split("\0");
    return { sha, message };
  } catch {
    return null;
  }
}

function device(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {ok ? <IconCheck size={15} className="text-ok" aria-hidden /> : <IconX size={15} className="text-faint" aria-hidden />}
      <span className={ok ? "" : "text-muted"}>{children}</span>
    </span>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const { sessions } = await collections();
  const [list, current, running, latest, schedule] = await Promise.all([
    sessions.find().sort({ lastSeenAt: -1 }).toArray(),
    currentSessionHash(),
    Promise.resolve(runningCommit()),
    githubConfigured() && updateRepo() ? latestCommit(updateRepo()!.owner, updateRepo()!.name, "main") : Promise.resolve(null),
    scheduleState().catch(() => null),
  ]);
  const outdated = running && latest && running.sha !== latest.sha;
  const onServer = env.vpsctlMode() === "local";

  return (
    <>
      <PageHeader title="Settings" sub="Your sessions, Shipyard itself, and the services it connects to" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Signed-in sessions"
          action={
            list.length > 1 ? (
              <ActionButton
                action={signOutOthers}
                icon={<IconLogout size={15} aria-hidden />}
                success="Other sessions signed out"
                confirm={{ title: "Sign out everywhere else?", body: "Every other browser signed in to Shipyard is signed out. You stay signed in here.", cta: "Sign out others" }}
              >
                Sign out others
              </ActionButton>
            ) : undefined
          }
          flush
        >
          <ul className="divide-y divide-line">
            {list.map((s) => {
              const isCurrent = s.tokenHash === current;
              return (
                <li key={s._id!.toHexString()} className="flex items-center gap-3 px-4 py-3">
                  <IconDeviceDesktop size={18} className="text-faint" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {device(s.userAgent)} {isCurrent && <Badge tone="ok">This browser</Badge>}
                    </span>
                    <span className="block text-xs text-faint">
                      {s.ip} · signed in {since(s.createdAt.toISOString())} ago · active {since(s.lastSeenAt.toISOString())} ago
                    </span>
                  </span>
                  {!isCurrent && (
                    <ActionButton action={revokeSession.bind(null, s._id!.toHexString())} success="Session ended">
                      End
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title="Shipyard"
          action={
            onServer ? (
              <ActionButton
                action={updateShipyard}
                variant={outdated ? "primary" : "secondary"}
                icon={<IconCloudDownload size={15} aria-hidden />}
                confirm={{
                  title: "Update Shipyard?",
                  body: `Shipyard downloads the latest version from GitHub (${updateRepo() ? `${updateRepo()!.owner}/${updateRepo()!.name}` : "UPDATE_REPO"}), rebuilds and restarts. The dashboard is unavailable for about a minute; your sites are not affected.`,
                  cta: "Update now",
                }}
              >
                {outdated ? "Update available" : "Update Shipyard"}
              </ActionButton>
            ) : undefined
          }
        >
          <KeyValue
            items={[
              ["Running", running ? <span key="r"><span className="font-mono text-xs">{running.sha.slice(0, 7)}</span> {running.message}</span> : "unknown"],
              ["Latest on GitHub", latest ? <span key="l"><span className="font-mono text-xs">{latest.sha.slice(0, 7)}</span> {latest.message}</span> : "unknown"],
              ["Address", panelUrl() || "Set PANEL_URL in .env"],
              ["Signed in as", user.email],
            ]}
          />
        </Card>

        <Card title="Connections">
          <div className="space-y-3 text-sm">
            <Status ok={githubConfigured()}>
              <span className="inline-flex items-center gap-1.5"><IconBrandGithub size={15} aria-hidden /> GitHub App (repositories, deploys)</span>
            </Status>
            {!githubConfigured() && (
              <a href="/api/github/manifest/start" className="ml-6 inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90">
                <IconBrandGithub size={15} aria-hidden />
                Connect GitHub
              </a>
            )}
            <Status ok={Boolean(process.env.GITHUB_WEBHOOK_SECRET)}>
              Auto-deploy on push {process.env.GITHUB_WEBHOOK_SECRET ? "(webhook secret set)" : "(needs GITHUB_WEBHOOK_SECRET and a webhook in the GitHub App)"}
            </Status>
            <Status ok={snapshotConfigured()}>
              Weekly server snapshots {snapshotConfigured() ? "" : "(needs HOSTINGER_API_TOKEN)"}
            </Status>
            <Status ok={Boolean(process.env.SMTP_HOST)}>
              <span className="inline-flex items-center gap-1.5"><IconMail size={15} aria-hidden /> Email (sign-in codes and alerts)</span>
            </Status>
          </div>
        </Card>

        <Card
          title="Backups and snapshots"
          action={
            snapshotConfigured() ? (
              <ActionButton
                action={snapshotNow}
                icon={<IconCamera size={15} aria-hidden />}
                success="Snapshot started at Hostinger"
                confirm={{ title: "Take a server snapshot now?", body: "Hostinger keeps one snapshot per server, so this replaces the existing one.", cta: "Take snapshot" }}
              >
                Snapshot now
              </ActionButton>
            ) : undefined
          }
        >
          <KeyValue
            items={[
              ["Site backups", "Nightly at 03:00, kept 14 days"],
              ["Last backup run", schedule?.lastBackupDay ?? "Not yet"],
              ["Server snapshot", snapshotConfigured() ? "Sundays at 04:00" : "Off"],
              ["Last snapshot", schedule?.lastSnapshotAt ? `${dateTime(schedule.lastSnapshotAt)} (${schedule.lastSnapshotResult})` : "Not yet"],
              ["Alerts go to", env.adminEmail()],
            ]}
          />
        </Card>
      </div>
    </>
  );
}
