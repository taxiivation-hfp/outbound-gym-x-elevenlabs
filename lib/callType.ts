import { daysUntil, today } from "@/lib/clock";
import type { Member } from "@/lib/types";

/**
 * Which of the three agents this member is due for, or nothing.
 *
 * Rule-based and interpretable on purpose. A front-desk manager has to be able
 * to see why a member was called, so every decision here reduces to a sentence
 * they can read on the card — which is a deliberate trade against whatever raw
 * accuracy a churn model might buy, and the thing that separates this from a
 * black-box propensity score.
 *
 * This function is pure: member facts plus a reference date. Gates that need
 * the database — do-not-contact, attempt count, cooldown — sit on top of it in
 * `lib/eligibility.ts`, so this stays testable and renderable on the client.
 */
export type CallType = "renewal" | "reengagement" | "winback";

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

function weeks(days: number): string {
  const w = Math.round(days / 7);
  return `${w} week${w === 1 ? "" : "s"}`;
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

  // The one hard exclusion, and the whole product. An auto-renewing membership
  // keeps billing whether or not they turn up; the call is the only thing that
  // can end it. Checked before anything else so no later branch can undo it.
  if (member.auto_renew) {
    return {
      ...base,
      auto_renew_excluded: true,
      excluded_reason:
        "Auto-renewing membership. The call is the only thing that could end it, " +
        "so they are never called — however long they have been away.",
    };
  }

  const lapsed = member.contract_status === "expired" || daysToExpiry < 0;

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
        `Fixed term ends in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"} and ` +
        "will not renew itself. Still training — last visit " +
        `${absent} day${absent === 1 ? "" : "s"} ago.`,
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
          `Away ${weeks(absent)} with only ${daysToExpiry} day` +
          `${daysToExpiry === 1 ? "" : "s"} left on the term. Get them back in ` +
          "first; the renewal is a heads-up, not a pitch.",
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
          "Nothing to say yet."
        : "Training normally. Nothing to say yet.",
  };
}

export function routeMembers(members: Member[], asOf: Date = today()): Map<string, Routing> {
  return new Map(members.map((m) => [m.member_id, routeMember(m, asOf)]));
}
