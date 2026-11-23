import Link from "next/link";
import type { Metadata } from "next";
import { IconAlertTriangle, IconBell, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { markAllRead, notificationsList, openAlerts } from "@/lib/metrics";
import { dateTime, since } from "@/lib/format";
import { Alert, Card, EmptyState, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUser();
  const [items, open] = await Promise.all([notificationsList(100), openAlerts()]);
  await markAllRead();

  return (
    <>
      <PageHeader title="Notifications" sub="Alerts, recoveries and failed jobs. Important ones are also emailed to you." />

      {open.length > 0 && (
        <div className="mb-5 space-y-2">
          <h2 className="text-sm font-semibold">Open problems</h2>
          {open.map((a) => (
            <Alert
              key={a._id!.toHexString()}
              tone={a.kind === "ssl" ? "warn" : "bad"}
              icon={<IconAlertTriangle size={18} aria-hidden />}
              action={a.href ? <Link href={a.href} className="hover:underline">View</Link> : undefined}
            >
              <span className="font-medium">{a.title}</span>
              <span className="block text-xs opacity-80">{a.detail} · since {since(a.openedAt.toISOString())} ago</span>
            </Alert>
          ))}
        </div>
      )}

      <Card flush>
        {items.length === 0 ? (
          <EmptyState icon={<IconBell size={28} aria-hidden />} title="No notifications yet">
            Shipyard checks your sites every minute and tells you here when something needs attention.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const Icon = n.tone === "ok" ? IconCircleCheck : n.tone === "info" ? IconInfoCircle : IconAlertTriangle;
              const body = (
                <span className="flex items-start gap-3 px-4 py-3">
                  <Icon size={18} className={cx("mt-0.5 shrink-0", n.tone === "ok" ? "text-ok" : n.tone === "bad" ? "text-bad" : n.tone === "warn" ? "text-warn" : "text-info")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block text-sm", !n.read && "font-semibold")}>{n.title}</span>
                    {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-faint" title={dateTime(n.at)}>{since(n.at.toISOString())} ago</span>
                </span>
              );
              return <li key={n._id!.toHexString()}>{n.href ? <Link href={n.href} className="block hover:bg-hover/50">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
