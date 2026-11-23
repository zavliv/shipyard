export type UptimeBucket = { t: string; checks: number; up: number; ms: number | null };

export function uptimePct(buckets: UptimeBucket[]): number | null {
  const checks = buckets.reduce((s, b) => s + b.checks, 0);
  if (!checks) return null;
  return (buckets.reduce((s, b) => s + b.up, 0) / checks) * 100;
}
