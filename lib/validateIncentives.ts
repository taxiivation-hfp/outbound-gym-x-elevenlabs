import type { CallType } from "@/lib/callType";
import {
  FREEZE_FEE_MAX,
  FREEZE_WEEKS_MAX,
  FREEZE_WEEKS_MIN,
  OTHER_OFFER_DELIVERIES,
  OTHER_OFFER_LABEL_MAX,
  RENEWAL_DISCOUNT_MAX,
  RENEWAL_DISCOUNT_MIN,
  REENGAGEMENT_PERKS,
  TIER_PRICE_MAX,
  WINBACK_OFFERS,
  hasAtMostTwoDecimals,
} from "@/lib/gymConfig";
import {
  SENTENCES,
  SLOT_PATTERN,
  formatMoney,
  formatWeeks,
  type OfferKind,
  type SentenceTemplate,
  type Slot,
} from "@/lib/incentives";
import { checkText, looksLikeInstruction, normaliseText } from "@/lib/textSafety";

/**
 * Assertions over a compiled incentives block.
 *
 * The eval suite already asserts over routing logic; this asserts over the
 * prompt text that logic produces. Given the finished block and the typed config
 * it claims to come from, it checks what the plan for onboarding requires of
 * every block, independently of how the compiler chose its sentences:
 *
 * - every sentence is one of the compiler's own templates, with slots holding
 *   exactly the config's values — nothing reads as an instruction the compiler
 *   did not write;
 * - the block ends with a door-closing sentence;
 * - every number in the block is a number in the config;
 * - no offer is mentioned that the config does not grant, and none the config
 *   grants is missing;
 * - a config with nothing to offer yields a block that forbids offering and
 *   contains no discount, percentage, price or cheaper-tier language;
 * - each offer is delivered the way its type is delivered — a link is texted, a
 *   session is booked by a person;
 * - quiet times are only offered by a gym that told us its quiet times;
 * - an "other" offer's label appears only in the sentences that grant and limit
 *   that offer, on the call type it was configured for, and nowhere else;
 * - a cancellation block names the configured freeze's weeks and fee and the
 *   cheaper tier's name and price, and no other number, price or offer.
 *
 * The config is re-checked here as `unknown` rather than trusted as `GymFields`,
 * because a malformed config — a string where extraction should have returned a
 * number — is one of the things this exists to catch. It runs on every compile
 * (`compileVariables`), not just at onboarding: it is cheap, and it is the last
 * thing between a malformed config and a live call.
 */

export type ViolationRule =
  | "config_type"
  | "empty_block"
  | "unknown_sentence"
  | "wrong_call_type"
  | "slot_mismatch"
  | "duplicate_sentence"
  | "door_not_closed"
  | "number_not_in_config"
  | "offer_not_in_config"
  | "offer_missing"
  | "offer_granted_twice"
  | "nothing_block_does_not_forbid"
  | "nothing_block_has_offer_language"
  | "delivery_mismatch"
  | "count_mismatch"
  | "contradicts_grant"
  | "refers_to_missing_offer"
  | "quiet_times_unknown";

export interface IncentivesViolation {
  rule: ViolationRule;
  message: string;
  sentence?: string;
}

export interface IncentivesValidation {
  ok: boolean;
  callType: CallType;
  violations: IncentivesViolation[];
  /** Each sentence of the block and the template it matched, if any. */
  sentences: Array<{ text: string; templateId: string | null }>;
}

export class IncentivesValidationError extends Error {
  readonly violations: IncentivesViolation[];
  readonly callType: CallType;

  constructor(callType: CallType, violations: IncentivesViolation[]) {
    super(
      `The ${callType} incentives block failed validation: ` +
        violations.map((v) => `${v.rule} — ${v.message}`).join("; ")
    );
    this.name = "IncentivesValidationError";
    this.violations = violations;
    this.callType = callType;
  }
}

// --- The config, re-checked ----------------------------------------------------

interface CheckedConfig {
  discount: number | null;
  perk: string | null;
  winback: string | null;
  tierName: string | null;
  tierPrice: number | null;
  /** Both or neither, like the tier. A fee of 0 is a free freeze. */
  freezeWeeks: number | null;
  freezeFee: number | null;
  quietHoursKnown: boolean;
  /** An "other" offer's label and delivery, per call type — set only when that choice is "other" and both are valid. */
  other: Record<"reengagement" | "winback", { label: string; delivery: "link" | "booking" } | null>;
  /** Every label the config holds, valid or not, so a label can be looked for where it doesn't belong. */
  labels: string[];
}

function checkConfig(config: unknown, violations: IncentivesViolation[]): CheckedConfig {
  const raw = (typeof config === "object" && config !== null ? config : {}) as Record<string, unknown>;
  const bad = (message: string) => violations.push({ rule: "config_type", message });

  let discount: number | null = null;
  const d = raw.renewal_discount_percent;
  if (d !== null && d !== undefined) {
    if (typeof d !== "number" || !Number.isInteger(d)) {
      bad(`renewal_discount_percent must be a whole number or null, got ${JSON.stringify(d)}`);
    } else if (d < RENEWAL_DISCOUNT_MIN || d > RENEWAL_DISCOUNT_MAX) {
      bad(`renewal_discount_percent must be ${RENEWAL_DISCOUNT_MIN}–${RENEWAL_DISCOUNT_MAX}, got ${d}`);
    } else {
      discount = d;
    }
  }

  let perk: string | null = null;
  const p = raw.reengagement_perk;
  if (p !== null && p !== undefined) {
    if (typeof p !== "string" || !(REENGAGEMENT_PERKS as readonly string[]).includes(p)) {
      bad(`reengagement_perk must be one of ${REENGAGEMENT_PERKS.join(", ")} or null, got ${JSON.stringify(p)}`);
    } else {
      perk = p;
    }
  }

  let winback: string | null = null;
  const w = raw.winback_offer;
  if (w !== null && w !== undefined) {
    if (typeof w !== "string" || !(WINBACK_OFFERS as readonly string[]).includes(w)) {
      bad(`winback_offer must be one of ${WINBACK_OFFERS.join(", ")} or null, got ${JSON.stringify(w)}`);
    } else {
      winback = w;
    }
  }

  let tierName: string | null = null;
  const n = raw.cheaper_tier_name;
  if (n !== null && n !== undefined) {
    if (typeof n !== "string" || n.length === 0 || n.length > 40 || n !== normaliseText(n)) {
      bad(`cheaper_tier_name must be a short, normalised name or null, got ${JSON.stringify(n)}`);
    } else {
      const problem = checkText(n, "tier_name");
      if (problem) bad(`cheaper_tier_name is not a safe name: ${problem.message}`);
      else tierName = n;
    }
  }

  let tierPrice: number | null = null;
  const price = raw.cheaper_tier_price;
  if (price !== null && price !== undefined) {
    if (typeof price !== "number" || !Number.isFinite(price)) {
      bad(`cheaper_tier_price must be a number or null, got ${JSON.stringify(price)}`);
    } else if (price <= 0 || price > TIER_PRICE_MAX || !hasAtMostTwoDecimals(price)) {
      bad(`cheaper_tier_price must be over $0, at most $${TIER_PRICE_MAX}, with at most two decimals, got ${price}`);
    } else {
      tierPrice = price;
    }
  }

  const nameGiven = n !== null && n !== undefined;
  const priceGiven = price !== null && price !== undefined;
  if (nameGiven !== priceGiven) {
    bad("cheaper_tier_name and cheaper_tier_price must be set together or both left blank");
  }

  let freezeWeeks: number | null = null;
  const weeks = raw.freeze_max_weeks;
  if (weeks !== null && weeks !== undefined) {
    if (typeof weeks !== "number" || !Number.isInteger(weeks)) {
      bad(`freeze_max_weeks must be a whole number or null, got ${JSON.stringify(weeks)}`);
    } else if (weeks < FREEZE_WEEKS_MIN || weeks > FREEZE_WEEKS_MAX) {
      bad(`freeze_max_weeks must be ${FREEZE_WEEKS_MIN}–${FREEZE_WEEKS_MAX}, got ${weeks}`);
    } else {
      freezeWeeks = weeks;
    }
  }
  let freezeFee: number | null = null;
  const fee = raw.freeze_weekly_fee;
  if (fee !== null && fee !== undefined) {
    if (typeof fee !== "number" || !Number.isFinite(fee)) {
      bad(`freeze_weekly_fee must be a number or null, got ${JSON.stringify(fee)}`);
    } else if (fee < 0 || fee > FREEZE_FEE_MAX || !hasAtMostTwoDecimals(fee)) {
      bad(`freeze_weekly_fee must be $0 to $${FREEZE_FEE_MAX} with at most two decimals, got ${fee}`);
    } else {
      freezeFee = fee;
    }
  }
  const weeksGiven = weeks !== null && weeks !== undefined;
  const feeGiven = fee !== null && fee !== undefined;
  if (weeksGiven !== feeGiven) {
    bad("freeze_max_weeks and freeze_weekly_fee must be set together or both left blank");
  }

  const q = raw.quiet_hours;
  if (q !== null && q !== undefined && typeof q !== "string") {
    bad(`quiet_hours must be text or null, got ${JSON.stringify(q)}`);
  }

  const labels: string[] = [];
  const other = { reengagement: null, winback: null } as CheckedConfig["other"];
  for (const [slot, choice] of [
    ["reengagement", perk],
    ["winback", winback],
  ] as const) {
    const labelRaw = raw[`${slot}_other_label`];
    const deliveryRaw = raw[`${slot}_other_delivery`];
    const labelGiven = labelRaw !== null && labelRaw !== undefined;
    const deliveryGiven = deliveryRaw !== null && deliveryRaw !== undefined;
    if (typeof labelRaw === "string" && labelRaw.length > 0) labels.push(labelRaw);
    let label: string | null = null;
    if (labelGiven) {
      if (typeof labelRaw !== "string" || labelRaw.length === 0 || labelRaw.length > OTHER_OFFER_LABEL_MAX || labelRaw !== normaliseText(labelRaw)) {
        bad(`${slot}_other_label must be a short, normalised name or null, got ${JSON.stringify(labelRaw)}`);
      } else {
        const problem = checkText(labelRaw, "offer_label");
        if (problem) bad(`${slot}_other_label is not a safe name: ${problem.message}`);
        else label = labelRaw;
      }
    }
    let delivery: "link" | "booking" | null = null;
    if (deliveryGiven) {
      if (typeof deliveryRaw !== "string" || !(OTHER_OFFER_DELIVERIES as readonly string[]).includes(deliveryRaw)) {
        bad(`${slot}_other_delivery must be link, booking or null, got ${JSON.stringify(deliveryRaw)}`);
      } else {
        delivery = deliveryRaw as "link" | "booking";
      }
    }
    if (choice === "other") {
      if (!labelGiven || !deliveryGiven) bad(`an "other" ${slot} offer needs both ${slot}_other_label and ${slot}_other_delivery`);
      if (label !== null && delivery !== null) other[slot] = { label, delivery };
    } else if (labelGiven || deliveryGiven) {
      bad(`${slot}_other_label and ${slot}_other_delivery are set, but the ${slot} offer isn't "other"`);
    }
  }

  return {
    discount,
    perk,
    winback,
    // A half-set tier is no tier at all, and a half-set freeze is no freeze.
    tierName: tierName !== null && tierPrice !== null ? tierName : null,
    tierPrice: tierName !== null && tierPrice !== null ? tierPrice : null,
    freezeWeeks: freezeWeeks !== null && freezeFee !== null ? freezeWeeks : null,
    freezeFee: freezeWeeks !== null && freezeFee !== null ? freezeFee : null,
    quietHoursKnown: typeof q === "string" && q.trim().length > 0,
    other,
    labels,
  };
}

/** The offers this config grants on this call type — derived here, not taken from the compiler. */
function expectedGrants(config: CheckedConfig, callType: CallType): Set<OfferKind> {
  const out = new Set<OfferKind>();
  if (callType === "renewal") {
    if (config.discount !== null) out.add("renewal_discount");
  } else if (callType === "reengagement") {
    if (config.perk === "guest_pass") out.add("guest_pass");
    if (config.perk === "free_session") out.add("free_session");
    if (config.other.reengagement) out.add("other");
  } else if (callType === "cancellation") {
    // Exactly the two things a member who has asked to cancel may be offered.
    // Neither the reengagement perk nor the winback offer belongs here.
    if (config.freezeWeeks !== null) out.add("freeze");
    if (config.tierName !== null) out.add("cheaper_tier");
  } else {
    if (config.winback === "free_pt_session") out.add("free_pt_session");
    if (config.winback === "guest_pass") out.add("guest_pass");
    if (config.other.winback) out.add("other");
    if (config.tierName !== null) out.add("cheaper_tier");
  }
  return out;
}

const DELIVERY_FOR: Record<Exclude<OfferKind, "other">, "link" | "booking" | null> = {
  renewal_discount: "link",
  guest_pass: "link",
  free_session: "booking",
  free_pt_session: "booking",
  cheaper_tier: null,
  // A freeze is arranged by a person, never texted.
  freeze: "booking",
};

/** An "other" offer is delivered the way the gym said; every other offer the way its type is. */
function deliveryFor(offer: OfferKind, config: CheckedConfig, callType: CallType): "link" | "booking" | null {
  if (offer !== "other") return DELIVERY_FOR[offer];
  return callType === "renewal" || callType === "cancellation" ? null : (config.other[callType]?.delivery ?? null);
}

// --- Sentences ---------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateRegExp(template: SentenceTemplate): { re: RegExp; slots: Slot[] } {
  const slots: Slot[] = [];
  let source = "";
  let last = 0;
  for (const match of template.text.matchAll(SLOT_PATTERN)) {
    source += escapeRegExp(template.text.slice(last, match.index));
    source += "(.+?)";
    slots.push(match[1] as Slot);
    last = (match.index ?? 0) + match[0].length;
  }
  source += escapeRegExp(template.text.slice(last));
  return { re: new RegExp(`^${source}$`), slots };
}

const COMPILED_TEMPLATES = SENTENCES.map((template) => ({ template, ...templateRegExp(template) }));

function splitSentences(block: string): string[] {
  return block
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The template with this config's values in its slots, or null if a slot has no value. */
function fillExpected(template: SentenceTemplate, slots: Record<Slot, string | null>): string | null {
  let missing = false;
  const text = template.text.replace(SLOT_PATTERN, (_, slot: Slot) => {
    const value = slots[slot];
    if (value === null) missing = true;
    return value ?? "";
  });
  return missing ? null : text;
}

function expectedSlotValues(config: CheckedConfig): Record<Slot, string | null> {
  return {
    discount_percent: config.discount !== null ? String(config.discount) : null,
    tier_name: config.tierName,
    tier_price: config.tierPrice !== null ? formatMoney(config.tierPrice) : null,
    reengagement_label: config.other.reengagement?.label ?? null,
    winback_label: config.other.winback?.label ?? null,
    freeze_weeks: config.freezeWeeks !== null ? formatWeeks(config.freezeWeeks) : null,
    // A free freeze's sentence has no fee slot, so there is no value for one.
    freeze_fee: config.freezeFee !== null && config.freezeFee > 0 ? formatMoney(config.freezeFee) : null,
  };
}

// Offer vocabulary, for a scan that does not rely on template metadata. Roles
// that deny or forbid ("no discount exists", "do not mention discounts") are
// excluded, because a regex cannot see polarity and those roles exist to
// carry exactly these words in the negative.
const OFFER_WORDS: Array<[OfferKind, RegExp]> = [
  ["renewal_discount", /%|\bdiscount|\bper ?cent\b|\bhalf\b|\boff\b(?![- ]?peak)|\brenew/i],
  ["guest_pass", /\bguest pass/i],
  ["free_session", /\bfree session\b/i],
  ["free_pt_session", /\bfree PT session\b|\bpersonal training\b/i],
  // "$39 a month" is a tier's price; "$5 a week" is a freeze's fee. Every
  // dollar amount is still checked against the config below, whichever it is.
  ["cheaper_tier", /\bcheaper\b|\boff-?peak\b|\$\s?\d[\d.]* a month\b|\bconcession\b|\bstudent (rate|membership)\b/i],
  ["freeze", /\bfreez\w*|\bfroze\w*|\bpaus\w*|\bon hold\b|\bsuspen\w*/i],
];

const NEGATIVE_ROLES = new Set(["deny", "close", "handling"]);

// --- The validator ------------------------------------------------------------------

export function validateIncentives(block: string, config: unknown, callType: CallType): IncentivesValidation {
  const violations: IncentivesViolation[] = [];
  const checked = checkConfig(config, violations);
  const slots = expectedSlotValues(checked);
  const expected = expectedGrants(checked, callType);

  const texts = typeof block === "string" ? splitSentences(block) : [];
  if (texts.length === 0) {
    violations.push({ rule: "empty_block", message: "The incentives block is empty — even a gym with nothing needs the block that says so." });
    return { ok: false, callType, violations, sentences: [] };
  }

  const matched: Array<{ text: string; template: SentenceTemplate | null }> = [];
  for (const text of texts) {
    let found: SentenceTemplate | null = null;
    for (const { template, re, slots: templateSlots } of COMPILED_TEMPLATES) {
      if (template.callType !== callType) continue;
      // Exact first: the template filled with this config's own values. Only a
      // sentence that is not that is parsed apart to say which slot is wrong,
      // so a tier name containing " at " can't confuse the check.
      const filled = fillExpected(template, slots);
      if (filled !== null && filled === text) {
        found = template;
        break;
      }
      const m = re.exec(text);
      if (!m) continue;
      const mismatched = templateSlots
        .map((slot, i) => ({ slot, got: m[i + 1], want: slots[slot] }))
        .filter((s) => s.got !== s.want);
      if (mismatched.length === 0) {
        found = template;
        break;
      }
      for (const s of mismatched) {
        violations.push({
          rule: "slot_mismatch",
          sentence: text,
          message:
            s.want === null
              ? `"${s.got}" fills {${s.slot}}, but the config has no ${s.slot.replace("_", " ")}`
              : `"${s.got}" fills {${s.slot}}, but the config says "${s.want}"`,
        });
      }
      found = template;
      break;
    }

    if (!found) {
      const elsewhere = COMPILED_TEMPLATES.find(({ template, re }) => template.callType !== callType && re.test(text));
      if (elsewhere) {
        violations.push({
          rule: "wrong_call_type",
          sentence: text,
          message: `This sentence belongs to the ${elsewhere.template.callType} block, not ${callType}.`,
        });
      } else {
        violations.push({
          rule: "unknown_sentence",
          sentence: text,
          message: looksLikeInstruction(text)
            ? "Not one of the compiler's sentences, and it reads as an instruction to the agent."
            : "Not one of the compiler's sentences. Only lib/incentives.ts writes incentives text.",
        });
      }
    }
    matched.push({ text, template: found });
  }

  // Each template at most once.
  const seen = new Map<string, number>();
  for (const { template } of matched) {
    if (template) seen.set(template.id, (seen.get(template.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      violations.push({ rule: "duplicate_sentence", message: `Sentence ${id} appears ${count} times.` });
    }
  }

  // The door closes last.
  const last = matched[matched.length - 1];
  if (!last.template || last.template.role !== "close") {
    violations.push({
      rule: "door_not_closed",
      sentence: last.text,
      message: "The block does not end with a door-closing sentence, so nothing tells the agent that what it was given is all there is.",
    });
  }

  // Offers granted by the sentences themselves.
  const granted = new Map<OfferKind, number>();
  for (const { template } of matched) {
    if (template?.grants) granted.set(template.grants, (granted.get(template.grants) ?? 0) + 1);
  }
  for (const [offer, count] of granted) {
    if (!expected.has(offer)) {
      violations.push({ rule: "offer_not_in_config", message: `The block offers ${offer.replace(/_/g, " ")}, which this gym's config does not grant on a ${callType} call.` });
    }
    if (count > 1) {
      violations.push({ rule: "offer_granted_twice", message: `The block offers ${offer.replace(/_/g, " ")} ${count} times.` });
    }
  }
  for (const offer of expected) {
    if (!granted.has(offer)) {
      violations.push({ rule: "offer_missing", message: `The config grants ${offer.replace(/_/g, " ")} on a ${callType} call, but the block never offers it.` });
    }
  }

  // Offer vocabulary outside the sentences that exist to say "no".
  for (const { text, template } of matched) {
    if (template && NEGATIVE_ROLES.has(template.role)) continue;
    for (const [offer, pattern] of OFFER_WORDS) {
      if (pattern.test(text) && !expected.has(offer)) {
        violations.push({
          rule: "offer_not_in_config",
          sentence: text,
          message: `Mentions ${offer.replace(/_/g, " ")} outside a sentence that denies it, and the config does not grant it.`,
        });
      }
    }
  }

  // Numbers: every one must come from the config.
  const allowedNumbers = new Set<string>();
  if (checked.discount !== null) allowedNumbers.add(String(checked.discount));
  if (checked.tierPrice !== null) {
    allowedNumbers.add(String(checked.tierPrice));
    allowedNumbers.add(checked.tierPrice.toFixed(2));
  }
  // A freeze's terms are the only other numbers a block may carry, and only
  // the cancellation block may carry them.
  const freezeNumbers = new Set<string>();
  if (callType === "cancellation" && checked.freezeWeeks !== null && checked.freezeFee !== null) {
    freezeNumbers.add(String(checked.freezeWeeks));
    if (checked.freezeFee > 0) {
      freezeNumbers.add(String(checked.freezeFee));
      freezeNumbers.add(checked.freezeFee.toFixed(2));
    }
  }
  // Tier names cannot contain digits (lib/textSafety.ts), so no number is
  // allowed in on a name's account.
  const blockText = texts.join(" ");
  for (const number of new Set(blockText.match(/\d+(?:\.\d+)?/g) ?? [])) {
    if (!allowedNumbers.has(number) && !freezeNumbers.has(number)) {
      violations.push({ rule: "number_not_in_config", message: `The number ${number} appears in the block but nowhere in the config.` });
    }
  }
  for (const m of blockText.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    if (checked.discount === null || m[1] !== String(checked.discount) || callType !== "renewal") {
      violations.push({ rule: "number_not_in_config", message: `"${m[0]}" is not this gym's renewal discount.` });
    }
  }
  const allowedPrices = new Set<string>();
  if (checked.tierPrice !== null) allowedPrices.add(formatMoney(checked.tierPrice));
  if (callType === "cancellation" && checked.freezeFee !== null && checked.freezeFee > 0) allowedPrices.add(formatMoney(checked.freezeFee));
  for (const m of blockText.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)) {
    if (!allowedPrices.has(`$${m[1]}`)) {
      violations.push({ rule: "number_not_in_config", message: `"${m[0]}" is not this gym's cheaper-tier price or freeze fee.` });
    }
  }
  // "a week" belongs to the freeze fee alone; "a month" to the tier's price.
  for (const m of blockText.matchAll(/\$\s?(\d+(?:\.\d+)?) a (week|month)\b/g)) {
    const isFee = callType === "cancellation" && checked.freezeFee !== null && checked.freezeFee > 0 && `$${m[1]}` === formatMoney(checked.freezeFee);
    const isPrice = checked.tierPrice !== null && `$${m[1]}` === formatMoney(checked.tierPrice);
    if ((m[2] === "week" && !isFee) || (m[2] === "month" && !isPrice)) {
      violations.push({ rule: "number_not_in_config", message: `"${m[0]}" is not the ${m[2] === "week" ? "freeze fee" : "cheaper-tier price"} this gym set.` });
    }
  }

  // Nothing to offer: forbid, and carry no offer language anywhere affirmative.
  if (expected.size === 0) {
    if (!matched.some(({ template }) => template?.forbids)) {
      violations.push({
        rule: "nothing_block_does_not_forbid",
        message: "This gym has nothing to offer on this call type, and the block never forbids offering.",
      });
    }
    if (/\d|%|\$/.test(blockText)) {
      violations.push({
        rule: "nothing_block_has_offer_language",
        message: "A block for a gym with nothing to offer contains a number, a percentage or a price.",
      });
    }
    for (const { text, template } of matched) {
      if (template && (template.role === "deny" || template.forbids)) continue;
      if (/\bdiscount|\bcheaper\b|\boff-?peak\b|\bguest pass|\bfree (PT )?session\b|\bfreez\w*|\bpaus\w*/i.test(text)) {
        violations.push({
          rule: "nothing_block_has_offer_language",
          sentence: text,
          message: "Offer language outside the sentences that say there is nothing.",
        });
      }
    }
    if (checked.tierName && blockText.includes(checked.tierName)) {
      violations.push({
        rule: "nothing_block_has_offer_language",
        message: `The cheaper tier "${checked.tierName}" is named in a block with nothing to offer.`,
      });
    }
  }

  // Delivery follows the offer type.
  const required = new Set([...granted.keys()].map((o) => deliveryFor(o, checked, callType)).filter((d): d is "link" | "booking" => d !== null));
  const delivered = matched.map(({ template }) => template?.delivery).filter((d): d is "link" | "booking" => Boolean(d));
  for (const d of delivered) {
    if (!required.has(d)) {
      violations.push({
        rule: "delivery_mismatch",
        message:
          d === "link"
            ? "The block says to text a link, but nothing it offers is delivered by link."
            : "The block says someone will call to book, but nothing it offers needs booking.",
      });
    }
  }
  for (const d of required) {
    if (!delivered.includes(d)) {
      violations.push({
        rule: "delivery_mismatch",
        message:
          d === "link"
            ? "An offer delivered by link has no instruction to text it."
            : "An offer that needs booking has no instruction that someone will call to arrange it.",
      });
    }
  }

  // A block can't grant something and then say there is none of it, or refer
  // back to an offer ("that guest pass", "lead with it") it never made. Checked
  // against both what the block grants and what the config grants, so a denial
  // is caught even when the grant it contradicts was also left out.
  const offered = new Set<OfferKind>([...granted.keys(), ...expected]);
  for (const { text, template } of matched) {
    if (!template) continue;
    const excluded = template.excludes === "all" ? [...offered] : (template.excludes ?? []).filter((o) => offered.has(o));
    if (excluded.length > 0) {
      violations.push({
        rule: "contradicts_grant",
        sentence: text,
        message: `This sentence says there is no ${excluded.map((o) => o.replace(/_/g, " ")).join(" or ")}, but it is on offer.`,
      });
    }
    const needs = template.needs;
    if (needs === "any" && granted.size === 0) {
      violations.push({
        rule: "refers_to_missing_offer",
        sentence: text,
        message: "This sentence refers back to an offer, but the block doesn't make one.",
      });
    } else if (needs !== undefined && needs !== "any" && !granted.has(needs)) {
      violations.push({
        rule: "refers_to_missing_offer",
        sentence: text,
        message: `This sentence refers back to a ${needs.replace(/_/g, " ")}, but the block doesn't offer one.`,
      });
    }
  }

  // "Those two things", "the only thing": counts agree with what was granted.
  const grantCount = [...granted.values()].reduce((a, b) => a + b, 0);
  for (const { text, template } of matched) {
    if (template?.counts !== undefined && template.counts !== grantCount) {
      violations.push({
        rule: "count_mismatch",
        sentence: text,
        message: `This sentence counts ${template.counts} offer${template.counts === 1 ? "" : "s"}, but the block grants ${grantCount}.`,
      });
    }
  }

  // An "other" offer's label: in this block only if this call type grants that
  // offer, and then only inside the sentences written around that label. It
  // can't turn up anywhere the compiler didn't put it — on another call type's
  // block, or in a sentence whose own words don't carry the slot.
  const ownOther = callType === "renewal" || callType === "cancellation" ? null : checked.other[callType];
  if (ownOther && expected.has("other") && !blockText.toLowerCase().includes(ownOther.label.toLowerCase())) {
    violations.push({ rule: "offer_missing", message: `The config's "other" offer is "${ownOther.label}", but the block never names it.` });
  }
  for (const label of new Set(checked.labels)) {
    const phrase = new RegExp(`(^|[^\\p{L}])${escapeRegExp(label)}([^\\p{L}]|$)`, "iu");
    for (const { text, template } of matched) {
      if (!phrase.test(text)) continue;
      const slotHere = template !== null && ownOther !== null && template.text.includes(`{${callType}_label}`);
      const legitimate = slotHere && ownOther !== null && ownOther.label === label && expected.has("other");
      const compilerWords = template !== null && phrase.test(template.text);
      if (!legitimate && !compilerWords) {
        violations.push({
          rule: "offer_not_in_config",
          sentence: text,
          message: `Names "${label}", which this gym's config doesn't offer in this sentence on a ${callType} call.`,
        });
      }
    }
  }

  // Quiet times only from a gym that gave them.
  if (!checked.quietHoursKnown) {
    for (const { text } of matched) {
      if (/\bquiet\b/i.test(text)) {
        violations.push({
          rule: "quiet_times_unknown",
          sentence: text,
          message: "Offers the quiet times, but this gym never said when it is quiet.",
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    callType,
    violations,
    sentences: matched.map(({ text, template }) => ({ text, templateId: template?.id ?? null })),
  };
}

/** Throws `IncentivesValidationError` unless the block passes. */
export function assertValidIncentives(block: string, config: unknown, callType: CallType): void {
  const result = validateIncentives(block, config, callType);
  if (!result.ok) throw new IncentivesValidationError(callType, result.violations);
}
