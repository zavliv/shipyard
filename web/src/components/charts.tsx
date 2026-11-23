"use client";

import { LOCALE, TIME_ZONE } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./ui";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function timeLabel(iso: string, span: "hour" | "day") {
  return new Date(iso).toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    ...(span === "day" ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit", hour12: false }),
  });
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export type LinePoint = { t: string; v: number | null };
export type ValueFormat = "ms" | "bytes" | "percent" | "load";

function fmt(kind: ValueFormat, v: number): string {
  if (kind === "ms") return `${Math.round(v)} ms`;
  if (kind === "percent") return `${v.toFixed(0)}%`;
  if (kind === "load") return v.toFixed(2);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function LineChart({
  points,
  format,
  height = 140,
  span = "hour",
  min0 = true,
  empty = "No data yet. Shipyard checks every minute.",
}: {
  points: LinePoint[];
  format: ValueFormat;
  height?: number;
  span?: "hour" | "day";
  min0?: boolean;
  empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const valid = points.filter((p) => p.v != null) as { t: string; v: number }[];
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;

  const geo = useMemo(() => {
    if (!valid.length || w <= 0) return null;
    const t0 = Date.parse(points[0].t);
    const t1 = Date.parse(points[points.length - 1].t);
    const vs = valid.map((p) => p.v);
    let lo = min0 ? 0 : Math.min(...vs);
    let hi = Math.max(...vs);
    if (hi === lo) {
      hi = hi + (hi || 1) * 0.5;
      lo = min0 ? 0 : lo - (lo || 1) * 0.5;
    }
    hi = hi + (hi - lo) * 0.1;
    const x = (t: string) => pad.l + (t1 === t0 ? w / 2 : ((Date.parse(t) - t0) / (t1 - t0)) * w);
    const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const segments: string[] = [];
    let cur = "";
    for (const p of points) {
      if (p.v == null) {
        if (cur) segments.push(cur);
        cur = "";
        continue;
      }
      cur += `${cur ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    }
    if (cur) segments.push(cur);
    const ticks = [lo, lo + (hi - lo) / 2, hi].map((v) => ({ v, y: y(v) }));
    return { x, y, segments, ticks };
  }, [valid, w, h, points, min0, pad.l, pad.t]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.t) - mx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {!geo ? (
        <div className="flex h-full items-center justify-center text-sm text-faint">{empty}</div>
      ) : (
        <>
          <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Line chart">
            {geo.ticks.map((t, i) => (
              <g key={i}>
                <line x1={pad.l} x2={pad.l + w} y1={t.y} y2={t.y} stroke="var(--line)" strokeWidth={1} strokeDasharray={i === 0 ? undefined : "2 4"} />
                <text x={pad.l - 6} y={t.y + 3.5} textAnchor="end" fontSize={11} fill="var(--faint)">{fmt(format, t.v)}</text>
              </g>
            ))}
            <text x={pad.l} y={height - 6} fontSize={11} fill="var(--faint)">{timeLabel(points[0].t, span)}</text>
            <text x={pad.l + w} y={height - 6} fontSize={11} fill="var(--faint)" textAnchor="end">{timeLabel(points[points.length - 1].t, span)}</text>
            {geo.segments.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="var(--info)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hp && (
              <>
                <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={pad.t} y2={pad.t + h} stroke="var(--line-strong)" strokeWidth={1} />
                {hp.v != null && <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r={4} fill="var(--info)" stroke="var(--surface)" strokeWidth={2} />}
              </>
            )}
          </svg>
          {hp && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: Math.min(Math.max(geo.x(hp.t), 70), width - 70) }}
            >
              <div className="text-faint">{fullTime(hp.t)}</div>
              <div className="font-semibold tabular-nums">{hp.v == null ? "No data" : fmt(format, hp.v)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import type { UptimeBucket as StripBucket } from "@/lib/uptime";

export function UptimeStrip({ buckets, slots, bucketMinutes, height = 28 }: { buckets: StripBucket[]; slots: number; bucketMinutes: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [end] = useState(() => Date.now());
  const byKey = new Map(buckets.map((b) => [Math.floor(Date.parse(b.t) / (bucketMinutes * 60000)), b]));
  const last = Math.floor(end / (bucketMinutes * 60000));
  const cells = Array.from({ length: slots }, (_, i) => {
    const key = last - (slots - 1 - i);
    return { key, start: new Date(key * bucketMinutes * 60000).toISOString(), b: byKey.get(key) };
  });
  const tone = (b?: StripBucket) => {
    if (!b || !b.checks) return "bg-subtle";
    const r = b.up / b.checks;
    return r >= 0.999 ? "bg-ok" : r >= 0.95 ? "bg-warn" : "bg-bad";
  };
  const label = (b?: StripBucket) => {
    if (!b || !b.checks) return "No checks";
    const r = (b.up / b.checks) * 100;
    return `${r >= 99.95 ? "100" : r.toFixed(1)}% up${r < 99.95 ? ` · ${b.checks - b.up} failed` : ""}`;
  };
  const h = hover != null ? cells[hover] : null;
  return (
    <div className="relative">
      <div className="flex gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)} role="img" aria-label="Uptime history">
        {cells.map((c, i) => (
          <span
            key={c.key}
            onMouseEnter={() => setHover(i)}
            className={cx("h-full min-w-[2px] flex-1 rounded-[2px] transition-opacity", tone(c.b), hover != null && hover !== i && "opacity-60")}
          />
        ))}
      </div>
      {h && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
          style={{ left: `${((hover! + 0.5) / slots) * 100}%` }}
        >
          <div className="text-faint">{fullTime(h.start)}</div>
          <div className="font-semibold">{label(h.b)}</div>
          {h.b?.ms != null && <div className="text-muted tabular-nums">{h.b.ms} ms average</div>}
        </div>
      )}
    </div>
  );
}
