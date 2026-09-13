/**
 * Owns: the pure router choosing a member's call type, auto-renew exclusion first, with a reason per branch.
 * Not here: do-not-contact, the 3-call cap, cooldowns and nothing-to-offer, which live in lib/eligibility.ts.
 */
import { daysUntil, today } from "@/lib/clock";
import type { Member } from "@/lib/types";

/**
 * Which of the four agents this member is due for, or nothing.
 *
 * Rule-based and interpretable on purpose. A front-desk manager has to be able
 * to see why a member was called, so every decision here reduces to a sentence
 * they can read on the card — which is a deliberate trade against whatever raw
 * accuracy a churn model might buy, and the thing that separates this from a
 * black-box propensity score.
 *
 * This function is pure: member facts plus a reference date. Gates that need
 * the database — do-not-contact, attempt count, cooldown — and the one that
 * needs the gym's config (a cancellation call with nothing to offer) sit on top
 * of it in `lib/eligibility.ts`, so this stays testable and renderable on the
 * client.
 */
export type CallType = "renewal" | "reengagement" | "winback" | "cancellation";

/** Which winback moment, in months after expiry. */
export type WinbackWindow = 1 | 3 | 6;

export interface Routing {
  call_type: CallType | null;
  /** One line for the queue: why this member is due today. */
  trigger: string | null;
  /** One line for the excluded list: why they are not. */
  excluded_reason: string | null;
  /** True when the reason is the auto-renew rule rather than timing. */
  auto_renew_excluded: boolean;
  winback_window: WinbackWindow | null;
  /** Negative once the membership has lapsed. */
  days_to_expiry: number;
}

// --- Trigger thresholds ----------------------------------------------------
// Dated triggers, from the call-type spec. The one addition is HABIT_MIN_RATE:
// without it, "four weeks absent" fires for every naturally sporadic member who
// happens to miss a month, and the reengagement agent spends its calls on
// people who were never regulars.
const RENEWAL_DAYS_BEFORE_EXPIRY = 14;
const ABSENCE_DAYS = 28;
const RECENT_VISIT_DAYS = 28;
const HABIT_MIN_RATE = 1.0; // visits per week, historical
/** Post-expiry cadence: ~1 month, ~3 months, ~6 months. */
const WINBACK_WINDOWS: Array<{ window: WinbackWindow; from: number; to: number }> = [
  { window: 1, from: 20, to: 45 },
  { window: 3, from: 75, to: 105 },
  { window: 6, from: 165, to: 195 },
];

/**
 * The thresholds above, read-only, for anything that has to describe members
 * the way the router does — the gym-health segments and the offer habit gate —
 * so a screen and the queue can't disagree about who is "inactive" or "a regular".
 */
export const ROUTING_THRESHOLDS = {
  RENEWAL_DAYS_BEFORE_EXPIRY,
  ABSENCE_DAYS,
  RECENT_VISIT_DAYS,
  HABIT_MIN_RATE,
} as const;

function weeks(days: number): string {
  const w = Math.round(days / 7);
  return `${w} week${w === 1 ? "" : "s"}`;
}

/** "today" / "yesterday" / "6 days ago" — these lines are read by a human. */
function daysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function daysLeft(days: number): string {
  if (days <= 0) return "ends today";
  if (days === 1) return "ends tomorrow";
  return `ends in ${days} days`;
}

/** "24 September" — a date as it reads on the card. */
function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en-AU", { month: "long", timeZone: "UTC" })}`;
}

/** Days since the member asked to cancel, from the request's local date. */
export function daysSinceCancellationRequest(member: Member, asOf: Date): number | null {
  if (!member.cancellation_requested) return null;
  return -daysUntil(member.cancellation_requested.slice(0, 10), asOf);
}

export function routeMember(member: Member, asOf: Date = today()): Routing {
  const daysToExpiry = daysUntil(member.expiry_date, asOf);
  const daysSinceExpiry = -daysToExpiry;
  const { days_since_visit: absent, old_rate: oldRate } = member.signals;

  const base = {
    call_type: null,
    trigger: null,
    excluded_reason: null,
    auto_renew_excluded: false,
    winback_window: null,
    days_to_expiry: daysToExpiry,
  } satisfies Routing;

  const requested = daysSinceCancellationRequest(member, asOf);

  // The one hard exclusion, and the whole product. An auto-renewing membership
  // keeps billing whether or not they turn up; the call is the only thing that
  // can end it. Checked before anything else so no later branch can undo it.
  if (member.auto_renew) {
    // The single exception, and it lives inside the exclusion rather than
    // before it: a member who has asked to cancel has already ended the
    // membership themselves, so the call is no longer the thing that could.
    // That is the only thing that lifts the rule, and it lifts it for one call
    // type only — never renewal, reengagement or winback.
    if (requested !== null) {
      return {
        ...base,
        call_type: "cancellation",
        trigger:
          `Asked to cancel ${daysAgo(requested)}. The one call an auto-renewing member ever gets: ` +
          "the request is what ends the membership now, not this call. One conversation, at most two offers.",
      };
    }
    return {
      ...base,
      auto_renew_excluded: true,
      excluded_reason:
        "Auto-renewing membership. The call is the only thing that could end it, " +
        "so they are never called — however long they have been away.",
    };
  }

  const lapsed = member.contract_status === "expired" || daysToExpiry < 0;

  // A fixed-term member who has asked to cancel gets the same single call, not
  // a renewal pitch or a reengagement nudge: they have said they are leaving.
  // Once the term has actually ended there is nothing left to cancel, and
  // someone who chose to leave is not rung with a winback either.
  if (requested !== null) {
    if (lapsed) {
      return {
        ...base,
        excluded_reason:
          `Asked to cancel ${daysAgo(requested)} and the membership has since ended. Nothing left to cancel, ` +
          "and a member who chose to leave is not called back with a winback.",
      };
    }
    return {
      ...base,
      call_type: "cancellation",
      trigger:
        `Asked to cancel ${daysAgo(requested)} rather than let the term run to ${formatDay(member.expiry_date)}. ` +
        "Not a renewal call: one conversation, at most two offers, and the cancellation goes ahead.",
    };
  }

  if (lapsed) {
    const match = WINBACK_WINDOWS.find(
      (w) => daysSinceExpiry >= w.from && daysSinceExpiry <= w.to
    );
    if (match) {
      return {
        ...base,
        call_type: "winback",
        winback_window: match.window,
        trigger:
          `Membership lapsed ${weeks(daysSinceExpiry)} ago — the ` +
          `${match.window}-month winback window. Nothing left to cancel.`,
      };
    }
    const next = WINBACK_WINDOWS.find((w) => daysSinceExpiry < w.from);
    return {
      ...base,
      excluded_reason: next
        ? `Lapsed ${daysSinceExpiry} days ago. Next winback window opens at ` +
          `${next.from} days (~${next.window} month${next.window === 1 ? "" : "s"}).`
        : `Lapsed ${Math.round(daysSinceExpiry / 30)} months ago — past the last ` +
          "winback window. Not called again.",
    };
  }

  // Live, fixed-term membership from here on.
  const nearExpiry = daysToExpiry <= RENEWAL_DAYS_BEFORE_EXPIRY;
  const stillTraining = absent <= RECENT_VISIT_DAYS;

  if (nearExpiry && stillTraining) {
    return {
      ...base,
      call_type: "renewal",
      trigger:
        `Fixed term ${daysLeft(daysToExpiry)} and will not renew itself. ` +
        `Still training — last visit ${daysAgo(absent)}.`,
    };
  }

  if (absent >= ABSENCE_DAYS) {
    // Near expiry and absent: fires whatever their history, because the
    // membership lapses either way and there is nothing left to protect.
    if (nearExpiry) {
      return {
        ...base,
        call_type: "reengagement",
        trigger:
          `Away ${weeks(absent)} and the term ${daysLeft(daysToExpiry)}. Get them back ` +
          "in first; the renewal is a heads-up, not a pitch.",
      };
    }
    if (oldRate >= HABIT_MIN_RATE) {
      return {
        ...base,
        call_type: "reengagement",
        trigger:
          `Away ${weeks(absent)} after a settled habit of ${oldRate.toFixed(1)} ` +
          "visits a week. Membership still live, so there is time to fix it.",
      };
    }
    return {
      ...base,
      excluded_reason:
        `Away ${weeks(absent)}, but never a regular (${oldRate.toFixed(1)} visits a ` +
        "week historically). A quiet month is not a signal for someone who was " +
        "always occasional.",
    };
  }

  return {
    ...base,
    excluded_reason:
      daysToExpiry > RENEWAL_DAYS_BEFORE_EXPIRY
        ? `Training normally and the term runs another ${daysToExpiry} days. ` +
          "Nothing worth a phone call yet."
        : "Training normally. Nothing to say yet.",
  };
}

export function routeMembers(members: Member[], asOf: Date = today()): Map<string, Routing> {
  return new Map(members.map((m) => [m.member_id, routeMember(m, asOf)]));
}
