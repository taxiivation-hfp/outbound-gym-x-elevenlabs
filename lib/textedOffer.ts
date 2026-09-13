import type { CallType } from "@/lib/callType";
import type { GymFields } from "@/lib/gymConfig";
import { compileIncentives, sentenceTemplate } from "@/lib/incentives";

/**
 * What an "incentive" text may carry.
 *
 * The agent's `send_text` tool only says `link_type: "incentive"`. What that
 * link is — a guest pass, a renewal discount, or nothing at all — comes from the
 * same compiled incentives block the agent was given on this call: the one
 * offer that block tells it to text as a link. A gym with nothing to offer gets
 * no incentive text, and a renewal discount is never sent as a guest pass. The
 * text message and the page it opens say only what this returns.
 */
export type TextedOffer = { kind: "guest_pass" } | { kind: "renewal_discount"; percent: number };

export function textedOffer(gym: GymFields, callType: CallType | null): TextedOffer | null {
  if (!callType) return null;
  const templates = compileIncentives(gym, callType).sentences.map((s) => sentenceTemplate(s.id));
  if (!templates.some((t) => t.delivery === "link")) return null;
  const linked = templates
    .map((t) => t.grants)
    .filter((g): g is "guest_pass" | "renewal_discount" => g === "guest_pass" || g === "renewal_discount");
  if (linked.length !== 1) return null;
  if (linked[0] === "renewal_discount") {
    return gym.renewal_discount_percent !== null ? { kind: "renewal_discount", percent: gym.renewal_discount_percent } : null;
  }
  return { kind: "guest_pass" };
}

/**
 * The offer a landing page may describe, from the gym's config alone: a link
 * can be opened by anyone, so the page claims an offer only when this gym
 * grants it on some call.
 */
export function landingOffer(gym: GymFields | null, requested: string | null): TextedOffer | null {
  if (!gym) return null;
  if (requested === "guest_pass" && (gym.reengagement_perk === "guest_pass" || gym.winback_offer === "guest_pass")) {
    return { kind: "guest_pass" };
  }
  if (requested === "renewal_discount" && gym.renewal_discount_percent !== null) {
    return { kind: "renewal_discount", percent: gym.renewal_discount_percent };
  }
  return null;
}
