import type { CallType } from "@/lib/callType";
import {
  RENEWAL_DISCOUNT_MAX,
  RENEWAL_DISCOUNT_MIN,
  REENGAGEMENT_PERKS,
  TIER_PRICE_MAX,
  WINBACK_OFFERS,
  hasAtMostTwoDecimals,
} from "@/lib/gymConfig";
import {
  SENTENCES,
  formatMoney,
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
 * - quiet times are only offered by a gym that told us its quiet times.
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
  quietHoursKnown: boolean;
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

  const q = raw.quiet_hours;
  if (q !== null && q !== undefined && typeof q !== "string") {
    bad(`quiet_hours must be text or null, got ${JSON.stringify(q)}`);
  }

  return {
    discount,
    perk,
    winback,
    // A half-set tier is no tier at all.
    tierName: tierName !== null && tierPrice !== null ? tierName : null,
    tierPrice: tierName !== null && tierPrice !== null ? tierPrice : null,
    quietHoursKnown: typeof q === "string" && q.trim().length > 0,
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
  } else {
    if (config.winback === "free_pt_session") out.add("free_pt_session");
    if (config.winback === "guest_pass") out.add("guest_pass");
    if (config.tierName !== null) out.add("cheaper_tier");
  }
  return out;
}

const DELIVERY_FOR: Record<OfferKind, "link" | "booking" | null> = {
  renewal_discount: "link",
  guest_pass: "link",
  free_session: "booking",
  free_pt_session: "booking",
  cheaper_tier: null,
};

// --- Sentences ---------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SLOT_PATTERN = /\{(discount_percent|tier_name|tier_price)\}/g;

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
  ["cheaper_tier", /\bcheaper\b|\boff-?peak\b|\$\s?\d|\bconcession\b|\bstudent (rate|membership)\b/i],
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
  // Tier names cannot contain digits (lib/textSafety.ts), so no number is
  // allowed in on a name's account.
  const blockText = texts.join(" ");
  for (const number of new Set(blockText.match(/\d+(?:\.\d+)?/g) ?? [])) {
    if (!allowedNumbers.has(number)) {
      violations.push({ rule: "number_not_in_config", message: `The number ${number} appears in the block but nowhere in the config.` });
    }
  }
  for (const m of blockText.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    if (checked.discount === null || m[1] !== String(checked.discount) || callType !== "renewal") {
      violations.push({ rule: "number_not_in_config", message: `"${m[0]}" is not this gym's renewal discount.` });
    }
  }
  for (const m of blockText.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)) {
    if (checked.tierPrice === null || `$${m[1]}` !== formatMoney(checked.tierPrice)) {
      violations.push({ rule: "number_not_in_config", message: `"${m[0]}" is not this gym's cheaper-tier price.` });
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
      if (/\bdiscount|\bcheaper\b|\boff-?peak\b|\bguest pass|\bfree (PT )?session\b/i.test(text)) {
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
  const required = new Set([...granted.keys()].map((o) => DELIVERY_FOR[o]).filter((d): d is "link" | "booking" => d !== null));
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
