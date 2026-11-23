import Link from "next/link";
import { appMemory, siteBuckets } from "@/lib/metrics";
import { LineChart, UptimeStrip } from "./charts";
import { uptimePct } from "@/lib/uptime";
import { cx } from "./ui";

const RANGES = {
  "24h": { hours: 24, bucket: 30, slots: 48, span: "hour" as const, label: "24 hours" },
  "7d": { hours: 168, bucket: 180, slots: 56, span: "day" as const, label: "7 days" },
  "30d": { hours: 720, bucket: 1440, slots: 30, span: "day" as const, label: "30 days" },
};

export type RangeKey = keyof typeof RANGES;

export function rangeOf(v: unknown): RangeKey {
  return v === "7d" || v === "30d" ? v : "24h";
}


export async function SiteMonitoring({ siteId, processes, base, range }: { siteId: string; processes: string[]; base: string; range: RangeKey }) {
  const r = RANGES[range];
  const [buckets, memory] = await Promise.all([
    siteBuckets([siteId], r.hours, r.bucket).then((b) => b[siteId] ?? []),
    processes.length ? appMemory(processes, r.hours, Math.max(r.bucket, 10)) : Promise.resolve([]),
  ]);
  const pct = uptimePct(buckets);
  const okMs = buckets.filter((b) => b.ms != null).map((b) => b.ms!);
  const avgMs = okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null;
  const failed = buckets.reduce((s, b) => s + (b.checks - b.up), 0);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Monitoring</h2>
        <div className="flex rounded-lg border border-line p-0.5 text-xs" role="tablist" aria-label="Time range">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <Link
              key={k}
              href={`${base}?range=${k}`}
              scroll={false}
              role="tab"
              aria-selected={range === k}
              className={cx("rounded-md px-2.5 py-1", range === k ? "bg-subtle font-medium text-fg" : "text-muted hover:text-fg")}
            >
              {k}
            </Link>
          ))}
        </div>
      </header>
      <div className="space-y-6 p-5">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted">Uptime · {r.label}</div>
            <div className={cx("mt-0.5 text-2xl font-semibold tabular-nums", pct != null && pct < 99 && "text-warn-fg")}>
              {pct == null ? "–" : `${pct >= 99.995 ? "100" : pct.toFixed(2)}%`}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Average response</div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">{avgMs == null ? "–" : `${avgMs} ms`}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Failed checks</div>
            <div className={cx("mt-0.5 text-2xl font-semibold tabular-nums", failed > 0 && "text-bad-fg")}>{buckets.length ? failed : "–"}</div>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>Uptime</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok" /> Up</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-warn" /> Some failures</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-bad" /> Down</span>
            </span>
          </div>
          <UptimeStrip buckets={buckets} slots={r.slots} bucketMinutes={r.bucket} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs text-muted">Response time</div>
            <LineChart points={buckets.map((b) => ({ t: b.t, v: b.ms }))} format="ms" span={r.span} />
          </div>
          <div>
            <div className="mb-2 text-xs text-muted">Memory used by the site&apos;s apps</div>
            <LineChart points={memory} format="bytes" span={r.span} empty={processes.length ? "No data yet. Sampled every 5 minutes." : "This site has no app processes."} />
          </div>
        </div>
      </div>
    </section>
  );
}
