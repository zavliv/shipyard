"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconAlertCircle, IconCircleCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { cx } from "./ui";

type Toast = { id: number; tone: "ok" | "bad" | "info"; title: string; body?: string; href?: string; hrefLabel?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in pointer-events-auto flex gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-lg">
            <span className="mt-0.5 shrink-0">
              {t.tone === "ok" ? (
                <IconCircleCheck size={18} className="text-ok" aria-hidden />
              ) : t.tone === "bad" ? (
                <IconAlertCircle size={18} className="text-bad" aria-hidden />
              ) : (
                <IconInfoCircle size={18} className="text-info" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-muted">{t.body}</span>}
              {t.href && (
                <Link href={t.href} className="mt-1 inline-block text-sm font-medium text-info-fg hover:underline">
                  {t.hrefLabel ?? "Open"}
                </Link>
              )}
            </span>
            <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="self-start text-faint hover:text-fg" aria-label="Dismiss">
              <IconX size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "animate-in m-auto w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start gap-3">
            {icon && <span className="mt-0.5">{icon}</span>}
            <h2 className="flex-1 text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="text-faint hover:text-fg" aria-label="Close">
              <IconX size={18} />
            </button>
          </div>
          <div className="mt-3 text-sm text-muted">{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Menu({ trigger, children, align = "end" }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cx(
            "animate-in absolute top-full z-40 mt-1.5 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  href,
  danger,
  hint,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  hint?: string;
}) {
  const cls = cx(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
    danger ? "text-bad-fg hover:bg-bad-bg" : "text-fg hover:bg-hover",
  );
  const inner = (
    <>
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <kbd className="text-xs text-faint">{hint}</kbd>}
    </>
  );
  if (href) {
    const external = href.startsWith("http");
    return external ? (
      <a role="menuitem" href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    ) : (
      <Link role="menuitem" href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button role="menuitem" onClick={onSelect} className={cls}>
      {inner}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}
