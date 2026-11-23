import type { Site } from "./inventory";

export type SiteRow = {
  id: string;
  name: string;
  domains: string[];
  status: Site["status"];
  managed: boolean;
  certDaysLeft: number | null;
  memory: number;
  parts: string;
};

export function primaryDomain(site: Site): string {
  const roots = site.domains.filter((d) => !d.startsWith("www."));
  return roots.find((d) => d.endsWith(".com")) ?? roots[0] ?? site.domains[0] ?? site.id;
}

export function siteName(site: Site): string {
  return site.project?.project ?? primaryDomain(site);
}

export function toRow(site: Site): SiteRow {
  const apps = site.processes.filter((p) => p.kind !== "static").length;
  const hasStatic = site.processes.some((p) => p.kind === "static");
  const parts = [apps ? `${apps} ${apps === 1 ? "app" : "apps"}` : "", hasStatic ? "static" : ""].filter(Boolean).join(" + ");
  return {
    id: site.id,
    name: siteName(site),
    domains: site.domains,
    status: site.status,
    managed: site.managed,
    certDaysLeft: site.certDaysLeft,
    memory: site.processes.reduce((sum, p) => sum + (p.memory ?? 0), 0),
    parts,
  };
}
