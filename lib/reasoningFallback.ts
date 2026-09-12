// Fallback for the reasoning layer (Section 1.10 of the build plan).
// If the batched LLM reasoning pass falls behind or breaks, generate the
// "reason" field straight from the signals already in members_scored.json.
// Same components read either version — the shape is identical.

import type { Member } from "@/lib/types";

export function generateFallbackReason(member: Member): string {
  const { name, cohort, signals, action } = member;
  const { old_rate, days_since_visit, tenure_days } = signals;

  const tenureMonths = Math.max(1, Math.round(tenure_days / 30));
  const rateStr = formatRate(old_rate);
  const sinceStr = formatDaysSince(days_since_visit);

  switch (cohort) {
    case "winback":
      return `${name} trained ${rateStr} for about ${tenureMonths} month${plural(
        tenureMonths
      )} and hasn't visited in ${sinceStr}. Membership has lapsed — an outbound call has nothing left to cancel.`;

    case "sleeping_dog":
      return `${name} hasn't visited in ${sinceStr} but is still an active, paying member. Contacting them risks reminding them to cancel — do not contact.`;

    case "sliding":
      return `${name}'s visits have dropped off recently after training ${rateStr}. Still attending occasionally — a floor conversation next visit can catch this before it becomes a lapse.`;

    case "new_joiner":
      return `${name} joined ${
        tenureMonths <= 1 ? "recently" : `${tenureMonths} months ago`
      } and has visited fewer than twice so far. An in-person welcome conversation now sets the habit early.`;

    case "steady":
      return `${name} is training consistently at ${rateStr} with no signs of drop-off. No action needed right now.`;

    default:
      return `${name}: ${action}.`;
  }
}

function formatRate(ratePerWeek: number): string {
  if (ratePerWeek <= 0) return "rarely";
  const rounded = Math.round(ratePerWeek * 10) / 10;
  return `${rounded}x/week`;
}

function formatDaysSince(days: number): string {
  if (days < 7) return `${days} day${plural(days)}`;
  if (days < 60) return `${Math.round(days / 7)} week${plural(Math.round(days / 7))}`;
  return `${Math.round(days / 30)} month${plural(Math.round(days / 30))}`;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** Batch helper: fills in `reason` for every member using the template. */
export function applyFallbackReasons(members: Member[]): Member[] {
  return members.map((m) => ({ ...m, reason: generateFallbackReason(m) }));
}
