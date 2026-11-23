"use client";

import { useState, useTransition } from "react";
import { setAutoDeploy } from "@/app/(panel)/settings/actions";
import { useToast } from "./overlay";
import { cx } from "./ui";

export function AutoDeployToggle({ project, initial, webhookReady }: { project: string; initial: boolean; webhookReady: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const next = !on;
      const res = await setAutoDeploy(project, next);
      if (res.error) return toast({ tone: "bad", title: "Couldn't change auto-deploy", body: res.error });
      setOn(next);
      toast({ tone: "ok", title: next ? "Auto-deploy on" : "Auto-deploy off", body: next ? "Pushing to the branch now deploys automatically." : "Deploy manually with the Deploy button." });
    });
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">
        Deploy automatically on push
        {!webhookReady && <span className="block text-xs text-faint">Needs the GitHub webhook (see Settings).</span>}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Deploy automatically on push"
        onClick={toggle}
        disabled={pending}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", on ? "bg-ok" : "bg-line-strong")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
