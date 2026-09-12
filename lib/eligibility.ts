import { routeMember, type Routing } from "@/lib/callType";
import { NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import { today } from "@/lib/clock";
import type { Member } from "@/lib/types";

/**
 * The single gate every call passes through.
 *
 * `routeMember` decides whether a member is at a moment in their membership
 * worth a call. This adds what the database knows: have they asked us to stop,
 * have we already rung them about this, did the last call work. Both halves have
 * to agree before a phone rings, and the answer is computed server-side from the
 * dataset and Supabase — never from anything the client sent.
 */

export interface Eligibility {
  allowed: boolean;
  routing: Routing;
  history: CallHistory;
  /** Which conversation this call would be. */
  attemptNumber: number;
  /** Why not, when `allowed` is false. One line, shown on the member's card. */
  blockedReason: string | null;
  /** Machine-readable reason, for the dashboard's excluded buckets. */
  blockedBy:
    | "auto_renew"
    | "do_not_contact"
    | "not_due"
    | "cooldown"
    | "max_attempts"
    | null;
}

/**
 * Escalating cooldown on the absence trigger.
 *
 * A member who is absent stays absent, so the trigger that fired today fires
 * again tomorrow and every day after. Without a cooldown one member gets eight
 * near-identical calls a year, which is how a retention tool becomes the reason
 * someone cancels.
 *
 * Three months after a call that did not get them in. If a call *did* get them
 * back through the door — even once — the normal trigger resumes immediately,
 * because a call that works has earned the right to happen again.
 */
const COOLDOWN_DAYS_AFTER_CONVERSATION = 90;
/** A dial nobody answered is not an imposition; wait a week and try again. */
const COOLDOWN_DAYS_AFTER_NO_ANSWER = 7;
/**
 * Three conversations is the cap. The prompts only describe behaviour for
 * attempts 1 to 3 ("if attempt_number is 2 or 3, be noticeably briefer"), so a
 * fourth call would be running on undefined behaviour.
 */
const MAX_ATTEMPTS = 3;

function daysBetween(iso: string, asOf: Date): number {
  const then = new Date(iso).getTime();
  return Math.floor((asOf.getTime() - then) / 86_400_000);
}

export function evaluateEligibility(
  member: Member,
  history: CallHistory = NO_HISTORY,
  asOf: Date = today()
): Eligibility {
  const routing = routeMember(member, asOf);
  const base = {
    routing,
    history,
    attemptNumber: history.attemptNumber,
  };

  // Permanent, and checked before the trigger: someone who asked to be left
  // alone is not a member with a call type, they are a member with an answer.
  if (history.doNotContact) {
    return {
      ...base,
      allowed: false,
      blockedBy: "do_not_contact",
      blockedReason:
        "Asked not to be called again. Permanent, and it holds across all three call types.",
    };
  }

  if (routing.auto_renew_excluded) {
    return {
      ...base,
      allowed: false,
      blockedBy: "auto_renew",
      blockedReason: routing.excluded_reason,
    };
  }

  if (!routing.call_type) {
    return {
      ...base,
      allowed: false,
      blockedBy: "not_due",
      blockedReason: routing.excluded_reason,
    };
  }

  if (history.attemptNumber > MAX_ATTEMPTS) {
    return {
      ...base,
      allowed: false,
      blockedBy: "max_attempts",
      blockedReason: `Already had ${history.attemptNumber - 1} conversations. That is the limit — the rest is the front desk's job.`,
    };
  }

  const cooldown = cooldownBlock(history, asOf);
  if (cooldown) {
    return { ...base, allowed: false, blockedBy: "cooldown", blockedReason: cooldown };
  }

  return { ...base, allowed: true, blockedBy: null, blockedReason: null };
}

function cooldownBlock(history: CallHistory, asOf: Date): string | null {
  // A call that got them back in resets nothing: keep calling on the normal
  // trigger, because the intervention is working.
  if (history.cameBackAfterCall) return null;

  if (history.lastConversationAt) {
    const since = daysBetween(history.lastConversationAt, asOf);
    if (since < COOLDOWN_DAYS_AFTER_CONVERSATION) {
      const wait = COOLDOWN_DAYS_AFTER_CONVERSATION - since;
      return `Spoke to them ${since} day${since === 1 ? "" : "s"} ago and nothing changed. Cooling off for another ${wait} day${wait === 1 ? "" : "s"}.`;
    }
    return null;
  }

  if (history.lastCallAt) {
    const since = daysBetween(history.lastCallAt, asOf);
    if (since < COOLDOWN_DAYS_AFTER_NO_ANSWER) {
      const wait = COOLDOWN_DAYS_AFTER_NO_ANSWER - since;
      return `Dialled ${since} day${since === 1 ? "" : "s"} ago with no answer. Trying again in ${wait} day${wait === 1 ? "" : "s"}.`;
    }
  }

  return null;
}

export const COOLDOWN_RULES = {
  COOLDOWN_DAYS_AFTER_CONVERSATION,
  COOLDOWN_DAYS_AFTER_NO_ANSWER,
  MAX_ATTEMPTS,
};
