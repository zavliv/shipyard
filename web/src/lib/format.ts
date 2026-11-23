import { LOCALE, TIME_ZONE } from "./locale";
export function bytes(n: number | null | undefined): string {
  if (n == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function since(isoOrText: string | null): string {
  if (!isoOrText) return "-";
  const t = Date.parse(isoOrText);
  if (Number.isNaN(t)) return isoOrText;
  return duration(Math.max(0, (Date.now() - t) / 1000));
}

export function dateTime(d: Date | string): string {
  return new Date(d).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE });
}
