import type { CallType } from "@/lib/callType";
import { hasCheaperTier, type GymFields } from "@/lib/gymConfig";

/**
 * The incentives blocks, compiled from typed gym config.
 *
 * An incentives block is the most consequential text an agent receives: it is
 * the whole of what Charlie may put on the table with a stranger's money. Until
 * onboarding existed these were hand-written per gym. Now a gym supplies typed
 * values — a discount percentage, an offer enum, a tier name and price — and
 * the block is assembled here, from a fixed set of sentences this file owns.
 *
 * Three rules shape every block:
 *
 * 1. **Every block ends with a sentence that closes the door.** A gym with
 *    nothing to offer gets a block that forbids offering, not an empty section.
 *    The closing sentence is the important half; without it the agent fills the
 *    gap with something the gym never agreed to.
 * 2. **Delivery is a property of the offer type, not a setting.** A guest pass
 *    is a link, so its block says to text it. A free session needs a booking,
 *    so its block says someone from the gym will call to arrange a time.
 * 3. **No sentence comes from anywhere but `SENTENCES`.** The only values that
 *    reach a sentence are a validated integer, a validated price and a validated
 *    tier name — and a tier name is held to the tightest text rules in
 *    `lib/textSafety.ts`, because it sits inside an offer sentence.
 *    `lib/validateIncentives.ts` checks every compiled block against this
 *    registry and against the config it came from, independently of the choices
 *    made here, and `compileVariables` runs it on every compile.
 *
 * The two gyms that predate onboarding compile to exactly the text they used to
 * carry by hand — a guard pins that — so the fifteen conversation scenarios that
 * were validated against those words are still valid evidence.
 */

export type OfferKind =
  | "renewal_discount"
  | "guest_pass"
  | "free_session"
  | "free_pt_session"
  | "cheaper_tier";

export type SentenceRole =
  /** Puts one offer on the table. */
  | "grant"
  /** How a granted offer reaches the member. */
  | "delivery"
  /** How to frame the call or the offer. */
  | "frame"
  /** What to say when the member raises something there is no offer for. */
  | "handling"
  /** States that there is nothing, or nothing of a kind. */
  | "deny"
  /** Limits what was granted: "that is everything you have". */
  | "limit"
  /** The last sentence. Closes the door on everything not granted. */
  | "close";

export type Slot = "discount_percent" | "tier_name" | "tier_price";

export interface SentenceTemplate {
  id: string;
  callType: CallType;
  role: SentenceRole;
  /** The sentence, with `{slot}` placeholders for the only values config can supply. */
  text: string;
  grants?: OfferKind;
  delivery?: "link" | "booking";
  /** For a limit/close sentence that counts what was granted ("those two things"). */
  counts?: number;
  /** For a close sentence that explicitly forbids offering anything further. */
  forbids?: boolean;
  /** Mentions the quiet times, which only a gym that gave us quiet times can do. */
  mentionsQuietTimes?: boolean;
  /**
   * Offers this sentence says there are none of, or only makes sense without
   * ("If money is the reason they stopped, say you'll pass it on" can't sit
   * beside a cheaper tier). "all": a sentence for a block with nothing to offer.
   */
  excludes?: OfferKind[] | "all";
  /** The offer this sentence refers back to ("that guest pass"), or "any" offer ("lead with it"). */
  needs?: OfferKind | "any";
}

export const SENTENCES: SentenceTemplate[] = [
  // --- renewal ---------------------------------------------------------------
  {
    id: "renewal.grant.discount",
    callType: "renewal",
    role: "grant",
    grants: "renewal_discount",
    text: "You have one thing you can offer, and only after they hesitate or say the price is a problem: {discount_percent}% off their renewal.",
  },
  {
    id: "renewal.delivery.link",
    callType: "renewal",
    role: "delivery",
    delivery: "link",
    text: "Text it as a link — never read out a code.",
  },
  {
    id: "renewal.limit.everything",
    needs: "renewal_discount",
    callType: "renewal",
    role: "limit",
    counts: 1,
    text: "That is everything you have.",
  },
  {
    id: "renewal.close.no_more",
    needs: "renewal_discount",
    excludes: ["cheaper_tier"],
    callType: "renewal",
    role: "close",
    text: "No other discount exists, no cheaper plan exists, and you cannot ask a manager for more.",
  },
  {
    id: "renewal.none.nothing",
    excludes: "all",
    callType: "renewal",
    role: "deny",
    text: "You have nothing to offer.",
  },
  {
    id: "renewal.none.handling",
    excludes: "all",
    callType: "renewal",
    role: "handling",
    text: "If they say it's too expensive, say you understand, you'll pass it on, and leave it there.",
  },
  {
    id: "renewal.none.close",
    excludes: "all",
    callType: "renewal",
    role: "close",
    forbids: true,
    text: "Do not mention discounts, cheaper plans or alternative prices, and do not offer to ask a manager.",
  },

  // --- reengagement ------------------------------------------------------------
  {
    id: "reengagement.grant.guest_pass",
    callType: "reengagement",
    role: "grant",
    grants: "guest_pass",
    text: "You are calling with something to give them: a guest pass so they can bring a mate in.",
  },
  {
    id: "reengagement.grant.free_session",
    callType: "reengagement",
    role: "grant",
    grants: "free_session",
    text: "You are calling with something to give them: a free session with one of the trainers.",
  },
  {
    id: "reengagement.frame.lead",
    needs: "any",
    callType: "reengagement",
    role: "frame",
    text: "Lead with it — it is your reason for calling, not their absence.",
  },
  {
    id: "reengagement.delivery.link",
    callType: "reengagement",
    role: "delivery",
    delivery: "link",
    text: "Text it as a link.",
  },
  {
    id: "reengagement.delivery.booking",
    callType: "reengagement",
    role: "delivery",
    delivery: "booking",
    text: "It needs booking, so don't text it — say someone from the gym will call to lock in a time.",
  },
  {
    id: "reengagement.limit.guest_pass",
    needs: "guest_pass",
    callType: "reengagement",
    role: "limit",
    counts: 1,
    text: "That guest pass is the only thing you have.",
  },
  {
    id: "reengagement.limit.free_session",
    needs: "free_session",
    callType: "reengagement",
    role: "limit",
    counts: 1,
    text: "That free session is the only thing you have.",
  },
  {
    id: "reengagement.close.nothing_else",
    needs: "any",
    excludes: ["renewal_discount"],
    callType: "reengagement",
    role: "close",
    text: "There is no discount, no free month and nothing else to add to it.",
  },
  {
    id: "reengagement.none.nothing",
    excludes: "all",
    callType: "reengagement",
    role: "deny",
    text: "You have nothing to give them.",
  },
  {
    id: "reengagement.none.frame",
    excludes: "all",
    callType: "reengagement",
    role: "frame",
    text: "Your reason for calling is to check nothing's wrong and that the gym isn't the problem.",
  },
  {
    id: "reengagement.none.close",
    excludes: "all",
    callType: "reengagement",
    role: "close",
    forbids: true,
    text: "Do not offer anything.",
  },

  // --- winback -----------------------------------------------------------------
  {
    id: "winback.grant.free_pt_session",
    callType: "winback",
    role: "grant",
    grants: "free_pt_session",
    text: "If they lost momentum, you can offer a free PT session.",
  },
  {
    id: "winback.grant.guest_pass",
    callType: "winback",
    role: "grant",
    grants: "guest_pass",
    // Same framing as the reengagement pass and the page the texted link opens
    // ("Bring someone with you"), so the offer, the text and the landing agree.
    text: "If they lost momentum, you can offer a guest pass so they can come back in with a mate.",
  },
  {
    id: "winback.delivery.booking",
    callType: "winback",
    role: "delivery",
    delivery: "booking",
    text: "It needs booking, so don't text it — say someone from the gym will call to lock in a time.",
  },
  {
    id: "winback.delivery.link",
    callType: "winback",
    role: "delivery",
    delivery: "link",
    text: "Text it as a link.",
  },
  {
    id: "winback.grant.cheaper_tier",
    callType: "winback",
    role: "grant",
    grants: "cheaper_tier",
    text: "If money is the reason they stopped, you can mention the {tier_name} at {tier_price} a month.",
  },
  {
    id: "winback.handling.money",
    excludes: ["cheaper_tier"],
    callType: "winback",
    role: "handling",
    text: "If money is the reason they stopped, say you understand and you'll pass it on.",
  },
  {
    id: "winback.handling.momentum",
    excludes: ["free_pt_session", "guest_pass"],
    callType: "winback",
    role: "handling",
    text: "If they lost momentum, say you understand and that the door's open.",
  },
  {
    id: "winback.close.two_things",
    callType: "winback",
    role: "close",
    counts: 2,
    text: "Those two things are everything you have.",
  },
  {
    id: "winback.limit.free_pt_session",
    needs: "free_pt_session",
    callType: "winback",
    role: "limit",
    counts: 1,
    text: "That free PT session is the only thing you have.",
  },
  {
    id: "winback.limit.guest_pass",
    needs: "guest_pass",
    callType: "winback",
    role: "limit",
    counts: 1,
    text: "That guest pass is the only thing you have.",
  },
  {
    id: "winback.limit.cheaper_tier",
    needs: "cheaper_tier",
    callType: "winback",
    role: "limit",
    counts: 1,
    text: "That {tier_name} is the only thing you have.",
  },
  {
    id: "winback.close.no_discount_no_tier",
    excludes: ["renewal_discount", "cheaper_tier"],
    callType: "winback",
    role: "close",
    text: "There is no discount and no cheaper plan, and you cannot ask a manager for more.",
  },
  {
    id: "winback.close.no_discount_no_session",
    excludes: ["renewal_discount", "free_pt_session", "free_session"],
    callType: "winback",
    role: "close",
    text: "There is no discount and no free session, and you cannot ask a manager for more.",
  },
  {
    id: "winback.deny.no_session",
    excludes: ["free_pt_session", "free_session", "guest_pass"],
    callType: "winback",
    role: "deny",
    text: "You have no free session and no guest pass to offer.",
  },
  {
    id: "winback.none.nothing",
    excludes: "all",
    callType: "winback",
    role: "deny",
    text: "You have nothing to put on the table — no free session, no cheaper plan, no discount.",
  },
  {
    id: "winback.none.handling",
    excludes: "all",
    callType: "winback",
    role: "handling",
    text: "If money or motivation is the reason they stopped, say you understand and you'll pass it on.",
  },
  {
    id: "winback.none.quiet_and_door",
    excludes: "all",
    callType: "winback",
    role: "handling",
    mentionsQuietTimes: true,
    text: "All you can offer is the quiet times and the door being open.",
  },
  {
    id: "winback.none.door",
    excludes: "all",
    callType: "winback",
    role: "handling",
    text: "All you can offer is the door being open.",
  },
  {
    id: "winback.none.close",
    excludes: "all",
    callType: "winback",
    role: "close",
    forbids: true,
    text: "Do not invent anything else and do not offer to ask a manager.",
  },
];

const BY_ID = new Map(SENTENCES.map((s) => [s.id, s]));

export function sentenceTemplate(id: string): SentenceTemplate {
  const template = BY_ID.get(id);
  if (!template) throw new Error(`no incentives sentence with id ${id}`);
  return template;
}

// --- Slot values -------------------------------------------------------------

/** "$39" for a whole number of dollars, "$39.50" otherwise. */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** The only values from config that can appear inside an incentives sentence. */
export function slotValues(gym: GymFields): Record<Slot, string | null> {
  return {
    discount_percent:
      typeof gym.renewal_discount_percent === "number" ? String(gym.renewal_discount_percent) : null,
    tier_name: typeof gym.cheaper_tier_name === "string" ? gym.cheaper_tier_name : null,
    tier_price: typeof gym.cheaper_tier_price === "number" ? formatMoney(gym.cheaper_tier_price) : null,
  };
}

function fill(template: SentenceTemplate, slots: Record<Slot, string | null>): string {
  return template.text.replace(/\{(discount_percent|tier_name|tier_price)\}/g, (_, slot: Slot) => {
    const value = slots[slot];
    if (value === null) {
      throw new Error(`sentence ${template.id} needs ${slot}, which this gym has not set`);
    }
    return value;
  });
}

// --- Compiling ---------------------------------------------------------------

export interface CompiledSentence {
  id: string;
  text: string;
}

export interface CompiledIncentives {
  callType: CallType;
  sentences: CompiledSentence[];
  /** What the agent receives as `{{incentives}}`. */
  text: string;
}

/** Which sentences, in order, a gym's config calls for on one call type. */
export function incentiveSentenceIds(gym: GymFields, callType: CallType): string[] {
  if (callType === "renewal") {
    return gym.renewal_discount_percent !== null
      ? ["renewal.grant.discount", "renewal.delivery.link", "renewal.limit.everything", "renewal.close.no_more"]
      : ["renewal.none.nothing", "renewal.none.handling", "renewal.none.close"];
  }

  if (callType === "reengagement") {
    switch (gym.reengagement_perk) {
      case "guest_pass":
        return [
          "reengagement.grant.guest_pass",
          "reengagement.frame.lead",
          "reengagement.delivery.link",
          "reengagement.limit.guest_pass",
          "reengagement.close.nothing_else",
        ];
      case "free_session":
        return [
          "reengagement.grant.free_session",
          "reengagement.frame.lead",
          "reengagement.delivery.booking",
          "reengagement.limit.free_session",
          "reengagement.close.nothing_else",
        ];
      default:
        return ["reengagement.none.nothing", "reengagement.none.frame", "reengagement.none.close"];
    }
  }

  const tier = hasCheaperTier(gym);
  switch (gym.winback_offer) {
    case "free_pt_session":
      return tier
        ? [
            "winback.grant.free_pt_session",
            "winback.delivery.booking",
            "winback.grant.cheaper_tier",
            "winback.close.two_things",
          ]
        : [
            "winback.grant.free_pt_session",
            "winback.delivery.booking",
            "winback.handling.money",
            "winback.limit.free_pt_session",
            "winback.close.no_discount_no_tier",
          ];
    case "guest_pass":
      return tier
        ? [
            "winback.grant.guest_pass",
            "winback.delivery.link",
            "winback.grant.cheaper_tier",
            "winback.close.two_things",
          ]
        : [
            "winback.grant.guest_pass",
            "winback.delivery.link",
            "winback.handling.money",
            "winback.limit.guest_pass",
            "winback.close.no_discount_no_tier",
          ];
    default:
      return tier
        ? [
            "winback.deny.no_session",
            "winback.handling.momentum",
            "winback.grant.cheaper_tier",
            "winback.limit.cheaper_tier",
            "winback.close.no_discount_no_session",
          ]
        : [
            "winback.none.nothing",
            "winback.none.handling",
            // "The quiet times" is only something to offer when we know them.
            gym.quiet_hours !== null ? "winback.none.quiet_and_door" : "winback.none.door",
            "winback.none.close",
          ];
  }
}

/** Builds the incentives block for one call type. Pure: config in, sentences out. */
export function compileIncentives(gym: GymFields, callType: CallType): CompiledIncentives {
  const slots = slotValues(gym);
  const sentences = incentiveSentenceIds(gym, callType).map((id) => ({
    id,
    text: fill(sentenceTemplate(id), slots),
  }));
  return { callType, sentences, text: sentences.map((s) => s.text).join(" ") };
}

export const CALL_TYPES: CallType[] = ["renewal", "reengagement", "winback"];
