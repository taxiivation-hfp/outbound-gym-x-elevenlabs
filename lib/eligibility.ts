import { ROUTING_THRESHOLDS, routeMember, type CallType, type Routing } from "@/lib/callType";
import { NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import { daysUntil, today } from "@/lib/clock";
import {
  OFFER_PERIOD_DAYS,
  OFFER_PERIOD_LABEL,
  SCHEDULABLE_OFFER_LABEL,
  SCHEDULABLE_OFFERS,
  hasCheaperTier,
  hasFreeze,
  type GymFields,
  type OfferSchedule,
  type SchedulableOffer,
} from "@/lib/gymConfig";
import type { OfferKind } from "@/lib/incentives";
import type { Member } from "@/lib/types";

/**
 * The single gate every call passes through.
 *
 * `routeMember` decides whether a member is at a moment in their membership
 * worth a call. This adds what the database knows: have they asked us to stop,
 * have we already rung them about this, did the last call work. Both halves have
 * to agree before a phone rings, and the answer is computed server-side from the
 * dataset and Supabase — never from anything the client sent.
 *
 * The cancellation call adds one gate that needs the gym's config rather than
 * the database: a member who has asked to cancel is called only when the gym
 * has a freeze or a cheaper tier to offer them. A call to someone who is
 * leaving, with nothing to put on the table, only annoys — and the product's
 * whole thesis is refusing calls that cost more than they return.
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
    | "nothing_to_offer"
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
/**
 * You do not ring someone twice about their cancellation. One conversation
 * about it, ever — counted on cancellation calls alone, so an earlier
 * reengagement or winback conversation doesn't use it up.
 */
const CANCELLATION_MAX_ATTEMPTS = 1;

function daysBetween(iso: string, asOf: Date): number {
  const then = new Date(iso).getTime();
  return Math.floor((asOf.getTime() - then) / 86_400_000);
}

/** What a gym can put on the table for a member who has asked to cancel. */
export function cancellationOffers(gym: GymFields): { freeze: boolean; cheaperTier: boolean; any: boolean } {
  const freeze = hasFreeze(gym);
  const cheaperTier = hasCheaperTier(gym);
  return { freeze, cheaperTier, any: freeze || cheaperTier };
}

/**
 * `gym` is the config the call would speak for. It only matters to a
 * cancellation routing: a gym with neither a freeze nor a cheaper tier has
 * nothing to offer a member who is leaving, and doesn't call them. When the
 * gym isn't known — a reader with no gym in scope — the gate isn't applied
 * here; the call route always has the gym and applies it before dialling.
 */
export function evaluateEligibility(
  member: Member,
  history: CallHistory = NO_HISTORY,
  asOf: Date = today(),
  gym?: GymFields | null
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
        "Asked not to be called again. Permanent, and it holds across every call type.",
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

  if (routing.call_type === "cancellation") {
    if (gym && !cancellationOffers(gym).any) {
      return {
        ...base,
        allowed: false,
        blockedBy: "nothing_to_offer",
        blockedReason:
          `${gym.gym_name} has neither a freeze nor a cheaper membership to offer, so there is nothing to ` +
          "put on the table. A call to someone who is leaving, with nothing to offer them, only annoys.",
      };
    }
    if (history.cancellationConversations >= CANCELLATION_MAX_ATTEMPTS) {
      return {
        ...base,
        allowed: false,
        blockedBy: "max_attempts",
        blockedReason: "Already spoken to about their cancellation. Nobody is rung twice about leaving.",
      };
    }
    // Not the conversation cooldown: that exists for a trigger that fires
    // again every day, and this one fires once. A dial nobody answered still
    // waits its week before a redial.
    const redial = noAnswerBlock(history, asOf);
    if (redial) return { ...base, allowed: false, blockedBy: "cooldown", blockedReason: redial };
    return { ...base, allowed: true, blockedBy: null, blockedReason: null };
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

  return noAnswerBlock(history, asOf);
}

/** The redial wait after a dial nobody answered — the only cooldown a cancellation call observes. */
function noAnswerBlock(history: CallHistory, asOf: Date): string | null {
  if (!history.lastCallAt) return null;
  const since = daysBetween(history.lastCallAt, asOf);
  if (since < COOLDOWN_DAYS_AFTER_NO_ANSWER) {
    const wait = COOLDOWN_DAYS_AFTER_NO_ANSWER - since;
    return `Dialled ${since} day${since === 1 ? "" : "s"} ago with no answer. Trying again in ${wait} day${wait === 1 ? "" : "s"}.`;
  }
  return null;
}

// --- Offers ----------------------------------------------------------------------

/**
 * Which of the gym's offers may be compiled into this call's incentives block.
 *
 * `evaluateEligibility` decides whether a member is called; this decides what
 * the call may put on the table, from the same history. It runs before the
 * block is compiled, and an offer it withholds is compiled as though the gym
 * had never configured it — the "nothing to offer" sentences that already
 * exist, and that the validator already checks. The prompt is never told about
 * a cooldown, so there is nothing in it to argue with.
 *
 * Two rules, in order:
 *
 * 1. **Only inactive members who had a genuine habit reach a give-away.** On a
 *    reengagement or winback call — the calls a member earns by not coming in —
 *    every offer is withheld unless they are away (`ABSENCE_DAYS`, or lapsed)
 *    after a settled habit (`HABIT_MIN_RATE`, the router's own 1.0 visits a
 *    week). Gaming that means not going to the gym, which costs more than the
 *    offer, and someone who never had a routine can't qualify at all. A renewal
 *    call reaches members who are still training, so the gate doesn't apply;
 *    its discount is limited by the schedule alone.
 * 2. **Each offer type has its own cooldown.** The gym's schedule says how often
 *    each may be made to the same member; one being spent says nothing about
 *    another. `never` withholds that offer from everyone. An offer with no
 *    schedule has no cooldown, and there is no lifetime cap.
 */
export interface OfferEligibility {
  /** Offer → why it isn't on this call. Offers not listed may be compiled. */
  withheld: Partial<Record<SchedulableOffer, string>>;
}

const ABSENCE_CALLS = new Set<CallType>(["reengagement", "winback"]);

function offerLabel(offer: SchedulableOffer): string {
  return SCHEDULABLE_OFFER_LABEL[offer];
}

/**
 * The schedule's key for an offer a compiled block grants on a call type. A
 * freeze has no key: it isn't scheduled, because the only call that carries it
 * is the one the schedule doesn't apply to.
 */
export function scheduleKey(offer: OfferKind, callType: CallType): SchedulableOffer | null {
  if (offer === "freeze") return null;
  if (offer !== "other") return offer;
  return callType === "reengagement" ? "reengagement_other" : callType === "winback" ? "winback_other" : null;
}

export function evaluateOffers(
  member: Member,
  history: CallHistory,
  schedule: OfferSchedule | null | undefined,
  callType: CallType,
  asOf: Date = today()
): OfferEligibility {
  const withheld: OfferEligibility["withheld"] = {};
  const { ABSENCE_DAYS, HABIT_MIN_RATE } = ROUTING_THRESHOLDS;

  // Neither gate applies to a cancellation call, and that is a decision rather
  // than an omission. The schedule's cooldown exists so a member isn't offered
  // the same thing every month; a member who has asked to cancel is on their
  // way out and gets this one call. The habit gate exists to tell a routine
  // from sporadic attendance, which says nothing about someone actively
  // leaving. Whatever the gym configured is on the table, once.
  if (callType === "cancellation") return { withheld };

  if (ABSENCE_CALLS.has(callType)) {
    const lapsed = member.contract_status === "expired" || daysUntil(member.expiry_date, asOf) < 0;
    const inactive = lapsed || member.signals.days_since_visit >= ABSENCE_DAYS;
    const hadHabit = member.signals.old_rate >= HABIT_MIN_RATE;
    if (!inactive || !hadHabit) {
      const reason = !hadHabit
        ? `Never a regular (${member.signals.old_rate.toFixed(1)} visits a week before they stopped, under ${HABIT_MIN_RATE}), so no offer reaches them.`
        : `Still coming in (last visit ${member.signals.days_since_visit} days ago), so no offer reaches them.`;
      for (const offer of SCHEDULABLE_OFFERS) withheld[offer] = reason;
      return { withheld };
    }
  }

  for (const offer of SCHEDULABLE_OFFERS) {
    const period = schedule?.[offer];
    if (!period) continue;
    if (period === "never") {
      withheld[offer] = `The gym has switched the ${offerLabel(offer)} off.`;
      continue;
    }
    const last = history.offersLastMade[offer];
    if (!last) continue;
    const since = daysBetween(last, asOf);
    const allowedEvery = OFFER_PERIOD_DAYS[period];
    if (since < allowedEvery) {
      const wait = allowedEvery - since;
      withheld[offer] =
        `Offered a ${offerLabel(offer)} ${since} day${since === 1 ? "" : "s"} ago, and the gym allows one every ${OFFER_PERIOD_LABEL[period]}. ` +
        `Available again in ${wait} day${wait === 1 ? "" : "s"}.`;
    }
  }
  return { withheld };
}

/**
 * The gym's fields with withheld offers removed: what the block is compiled and
 * validated from. Blanking a field is how "this gym has nothing of that kind"
 * has always been said, so a withheld offer takes a path the compiler and the
 * validator already cover.
 */
export function withholdOffers(gym: GymFields, eligibility: OfferEligibility | null | undefined): GymFields {
  const withheld = eligibility?.withheld ?? {};
  const out: GymFields = { ...gym };
  if (withheld.renewal_discount) out.renewal_discount_percent = null;
  if (withheld.guest_pass) {
    if (out.reengagement_perk === "guest_pass") out.reengagement_perk = null;
    if (out.winback_offer === "guest_pass") out.winback_offer = null;
  }
  if (withheld.free_session && out.reengagement_perk === "free_session") out.reengagement_perk = null;
  if (withheld.free_pt_session && out.winback_offer === "free_pt_session") out.winback_offer = null;
  if (withheld.cheaper_tier) {
    out.cheaper_tier_name = null;
    out.cheaper_tier_price = null;
  }
  if (withheld.reengagement_other && out.reengagement_perk === "other") {
    out.reengagement_perk = null;
    out.reengagement_other_label = null;
    out.reengagement_other_delivery = null;
  }
  if (withheld.winback_other && out.winback_offer === "other") {
    out.winback_offer = null;
    out.winback_other_label = null;
    out.winback_other_delivery = null;
  }
  return out;
}

export const COOLDOWN_RULES = {
  COOLDOWN_DAYS_AFTER_CONVERSATION,
  COOLDOWN_DAYS_AFTER_NO_ANSWER,
  MAX_ATTEMPTS,
  CANCELLATION_MAX_ATTEMPTS,
};
