import type { Metadata } from "next";
import { IconBrandGithub, IconExternalLink } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { githubConfigured, githubInstallUrl, installation, listRepos, type Repo } from "@/lib/github";
import { Alert, Card, PageHeader } from "@/components/ui";
import { RepoPicker } from "@/components/repo-picker";

export const metadata: Metadata = { title: "Add site" };

function SetupGuide() {
  return (
    <Card title="Connect GitHub first">
      <p className="text-sm text-muted">
        Shipyard needs read-only access to your repositories. One click creates a private GitHub App for this panel, then you pick which repositories it can see.
      </p>
      <a href="/api/github/manifest/start" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-invert">
        <IconBrandGithub size={16} aria-hidden />
        Connect GitHub
      </a>
      <p className="mt-6 text-xs font-medium text-muted">Or set it up by hand:</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        <li>Create a GitHub App named <strong>Shipyard</strong> with read-only <em>Contents</em> and <em>Metadata</em> permissions.</li>
        <li>Generate a private key and save the <code className="font-mono">.pem</code> file on this computer or server.</li>
        <li>
          Add <code className="font-mono">GITHUB_APP_ID</code>, <code className="font-mono">GITHUB_APP_SLUG</code> and{" "}
          <code className="font-mono">GITHUB_APP_PRIVATE_KEY_PATH</code> to Shipyard&apos;s <code className="font-mono">.env</code>, then restart Shipyard.
        </li>
        <li>Install the app on your account and choose which repositories Shipyard can see.</li>
      </ol>
      <p className="mt-4 text-xs text-faint">The full click-by-click guide is in the Shipyard README.</p>
    </Card>
  );
}

export default async function NewSitePage() {
  await requireUser();
  let body: React.ReactNode;
  if (!githubConfigured()) {
    body = <SetupGuide />;
  } else {
    let repos: Repo[] | null = null;
    let problem: string | null = null;
    let account = "";
    try {
      const inst = await installation();
      if (inst) {
        account = inst.account;
        repos = await listRepos();
      }
    } catch (e) {
      problem = (e as Error).message;
    }
    const installUrl = githubInstallUrl();
    body = problem ? (
      <Alert tone="bad">Couldn&apos;t reach GitHub: {problem}</Alert>
    ) : !repos ? (
      <Card title="Install the Shipyard app on GitHub">
        <p className="text-sm text-muted">The GitHub App exists but isn&apos;t installed on your account yet.</p>
        {installUrl && (
          <a href={installUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-invert">
            <IconBrandGithub size={16} aria-hidden />
            Install on GitHub
            <IconExternalLink size={14} aria-hidden />
          </a>
        )}
      </Card>
    ) : (
      <RepoPicker repos={repos} account={account} manageUrl={installUrl} />
    );
  }
  return (
    <>
      <PageHeader
        title="Add site"
        back={{ href: "/sites", label: "Sites" }}
        sub="Pick a GitHub repository. Shipyard downloads it, builds it and puts it live on your domain."
      />
      {body}
    </>
  );
}
