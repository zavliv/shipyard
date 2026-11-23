import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInventory } from "@/lib/inventory";
import { detect, getRepo, githubConfigured, listBranches, listRepos } from "@/lib/github";
import { Alert, PageHeader } from "@/components/ui";
import { AppForm } from "@/components/app-form";

export const metadata: Metadata = { title: "Add app" };

export default async function AddAppPage({ params, searchParams }: PageProps<"/sites/[id]/add-app">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const inv = await getInventory();
  const site = inv.sites.find((s) => s.id === decodeURIComponent(id));
  if (!site) notFound();
  const back = { href: `/sites/${encodeURIComponent(site.id)}?tab=apps`, label: "Apps" };
  const rec = site.project as {
    project?: string;
    created_by?: string;
    status?: string;
    domains?: string[];
    apps?: { name: string; repo?: string; type?: string }[];
  } | null;
  if (!rec?.project || rec.created_by !== "shipyard" || !githubConfigured()) {
    return (
      <>
        <PageHeader title="Add app" back={back} />
        <Alert tone="warn">Apps can only be added to sites Shipyard manages, with GitHub connected.</Alert>
      </>
    );
  }
  const project = rec.project;
  const mainRepo = rec.apps?.find((a) => a.repo)?.repo ?? "";
  const repos = await listRepos().catch(() => []);
  const wanted = typeof sp.repo === "string" ? sp.repo : mainRepo;
  const repoName = repos.some((r) => r.fullName === wanted) ? wanted : repos.some((r) => r.fullName === mainRepo) ? mainRepo : (repos[0]?.fullName ?? "");
  if (!repoName) {
    return (
      <>
        <PageHeader title="Add app" back={back} />
        <Alert tone="warn">Shipyard can&apos;t see any repositories. Check the GitHub App installation in Settings.</Alert>
      </>
    );
  }
  const [owner, repo] = repoName.split("/");
  const info = await getRepo(owner, repo);
  const branches = await listBranches(owner, repo).catch(() => [info.defaultBranch]);
  const branch = typeof sp.branch === "string" && branches.includes(sp.branch) ? sp.branch : info.defaultBranch;
  const subdir = typeof sp.subdir === "string" ? sp.subdir.replace(/^\/+|\/+$/g, "") : "";
  const detection = await detect(owner, repo, branch, subdir);
  const siteDomain = (rec.domains ?? []).find((d) => !d.startsWith("www.")) ?? project;

  return (
    <>
      <PageHeader title={`Add an app to ${project}`} back={back} sub="Add a backend or second app. Your current site keeps running while Shipyard sets it up." />
      <AppForm
        key={`${repoName}:${branch}:${subdir}`}
        project={project}
        siteId={site.id}
        siteDomain={siteDomain}
        mainRepo={mainRepo}
        repos={repos.map((r) => r.fullName)}
        repo={repoName}
        branches={branches}
        branch={branch}
        subdir={subdir}
        detection={detection}
        taken={(rec.apps ?? []).map((a) => a.name)}
      />
    </>
  );
}
