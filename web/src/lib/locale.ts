export const TIME_ZONE = process.env.NEXT_PUBLIC_TIMEZONE || "UTC";
export const LOCALE = process.env.NEXT_PUBLIC_LOCALE || "en-GB";
export const WILDCARD_DOMAIN = process.env.NEXT_PUBLIC_WILDCARD_DOMAIN || "";

export function zonedParts(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.NEXT_PUBLIC_TIMEZONE || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: weekdays.indexOf(parts.weekday) };
}
