"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useToast } from "./overlay";
import { cx } from "./ui";

type Result = { jobId?: string; error?: string; ok?: boolean };

const styles = {
  primary: "bg-fg text-invert hover:opacity-90",
  secondary: "border border-line-strong bg-surface hover:bg-hover",
  danger: "bg-bad text-white hover:opacity-90",
};

export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
  success,
  icon,
}: {
  action: () => Promise<Result>;
  children: React.ReactNode;
  variant?: keyof typeof styles;
  confirm?: { title: string; body: React.ReactNode; cta: string };
  success?: string;
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await action();
      setOpen(false);
      if (res.error) return toast({ tone: "bad", title: "That didn't work", body: res.error });
      if (res.jobId) return router.push(`/jobs/${res.jobId}`);
      toast({ tone: "ok", title: success ?? "Done" });
      router.refresh();
    });
  const cls = cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-60", styles[variant]);
  return (
    <>
      <button className={cls} disabled={pending} onClick={() => (confirm ? setOpen(true) : run())}>
        {icon}
        {pending ? "Working…" : children}
      </button>
      {confirm && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={confirm.title}
          footer={
            <>
              <button onClick={() => setOpen(false)} disabled={pending} className={cx("inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium", styles.secondary)}>
                Cancel
              </button>
              <button onClick={run} disabled={pending} className={cx("inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium", styles[variant === "danger" ? "danger" : "primary"])}>
                {pending ? "Working…" : confirm.cta}
              </button>
            </>
          }
        >
          {confirm.body}
        </Dialog>
      )}
    </>
  );
}
