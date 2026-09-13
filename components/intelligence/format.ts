/**
 * Presentation helpers for the overview. Each one reshapes a value
 * `composeIntelligence` (lib/intelligence.ts) already computed — a rate, a
 * month key, an hour index — for a label. None introduces a number of its own:
 * a percentage here is always one count divided by another count from the
 * same object.
 */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "$30,200". */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

/** "$79.47". */
export function moneyCents(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A 0–1 rate as "4.6%"; small rates keep enough places to not read as zero. */
export function percent(rate: number | null, places = 1): string {
  if (rate === null) return "—";
  const p = rate * 100;
  if (p > 0 && p < 1 && places < 2) return `${p.toFixed(2)}%`;
  return `${p.toFixed(places)}%`;
}

/** Share of a total, whole percent, from two counts. */
export function share(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : "—";
}

/** "2026-08" → "August" or "Aug". */
export function monthName(key: string, style: "long" | "short" = "long"): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", { month: style, timeZone: "UTC" });
}

/** "5 Sep" from an ISO date. */
export function dayMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function hour12(h: number): number {
  const x = h % 12;
  return x === 0 ? 12 : x;
}

function meridiem(h: number): "am" | "pm" {
  return h % 24 < 12 ? "am" : "pm";
}

/** Axis tick: "5a", "12p". */
export function hourTick(h: number): string {
  return `${hour12(h)}${meridiem(h)[0]}`;
}

/** The hour starting at `h`: "6–7pm", "11am–12pm". */
export function hourRange(h: number): string {
  const a = meridiem(h);
  const b = meridiem(h + 1);
  return `${hour12(h)}${a === b ? "" : a}–${hour12(h + 1)}${b}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;
}
