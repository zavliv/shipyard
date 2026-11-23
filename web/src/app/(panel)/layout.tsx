import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { deploySources } from "@/lib/sites";
import { siteName, primaryDomain } from "@/lib/rows";
import { MobileNav, Sidebar } from "@/components/nav";
import { CommandPalette, type PaletteSite } from "@/components/command-palette";
import { ToastProvider } from "@/components/overlay";
import { unreadCount } from "@/lib/metrics";
import { jobCounts } from "@/lib/jobs";
import { logout } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let sites: PaletteSite[] = [];
  let host = "";
  const [unread, counts] = await Promise.all([unreadCount().catch(() => 0), jobCounts().catch(() => null)]);
  const activeJobs = counts ? counts.running + counts.queued : 0;
  try {
    const inv = await getInventory();
    host = inv.server.hostname;
    sites = inv.sites
      .map((s) => ({
        id: s.id,
        name: siteName(s),
        domain: primaryDomain(s),
        status: s.status,
        project: s.project?.project ?? null,
        deployable: deploySources(s.project).length > 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    sites = [];
  }
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar email={user.email} sites={sites} unread={unread} activeJobs={activeJobs} host={host} logout={logout} />
        <div className="min-w-0 flex-1">
          <MobileNav logout={logout} unread={unread} />
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      <CommandPalette sites={sites} logout={logout} />
    </ToastProvider>
  );
}
