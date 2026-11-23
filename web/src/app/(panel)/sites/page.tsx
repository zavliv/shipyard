import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { toRow } from "@/lib/rows";
import { LiveIndicator } from "@/components/live";
import { SitesTable } from "@/components/sites-table";
import { PageHeader } from "@/components/ui";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";

export const metadata: Metadata = { title: "Sites" };

export default async function SitesPage() {
  await requireUser();
  const inv = await getInventory();
  const managed = inv.sites.filter((s) => s.managed).length;
  return (
    <>
      <PageHeader
        title="Sites"
        sub={`${inv.sites.length} sites · ${managed} managed · ${inv.sites.length - managed} not yet moved`}
        actions={
          <>
            <LiveIndicator fetchedAt={inv.fetchedAt} />
            <Link href="/sites/new" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90">
              <IconPlus size={16} aria-hidden />
              Add site
            </Link>
          </>
        }
      />
      <SitesTable rows={inv.sites.map(toRow)} />
    </>
  );
}
