import type { Metadata } from "next";
import { IconArchive, IconArrowBackUp, IconChevronRight, IconDatabaseExport, IconTrash } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { vpsctl } from "@/lib/vpsctl";
import { scheduleState } from "@/lib/maintenance";
import { bytes, dateTime, since } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { backupNow, deleteBackup, restoreBackup } from "../settings/actions";

export const metadata: Metadata = { title: "Backups" };

type Backup = { kind: "scheduled" | "deleted"; project: string; file: string; size: number; created: string; live: boolean };

export default async function BackupsPage() {
  await requireUser();
  const [{ backups }, state] = await Promise.all([
    vpsctl<{ backups: Backup[] }>(["backup-list"]).catch(() => ({ backups: [] as Backup[] })),
    scheduleState().catch(() => null),
  ]);
  const deleted = backups.filter((b) => b.kind === "deleted" && !b.live);
  const scheduled = backups.filter((b) => b.kind === "scheduled");
  const byProject = new Map<string, Backup[]>();
  for (const b of scheduled) byProject.set(b.project, [...(byProject.get(b.project) ?? []), b]);
  const total = backups.reduce((s, b) => s + b.size, 0);

  return (
    <>
      <PageHeader
        title="Backups"
        sub={`Every Shipyard site is backed up each night at 03:00 and kept for 14 days · ${backups.length} backups, ${bytes(total)}`}
        actions={
          <ActionButton
            action={backupNow.bind(null, undefined)}
            variant="primary"
            icon={<IconDatabaseExport size={15} aria-hidden />}
            confirm={{
              title: "Back up all sites now?",
              body: "Shipyard saves each site's code, settings, shared files, nginx and SSL files to /srv/backups. Sites keep running.",
              cta: "Back up now",
            }}
          >
            Back up all now
          </ActionButton>
        }
      />

      {state?.lastBackupDay && <p className="-mt-3 mb-5 text-xs text-faint">Last scheduled run: {state.lastBackupDay}</p>}

      {deleted.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Deleted sites you can restore</h2>
          <Card flush>
            <ul className="divide-y divide-line">
              {deleted.map((b) => (
                <li key={b.file} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="font-medium">{b.project}</span>
                    <span className="block text-xs text-faint">
                      Deleted {since(b.created)} ago · {bytes(b.size)} · kept for 30 days
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <ActionButton
                      action={restoreBackup.bind(null, b.file)}
                      icon={<IconArrowBackUp size={15} aria-hidden />}
                      confirm={{
                        title: `Restore ${b.project}?`,
                        body: "Shipyard puts back its files, settings, nginx and SSL, then rebuilds and starts it on its domains. This takes a few minutes.",
                        cta: "Restore site",
                      }}
                    >
                      Restore
                    </ActionButton>
                    <DeleteBackup kind="deleted" backup={b} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold">Sites</h2>
      <Card flush>
        {byProject.size === 0 ? (
          <EmptyState icon={<IconArchive size={28} aria-hidden />} title="No backups yet">
            The first nightly backup runs at 03:00, or press “Back up all now”.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {[...byProject.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([project, list]) => (
                <li key={project}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-hover [&::-webkit-details-marker]:hidden">
                      <IconChevronRight size={15} className="shrink-0 text-faint transition-transform group-open:rotate-90" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{project}</span>
                        <span className="block text-xs text-faint">
                          Latest {since(list[0].created)} ago · {list.length} {list.length === 1 ? "backup" : "backups"} ·{" "}
                          {bytes(list.reduce((n, b) => n + b.size, 0))}
                        </span>
                      </span>
                      <ActionButton action={backupNow.bind(null, project)}>Back up now</ActionButton>
                    </summary>
                    <ul className="divide-y divide-line border-t border-line bg-subtle/40">
                      {list.map((b) => (
                        <li key={b.file} className="flex items-center gap-3 py-2.5 pl-11 pr-4 text-sm">
                          <span className="min-w-0 flex-1">
                            {dateTime(b.created)} <span className="text-faint">· {since(b.created)} ago</span>
                          </span>
                          <span className="tabular-nums text-muted">{bytes(b.size)}</span>
                          <DeleteBackup kind="scheduled" backup={b} />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <div className="mt-6">
        <Alert tone="neutral" icon={<IconArchive size={18} aria-hidden />}>
          Backups live on this server in <code className="font-mono">/srv/backups</code>, so they protect against mistakes, not against losing the server. The
          weekly Hostinger snapshot (Settings) covers the whole server. <Badge>Tip</Badge> Databases on MongoDB Atlas have their own backups in Atlas.
        </Alert>
      </div>
    </>
  );
}

function DeleteBackup({ kind, backup }: { kind: "scheduled" | "deleted"; backup: Backup }) {
  return (
    <ActionButton
      action={deleteBackup.bind(null, kind, backup.file)}
      variant="danger"
      icon={<IconTrash size={15} aria-hidden />}
      success="Backup deleted"
      confirm={{
        title: "Delete this backup?",
        body:
          kind === "deleted"
            ? `This is the only copy of ${backup.project}, which was deleted. Once this backup is gone, the site can't be restored. This can't be undone.`
            : `The ${backup.project} backup from ${dateTime(backup.created)} (${bytes(backup.size)}) is removed from the server. This can't be undone.`,
        cta: "Delete backup",
      }}
    >
      Delete
    </ActionButton>
  );
}
