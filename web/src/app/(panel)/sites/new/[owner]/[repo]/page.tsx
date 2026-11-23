import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { detect, getRepo, githubConfigured, listBranches } from "@/lib/github";
import { PageHeader } from "@/components/ui";
import { SiteForm } from "@/components/site-form";

export const metadata: Metadata = { title: "Configure site" };

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 41) || "site";
}

export default async function ConfigurePage({ params, searchParams }: PageProps<"/sites/new/[owner]/[repo]">) {
  await requireUser();
  if (!githubConfigured()) notFound();
  const { owner, repo } = await params;
  const sp = await searchParams;
  const o = decodeURIComponent(owner);
  const r = decodeURIComponent(repo);
  const info = await getRepo(o, r).catch(() => null);
  if (!info) notFound();
  const branches = await listBranches(o, r).catch(() => [info.defaultBranch]);
  const branch = typeof sp.branch === "string" && branches.includes(sp.branch) ? sp.branch : info.defaultBranch;
  const subdir = typeof sp.subdir === "string" ? sp.subdir.replace(/^\/+|\/+$/g, "") : "";
  const detection = await detect(o, r, branch, subdir);
  const project = slug(r);

  return (
    <>
      <PageHeader
        title={info.fullName}
        back={{ href: "/sites/new", label: "Repositories" }}
        sub={info.description ?? "Configure how Shipyard builds and runs this repository."}
      />
      <SiteForm
        key={`${branch}:${subdir}`}
        owner={o}
        repo={r}
        branches={branches}
        branch={branch}
        subdir={subdir}
        detection={detection}
        defaults={{ project, app: detection.type === "node" || detection.type === "python" ? "api" : "web" }}
      />
    </>
  );
}
