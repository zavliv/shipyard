import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const pill: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-subtle text-muted",
};

const dot: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  neutral: "bg-faint",
};

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", pill[tone])}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-50", dot[tone])} />}
      <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot[tone])} />
    </span>
  );
}

const STATUS: Record<string, [Tone, string]> = {
  up: ["ok", "Up"],
  online: ["ok", "Online"],
  degraded: ["warn", "Partly down"],
  stopped: ["bad", "Stopped"],
  down: ["bad", "Down"],
  static: ["neutral", "Static"],
};

export function statusTone(status: string): Tone {
  return STATUS[status]?.[0] ?? "neutral";
}

export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status];
  return (
    <Badge tone={tone}>
      <Dot tone={tone} />
      {label}
    </Badge>
  );
}

export function sslTone(days: number | null): Tone {
  if (days == null) return "neutral";
  if (days < 14) return "bad";
  if (days < 30) return "warn";
  return "ok";
}

export function SslText({ days }: { days: number | null }) {
  if (days == null) return <span className="text-faint">No SSL</span>;
  const tone = sslTone(days);
  const color = tone === "bad" ? "text-bad-fg" : tone === "warn" ? "text-warn-fg" : "text-fg";
  return <span className={color}>{days < 0 ? "Expired" : `${days} days`}</span>;
}

export function StateBadge({ managed }: { managed: boolean }) {
  return managed ? <Badge tone="info">Managed</Badge> : <span className="text-sm text-muted">Not yet moved</span>;
}

export function Card({
  title,
  action,
  children,
  flush,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, meter }: { label: string; value: React.ReactNode; sub?: React.ReactNode; meter?: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {meter != null && <Meter value={meter} />}
      {sub && <div className="mt-1.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Meter({ value }: { value: number }) {
  const color = value >= 90 ? "bg-bad" : value >= 75 ? "bg-warn" : "bg-fg";
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  back,
  actions,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <IconArrowLeft size={15} aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone, icon, children, action }: { tone: Tone; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  const box: Record<Tone, string> = {
    ok: "border-ok/30 bg-ok-bg text-ok-fg",
    warn: "border-warn/40 bg-warn-bg text-warn-fg",
    bad: "border-bad/30 bg-bad-bg text-bad-fg",
    info: "border-info/30 bg-info-bg text-info-fg",
    neutral: "border-line bg-subtle text-muted",
  };
  return (
    <div className={cx("flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm", box[tone])}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0 font-medium">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={cx("px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted", className)}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function KeyValue({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
          <dt className="text-muted">{k}</dt>
          <dd className="col-span-2 min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-hover disabled:opacity-60";
