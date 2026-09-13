import type { CallType } from "@/lib/callType";
import type { QueueEntry } from "@/lib/queueView";

/**
 * Presentation helpers for the call queue. Each one reshapes a value the queue
 * view already carries — a date, a day count, the transcript text — for a cell.
 * None of them decides anything or introduces a number of its own: who is due,
 * and why, is `lib/queueView.ts` → `lib/eligibility.ts`, exactly as for
 * `/api/call`.
 */

const DAY_MS = 86_400_000;

// Spelled out rather than left to Intl's "short" month style: the en-AU CLDR
// abbreviation for September flips between "Sep" and "Sept" depending on the
// ICU data version, so server and browser can disagree and break hydration.
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Sep" from an ISO date or timestamp, in UTC so server and browser agree. */
export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;
}

/** "18 Sep 2026". */
export function longDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "12 Sep, 18:22" — a call's timestamp in the viewer's own time. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}, ${hh}:${mm}`;
}

/** Tenure in days as "2y 4m", "7m", "12d". */
export function tenureLabel(days: number): string {
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}

/** The day a member joined, from the queue's reference date and their tenure. */
export function joinedOn(asOf: string, tenureDays: number): string {
  return new Date(Date.parse(`${asOf}T00:00:00Z`) - tenureDays * DAY_MS).toISOString().slice(0, 10);
}

/** Days since the member asked to cancel, measured from the queue's reference date. */
export function daysSinceRequest(asOf: string, requested: string): number {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${requested.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

/**
 * The "Why now" cell: the router's trigger, cut to the one fact it turns on.
 * The full sentence is in the row's expansion.
 */
export function whyNow(entry: QueueEntry, asOf: string): string {
  switch (entry.call_type) {
    case "cancellation": {
      const days = entry.cancellation_requested ? daysSinceRequest(asOf, entry.cancellation_requested) : null;
      return days === null ? "asked to cancel" : days <= 0 ? "asked to cancel today" : `asked to cancel ${days}d ago`;
    }
    case "renewal":
      return entry.days_to_expiry <= 0 ? "term ends today" : `term ends in ${entry.days_to_expiry}d`;
    case "reengagement":
      return `away ${entry.days_since_visit}d`;
    case "winback":
      return `lapsed ${-entry.days_to_expiry}d ago`;
    default:
      return "";
  }
}

/** The "Expires" cell. An auto-renewer's end date is the next rollover, not an expiry. */
export function expiresLabel(entry: QueueEntry, asOf: string): string {
  // The year only when it isn't the reference date's.
  const day = entry.expiry_date.slice(0, 4) === asOf.slice(0, 4) ? shortDate(entry.expiry_date) : longDate(entry.expiry_date);
  if (entry.days_to_expiry < 0) return `ended ${day}`;
  if (entry.auto_renew) return `rolls ${day}`;
  return day;
}

export interface TranscriptLine {
  who: "Agent" | "Member" | "?";
  text: string;
}

/** `call_records.transcript` is written as "agent: …\nuser: …" by lib/callAnalysis.ts. */
export function parseTranscript(transcript: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of transcript.split("\n")) {
    const match = /^(agent|user|[a-z_]+|\?):\s?(.*)$/i.exec(raw);
    if (match) {
      const role = match[1].toLowerCase();
      lines.push({ who: role === "agent" ? "Agent" : role === "user" ? "Member" : "?", text: match[2] });
    } else if (lines.length > 0) {
      lines[lines.length - 1].text += `\n${raw}`;
    } else if (raw.trim()) {
      lines.push({ who: "?", text: raw });
    }
  }
  return lines.filter((l) => l.text.trim().length > 0);
}

export const CALL_TYPE_ORDER: CallType[] = ["cancellation", "renewal", "reengagement", "winback"];

/** Tailwind classes for a call type's tint: the tag, the cell, the chip when on. */
export const CALL_TYPE_TINT: Record<CallType, { bg: string; ink: string; border: string }> = {
  renewal: { bg: "bg-renew-bg", ink: "text-renew-ink", border: "border-renew-ink" },
  reengagement: { bg: "bg-reeng-bg", ink: "text-reeng-ink", border: "border-reeng-ink" },
  winback: { bg: "bg-winb-bg", ink: "text-winb-ink", border: "border-winb-ink" },
  cancellation: { bg: "bg-flag-wash", ink: "text-flag-ink", border: "border-flag" },
};

/** The order the excluded buckets are shown in: the product's thesis first, the merely not-yet-due last. */
export const BLOCKED_ORDER = ["auto_renew", "do_not_contact", "nothing_to_offer", "cooldown", "max_attempts", "not_due"] as const;

/** One line under each excluded bucket's heading: what the rule is. */
export const BLOCKED_NOTE: Record<(typeof BLOCKED_ORDER)[number], string> = {
  auto_renew: "a call is the only thing that could end the membership",
  do_not_contact: "permanent, across every call type",
  nothing_to_offer: "asked to cancel, and the gym has neither a freeze nor a cheaper tier",
  cooldown: "a conversation in the last 90 days changed nothing, or a dial went unanswered this week",
  max_attempts: "three conversations already, or the one about cancelling",
  not_due: "no trigger has fired for them today",
};
