import type { CallType } from "@/lib/callType";
import { compileGymFacts } from "@/lib/compileVariables";
import {
  GYM_FIELD_KEYS,
  hasCheaperTier,
  parseGymField,
  parseGymFields,
  type FieldErrors,
  type GymFieldKey,
  type GymFields,
  type ReengagementPerk,
  type WinbackOffer,
} from "@/lib/gymConfig";
import { CALL_TYPES, compileIncentives, sentenceTemplate, type OfferKind } from "@/lib/incentives";
import { validateIncentives, type IncentivesViolation } from "@/lib/validateIncentives";

/**
 * The questionnaire's working state, and what it compiles to.
 *
 * A form holds text: what someone has typed so far, including half-typed
 * numbers. This module is the one bridge between that and the typed config the
 * rest of the system reads. The rule it keeps is the onboarding rule: an empty
 * input is null, never a value, and a value that doesn't parse is an error to
 * show beside its field, never something to coerce.
 *
 * The preview is compiled from the draft with the same compiler and validator a
 * live call uses, so what the panel shows is exactly what Charlie would be told.
 */

export interface Draft {
  gym_name: string;
  opening_hours: string;
  quiet_hours: string;
  other_locations: string[];
  has_online: boolean | null;
  books_classes: boolean | null;
  renewal_discount_percent: string;
  reengagement_perk: ReengagementPerk | null;
  winback_offer: WinbackOffer | null;
  cheaper_tier_name: string;
  cheaper_tier_price: string;
}

export function emptyDraft(): Draft {
  return {
    gym_name: "",
    opening_hours: "",
    quiet_hours: "",
    other_locations: [],
    has_online: null,
    books_classes: null,
    renewal_discount_percent: "",
    reengagement_perk: null,
    winback_offer: null,
    cheaper_tier_name: "",
    cheaper_tier_price: "",
  };
}

/**
 * "20" → 20; "" → null; anything else stays text, so the parser can say what's
 * wrong with it. A trailing "." is a number still being typed ("39." on the way
 * to "39.50"), so it reads as the number so far rather than flashing an error.
 */
function numberInput(text: string): unknown {
  const trimmed = text.trim().replace(/^\$\s*/, "").replace(/\s*%$/, "").replace(/\.$/, "");
  if (trimmed === "") return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/** The draft as untrusted input for `parseGymFields` — what the save route receives. */
export function draftToInput(draft: Draft): Record<GymFieldKey, unknown> {
  return {
    gym_name: draft.gym_name,
    opening_hours: draft.opening_hours,
    quiet_hours: draft.quiet_hours,
    other_locations: draft.other_locations.length > 0 ? draft.other_locations : null,
    has_online: draft.has_online,
    books_classes: draft.books_classes,
    renewal_discount_percent: numberInput(draft.renewal_discount_percent),
    reengagement_perk: draft.reengagement_perk,
    winback_offer: draft.winback_offer,
    cheaper_tier_name: draft.cheaper_tier_name,
    cheaper_tier_price: numberInput(draft.cheaper_tier_price),
  };
}

function priceText(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** One typed value, as the text its input shows. */
export function valueToDraft<K extends GymFieldKey>(key: K, value: unknown): Draft[K] {
  switch (key) {
    case "other_locations":
      return (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []) as Draft[K];
    case "has_online":
    case "books_classes":
      return (typeof value === "boolean" ? value : null) as Draft[K];
    case "reengagement_perk":
    case "winback_offer":
      return (typeof value === "string" ? value : null) as Draft[K];
    case "renewal_discount_percent":
      return (typeof value === "number" ? String(value) : "") as Draft[K];
    case "cheaper_tier_price":
      return (typeof value === "number" ? priceText(value) : "") as Draft[K];
    default:
      return (typeof value === "string" ? value : "") as Draft[K];
  }
}

/** A draft prefilled with whatever typed values an extraction review allowed through. */
export function draftFromValues(values: Partial<GymFields>): Draft {
  const draft = emptyDraft();
  for (const key of GYM_FIELD_KEYS) {
    if (values[key] !== undefined && values[key] !== null) {
      (draft as unknown as Record<string, unknown>)[key] = valueToDraft(key, values[key]);
    }
  }
  return draft;
}

/** Is this field empty in the form? Blank is an answer, and the form says what it means. */
export function isDraftBlank(draft: Draft, key: GymFieldKey): boolean {
  const value = draft[key];
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  return value === null;
}

export function validateDraft(draft: Draft): { ok: true; fields: GymFields } | { ok: false; errors: FieldErrors } {
  const parsed = parseGymFields(draftToInput(draft));
  return parsed.ok ? { ok: true, fields: parsed.value } : { ok: false, errors: parsed.errors };
}

// --- The preview ---------------------------------------------------------------------

export interface PreviewBlock {
  callType: CallType;
  text: string;
  sentences: Array<{ id: string; text: string; role: string }>;
  offers: OfferKind[];
  ok: boolean;
  violations: IncentivesViolation[];
}

export interface Preview {
  /** Fields left out of the preview because their current value doesn't parse. */
  excluded: GymFieldKey[];
  /** A cheaper tier with only one half filled in, which compiles as no tier. */
  tierIncomplete: boolean;
  blocks: PreviewBlock[];
  facts: ReturnType<typeof compileGymFacts>;
  /** Whether the name is set; the facts use a stand-in until it is. */
  named: boolean;
}

/**
 * Compiles the draft as it stands. A field whose value doesn't parse yet is
 * previewed as blank and listed in `excluded`, so the panel never shows a block
 * built from a value the save would refuse.
 */
export function previewDraft(draft: Draft): Preview {
  const input = draftToInput(draft);
  const fields = {} as Record<GymFieldKey, unknown>;
  const excluded: GymFieldKey[] = [];
  for (const key of GYM_FIELD_KEYS) {
    const parsed = parseGymField(key, input[key]);
    if (parsed.error) excluded.push(key);
    fields[key] = parsed.error ? null : parsed.value;
  }
  const named = typeof fields.gym_name === "string" && fields.gym_name.length > 0;
  const gym = { ...(fields as unknown as GymFields), gym_name: named ? (fields.gym_name as string) : "this gym" };
  const tierIncomplete = (gym.cheaper_tier_name === null) !== (gym.cheaper_tier_price === null);
  const compileAs: GymFields = hasCheaperTier(gym) ? gym : { ...gym, cheaper_tier_name: null, cheaper_tier_price: null };

  const blocks = CALL_TYPES.map((callType) => {
    const compiled = compileIncentives(compileAs, callType);
    const result = validateIncentives(compiled.text, compileAs, callType);
    const sentences = compiled.sentences.map((s) => ({ ...s, role: sentenceTemplate(s.id).role }));
    const offers = compiled.sentences
      .map((s) => sentenceTemplate(s.id).grants)
      .filter((g): g is OfferKind => Boolean(g));
    return { callType, text: compiled.text, sentences, offers, ok: result.ok, violations: result.violations };
  });

  return { excluded, tierIncomplete, blocks, facts: compileGymFacts(compileAs), named };
}

export const OFFER_LABEL: Record<OfferKind, string> = {
  renewal_discount: "renewal discount",
  guest_pass: "guest pass",
  free_session: "free session",
  free_pt_session: "free PT session",
  cheaper_tier: "cheaper membership",
};
