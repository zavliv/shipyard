"use client";

import { useState, useTransition } from "react";
import {
  IconAdjustments,
  IconCopy,
  IconTrash,
  IconWorld,
  IconDots,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconRefresh,
  IconRocket,
} from "@tabler/icons-react";
import { deploySite, restartSite } from "@/app/(panel)/sites/actions";
import { Dialog, Menu, MenuItem, MenuSeparator, useToast } from "./overlay";
import { DeleteDialog, type DeletePlan } from "./delete-dialog";

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-hover";
const primary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90 disabled:opacity-60";

export function SiteActions({
  siteHref,
  project,
  domain,
  repo,
  branch,
  canDeploy,
  canRestart,
  deletePlan,
  email,
}: {
  siteHref: string;
  project: string | null;
  domain: string;
  repo: string | null;
  branch: string | null;
  canDeploy: boolean;
  canRestart: boolean;
  deletePlan: DeletePlan | null;
  email: string;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"deploy" | "restart" | "delete" | null>(null);
  const [pending, start] = useTransition();

  const doDeploy = () =>
    start(async () => {
      const res = await deploySite(project!);
      if (res?.error) toast({ tone: "bad", title: "Couldn't start the deploy", body: res.error });
      setDialog(null);
    });

  const doRestart = () =>
    start(async () => {
      const res = await restartSite(project!);
      setDialog(null);
      if (res.error) toast({ tone: "bad", title: "Restart failed", body: res.error });
      else toast({ tone: "ok", title: `Restarted ${project}`, body: res.restarted?.join(", ") });
    });

  return (
    <div className="flex items-center gap-2">
      <a href={`https://${domain}`} target="_blank" rel="noreferrer" className={btn}>
        <IconExternalLink size={15} aria-hidden />
        Visit
      </a>
      {canDeploy && (
        <button onClick={() => setDialog("deploy")} className={primary}>
          <IconRocket size={15} aria-hidden />
          Deploy
        </button>
      )}
      <Menu
        trigger={
          <button className={`${btn} px-2`} aria-label="More actions">
            <IconDots size={16} />
          </button>
        }
      >
        <MenuItem icon={<IconFileText size={16} />} href={`${siteHref}?tab=logs`}>Open logs</MenuItem>
        {deletePlan && <MenuItem icon={<IconAdjustments size={16} />} href={`${siteHref}?tab=settings`}>Settings (.env)</MenuItem>}
        {deletePlan && <MenuItem icon={<IconWorld size={16} />} href={`${siteHref}?tab=domains`}>Domains</MenuItem>}
        <MenuItem icon={<IconFolder size={16} />} href={`${siteHref}?tab=ownership`}>What this site owns</MenuItem>
        <MenuItem
          icon={<IconCopy size={16} />}
          onSelect={() => {
            void navigator.clipboard.writeText(`https://${domain}`);
            toast({ tone: "info", title: "Link copied", body: `https://${domain}` });
          }}
        >
          Copy link
        </MenuItem>
        {canRestart && (
          <>
            <MenuSeparator />
            <MenuItem icon={<IconRefresh size={16} />} onSelect={() => setDialog("restart")}>Restart</MenuItem>
          </>
        )}
        {deletePlan && (
          <>
            <MenuSeparator />
            <MenuItem danger icon={<IconTrash size={16} />} onSelect={() => setDialog("delete")}>Delete site…</MenuItem>
          </>
        )}
      </Menu>

      {deletePlan && <DeleteDialog open={dialog === "delete"} onClose={() => setDialog(null)} plan={deletePlan} email={email} />}

      <Dialog
        open={dialog === "deploy"}
        onClose={() => setDialog(null)}
        title={`Deploy ${project}?`}
        icon={<IconRocket size={20} className="text-info" />}
        footer={
          <>
            <button onClick={() => setDialog(null)} className={btn} disabled={pending}>Cancel</button>
            <button onClick={doDeploy} className={primary} disabled={pending}>{pending ? "Starting…" : "Deploy now"}</button>
          </>
        }
      >
        Shipyard downloads the latest <span className="font-mono text-fg">{branch}</span> from <span className="text-fg">{repo}</span>, builds a new
        release next to the live one and switches visitors over only when it&apos;s healthy. If anything fails, the live site keeps running.
      </Dialog>

      <Dialog
        open={dialog === "restart"}
        onClose={() => setDialog(null)}
        title={`Restart ${project}?`}
        icon={<IconRefresh size={20} className="text-warn" />}
        footer={
          <>
            <button onClick={() => setDialog(null)} className={btn} disabled={pending}>Cancel</button>
            <button onClick={doRestart} className={primary} disabled={pending}>{pending ? "Restarting…" : "Restart"}</button>
          </>
        }
      >
        The site&apos;s apps restart one by one. Visitors may see an error for a few seconds while each app comes back.
      </Dialog>
    </div>
  );
}
