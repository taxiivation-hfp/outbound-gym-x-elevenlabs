import { checkText, normaliseText, type TextKind } from "@/lib/textSafety";

/**
 * A gym's configuration, as typed values.
 *
 * This is the whole of what a gym can tell the agent. Every field is a number,
 * a boolean, an enum or a short string, and every one except the name is
 * nullable, because null is an answer: it means the gym did not tell us. Nothing
 * here is prose the agent reads. The sentences the agent hears — the incentives
 * blocks, the "you don't have that in front of you" fallbacks — are written by
 * `lib/incentives.ts` and `lib/compileVariables.ts` from these values, and only
 * there. That is the safety model for onboarding: a document or a form can fill
 * in a value, but it can never write an instruction.
 *
 * Deliberately absent: `renewal_price`. What renewing costs is a fact about a
 * member's contract, not about the gym, and it reaches the agent from the member
 * record.
 */

export const REENGAGEMENT_PERKS = ["guest_pass", "free_session", "none"] as const;
export const WINBACK_OFFERS = ["free_pt_session", "guest_pass", "none"] as const;

export type ReengagementPerk = (typeof REENGAGEMENT_PERKS)[number];
export type WinbackOffer = (typeof WINBACK_OFFERS)[number];

export interface GymFields {
  gym_name: string;
  /** Null → Charlie says he doesn't have the opening hours. */
  opening_hours: string | null;
  /** Null → Charlie has no quiet times to suggest, and admits it if asked. */
  quiet_hours: string | null;
  /**
   * Null or empty → a single site ("none"). Empty means the gym said so. Null
   * compiles to "none" too, because the winback prompt branches on that literal
   * and anything else would tell the agent to name a nearby site it doesn't have.
   */
  other_locations: string[] | null;
  /** Null → Charlie doesn't offer online training, and admits he doesn't know if asked. */
  has_online: boolean | null;
  /** Null → treated as false: Charlie doesn't offer to book a class. */
  books_classes: boolean | null;
  /** Whole percent, 1–50. Null → no renewal save exists. */
  renewal_discount_percent: number | null;
  /** Null or "none" → nothing to lead with. */
  reengagement_perk: ReengagementPerk | null;
  /** Null or "none" → nothing to offer a lapsed member. */
  winback_offer: WinbackOffer | null;
  /** Both or neither with the price. Null → no cheaper option exists. */
  cheaper_tier_name: string | null;
  /** Dollars a month, up to two decimal places. */
  cheaper_tier_price: number | null;
}

export interface GymConfig extends GymFields {
  /** URL-safe identifier. Not something a gym fills in; derived from the name. */
  gym_id: string;
}

export type GymFieldKey = keyof GymFields;

export const GYM_FIELD_KEYS: GymFieldKey[] = [
  "gym_name",
  "opening_hours",
  "quiet_hours",
  "other_locations",
  "has_online",
  "books_classes",
  "renewal_discount_percent",
  "reengagement_perk",
  "winback_offer",
  "cheaper_tier_name",
  "cheaper_tier_price",
];

export const RENEWAL_DISCOUNT_MIN = 1;
/**
 * Above half off, a renewal "save" is more likely a typo, a misread document or
 * an injected instruction than a real policy. A gym that genuinely offers more
 * can have it set by someone with database access, deliberately.
 */
export const RENEWAL_DISCOUNT_MAX = 50;
export const TIER_PRICE_MAX = 500;
export const MAX_OTHER_LOCATIONS = 10;

const LIMITS = {
  gym_name: 80,
  fact: 120,
  location: 60,
  tier_name: 40,
} as const;

// --- Field descriptions ------------------------------------------------------

export type FieldKind = "text" | "text_list" | "boolean" | "integer" | "decimal" | "enum";

export interface FieldSpec {
  key: GymFieldKey;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Enum values, in display order. */
  options?: readonly string[];
  optionLabels?: Record<string, string>;
  /**
   * What the agent does when this is left blank, in the operator's words. Shown
   * next to the field: an empty answer is a valid answer, and the form says what
   * it means rather than letting someone guess.
   */
  whenBlank: string | null;
  /** A short example of a good value, shown as a placeholder. */
  example?: string;
  /** What counts as the document stating this, for the extraction model. */
  extraction: string;
}

export const FIELD_SPECS: FieldSpec[] = [
  {
    key: "gym_name",
    label: "Gym name",
    kind: "text",
    required: true,
    whenBlank: null,
    example: "Southbank Strength",
    extraction: "The gym's trading name, exactly as the document writes it.",
  },
  {
    key: "opening_hours",
    label: "Opening hours",
    kind: "text",
    required: false,
    whenBlank: "Charlie says he doesn't have the opening hours in front of him.",
    example: "5am to 10pm weekdays, 7am to 7pm weekends",
    extraction:
      "The gym's opening hours as a short phrase, in the document's own terms. Null if the document gives no opening hours.",
  },
  {
    key: "quiet_hours",
    label: "Quiet times",
    kind: "text",
    required: false,
    whenBlank: "Charlie has no quiet times to suggest. Asked, he says he doesn't have them in front of him.",
    example: "weekdays before 8am and after 7pm",
    extraction:
      "Times the document itself describes as quiet, least busy or a good time to avoid crowds. An off-peak membership's access window is not a statement that the gym is quiet — do not use it. Null unless quiet times are stated.",
  },
  {
    key: "other_locations",
    label: "Other locations",
    kind: "text_list",
    required: false,
    whenBlank: "Charlie treats this as your only site. Asked about other locations, he'll say there aren't any.",
    example: "Fortitude Valley",
    extraction:
      "Names of the gym's other sites or branches that the document names. An empty list only if the document explicitly says this is the only location. Null if other locations are not mentioned.",
  },
  {
    key: "has_online",
    label: "Online training",
    kind: "boolean",
    required: false,
    whenBlank: "Charlie won't offer online training. Asked, he says he doesn't have that in front of him.",
    extraction:
      "true if the document says the gym offers online, virtual or remote training. false only if it explicitly says it does not. Null otherwise.",
  },
  {
    key: "books_classes",
    label: "Charlie can book classes",
    kind: "boolean",
    required: false,
    whenBlank: "Charlie won't offer to book anyone into a class.",
    extraction:
      "true if the document says members can book into classes (a class timetable with booking). false only if it explicitly says there are no bookable classes. Null otherwise.",
  },
  {
    key: "renewal_discount_percent",
    label: "Renewal discount (%)",
    kind: "integer",
    required: false,
    whenBlank:
      "No renewal save. If price is the problem, Charlie says he'll pass it on — no discount, and no offer to ask a manager.",
    example: "20",
    extraction:
      "A percentage discount the document offers to existing members who renew, as a whole number (20 for \"20% off\"). Not a joining discount and not a discount for new members. Null unless a renewal discount is stated.",
  },
  {
    key: "reengagement_perk",
    label: "Perk for a member who's stopped coming",
    kind: "enum",
    required: false,
    options: REENGAGEMENT_PERKS,
    optionLabels: {
      guest_pass: "Guest pass (texted as a link)",
      free_session: "Free session (someone calls to book it)",
      none: "Nothing",
    },
    whenBlank: "Charlie calls with nothing to give — he checks in and offers nothing.",
    extraction:
      "What the document offers existing members that the gym could give someone who has stopped coming: \"guest_pass\" for a guest or bring-a-friend pass, \"free_session\" for a free training session, \"none\" only if the document explicitly says there is nothing. Null otherwise.",
  },
  {
    key: "winback_offer",
    label: "Offer for a lapsed member",
    kind: "enum",
    required: false,
    options: WINBACK_OFFERS,
    optionLabels: {
      free_pt_session: "Free PT session (someone calls to book it)",
      guest_pass: "Guest pass (texted as a link)",
      none: "Nothing",
    },
    whenBlank: "Charlie has no free session or guest pass for someone whose membership has ended.",
    extraction:
      "What the document offers a former member to come back: \"free_pt_session\" for a free personal-training session, \"guest_pass\" for a guest or day pass, \"none\" only if the document explicitly says there is nothing. Null otherwise.",
  },
  {
    key: "cheaper_tier_name",
    label: "Cheaper membership — name",
    kind: "text",
    required: false,
    whenBlank: "Charlie won't mention a cheaper membership.",
    example: "off-peak membership",
    extraction:
      "The name of a lower-priced membership option the document presents as cheaper (off-peak, concession, student), as the document names it. Null if none is stated.",
  },
  {
    key: "cheaper_tier_price",
    label: "Cheaper membership — $ a month",
    kind: "decimal",
    required: false,
    whenBlank: null,
    example: "39",
    extraction:
      "The monthly price in dollars of that cheaper option, as a number (39 for \"$39 a month\"). If the document only gives a weekly or fortnightly price, return null — do not convert it.",
  },
];

export function fieldSpec(key: GymFieldKey): FieldSpec {
  const spec = FIELD_SPECS.find((f) => f.key === key);
  if (!spec) throw new Error(`no field spec for ${key}`);
  return spec;
}

// --- Parsing ------------------------------------------------------------------

export type FieldErrors = Partial<Record<GymFieldKey | "gym_id" | "_form", string>>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors };

function describe(value: unknown): string {
  if (value === null) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return `text ("${value.length > 30 ? `${value.slice(0, 30)}…` : value}")`;
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** undefined, null and whitespace-only strings are all "not stated". */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** At most two decimal places, judged on the decimal the number prints as rather than its binary value. */
export function hasAtMostTwoDecimals(n: number): boolean {
  return Number(n.toFixed(2)) === n;
}

export interface FieldParse<T> {
  value: T | null;
  error?: string;
}

function parseText(
  value: unknown,
  { kind, max, label }: { kind: TextKind; max: number; label: string }
): FieldParse<string> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "string") {
    return { value: null, error: `${label} must be text, but got ${describe(value)}.` };
  }
  // What is checked is what is stored: normalised first, never after.
  const text = normaliseText(value);
  if (text.length > max) {
    return { value: null, error: `${label} is ${text.length} characters; keep it under ${max}.` };
  }
  const problem = checkText(text, kind);
  if (problem) return { value: null, error: problem.message };
  return { value: text };
}

function parseBoolean(value: unknown, label: string): FieldParse<boolean> {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "boolean") {
    return { value: null, error: `${label} must be yes, no or blank, but got ${describe(value)}.` };
  }
  return { value };
}

function parseEnum<T extends string>(value: unknown, options: readonly T[], label: string): FieldParse<T> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    return {
      value: null,
      error: `${label} must be one of ${options.join(", ")}, but got ${describe(value)}.`,
    };
  }
  return { value: value as T };
}

function parseLocations(value: unknown): FieldParse<string[]> {
  if (value === undefined || value === null) return { value: null };
  if (!Array.isArray(value)) {
    return { value: null, error: `Other locations must be a list of site names, but got ${describe(value)}.` };
  }
  if (value.length > MAX_OTHER_LOCATIONS) {
    return { value: null, error: `List at most ${MAX_OTHER_LOCATIONS} other locations.` };
  }
  const parsed: string[] = [];
  for (const entry of value) {
    if (isBlank(entry)) continue;
    const one = parseText(entry, { kind: "fact", max: LIMITS.location, label: "A location name" });
    if (one.error) return { value: null, error: one.error };
    if (one.value !== null) parsed.push(one.value);
  }
  const deduped = [...new Set(parsed)];
  // The agent reads the list as one fact, so the joined list has the same
  // length cap as every other fact.
  const joined = deduped.join(", ");
  if (joined.length > LIMITS.fact) {
    return {
      value: null,
      error: `Together the location names run to ${joined.length} characters; keep them under ${LIMITS.fact}.`,
    };
  }
  // An explicitly empty list is the gym saying "no other sites"; a list of
  // blanks from a form is the gym saying nothing.
  return { value: deduped.length > 0 ? deduped : value.length === 0 ? [] : null };
}

function parseDiscount(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: `Renewal discount must be a whole number of percent, but got ${describe(value)}.` };
  }
  if (!Number.isInteger(value)) return { value: null, error: "Renewal discount must be a whole number of percent." };
  if (value === 0) {
    return { value: null, error: "0% isn't a discount — leave it blank if there's no renewal discount." };
  }
  if (value < 0) return { value: null, error: "A renewal discount can't be negative." };
  if (value > RENEWAL_DISCOUNT_MAX) {
    return { value: null, error: `Renewal discounts above ${RENEWAL_DISCOUNT_MAX}% aren't accepted here.` };
  }
  return { value };
}

function parsePrice(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: `Cheaper membership price must be a number of dollars, but got ${describe(value)}.` };
  }
  if (value <= 0) return { value: null, error: "Cheaper membership price must be more than $0." };
  if (value > TIER_PRICE_MAX) {
    return { value: null, error: `Cheaper membership price must be under $${TIER_PRICE_MAX} a month.` };
  }
  if (!hasAtMostTwoDecimals(value)) {
    return { value: null, error: "Cheaper membership price can have at most two decimal places." };
  }
  return { value };
}

/**
 * Parses one field on its own. Used by `parseGymFields`, and by the extraction
 * sanitiser, which judges each extracted value separately. Cross-field rules —
 * a name is required, a tier needs both halves — belong to `parseGymFields`.
 */
export function parseGymField(key: GymFieldKey, value: unknown): FieldParse<GymFields[GymFieldKey]> {
  switch (key) {
    case "gym_name":
      return parseText(value, { kind: "gym_name", max: LIMITS.gym_name, label: "Gym name" });
    case "opening_hours":
      return parseText(value, { kind: "fact", max: LIMITS.fact, label: "Opening hours" });
    case "quiet_hours":
      return parseText(value, { kind: "fact", max: LIMITS.fact, label: "Quiet times" });
    case "other_locations":
      return parseLocations(value);
    case "has_online":
      return parseBoolean(value, "Online training");
    case "books_classes":
      return parseBoolean(value, "Class booking");
    case "renewal_discount_percent":
      return parseDiscount(value);
    case "reengagement_perk":
      return parseEnum(value, REENGAGEMENT_PERKS, "Reengagement perk");
    case "winback_offer":
      return parseEnum(value, WINBACK_OFFERS, "Winback offer");
    case "cheaper_tier_name":
      return parseText(value, { kind: "tier_name", max: LIMITS.tier_name, label: "Cheaper membership name" });
    case "cheaper_tier_price":
      return parsePrice(value);
  }
}

/**
 * Parses and validates a gym's fields from untrusted input: a form post, a
 * database row, an extraction result.
 *
 * Strict about types. A string where a number belongs is an error, not a value
 * to coerce — "20" might be twenty percent, or it might be the first two
 * characters of a sentence a document slipped into a numeric field, and the
 * parser is not the place to guess which. Unknown keys are errors too: there is
 * no field a caller can add that reaches a prompt.
 */
export function parseGymFields(
  input: unknown,
  { allowKeys = [] }: { allowKeys?: string[] } = {}
): ParseResult<GymFields> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { _form: `Expected a gym config object, got ${describe(input)}.` } };
  }
  const raw = input as Record<string, unknown>;
  const errors: FieldErrors = {};

  const known = new Set<string>([...GYM_FIELD_KEYS, ...allowKeys]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    errors._form =
      `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
      "A gym config has exactly the typed fields on this form — incentive wording is generated, never supplied.";
  }

  const value = {} as Record<GymFieldKey, unknown>;
  for (const key of GYM_FIELD_KEYS) {
    const parsed = parseGymField(key, Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined);
    if (parsed.error) errors[key] = parsed.error;
    value[key] = parsed.value;
  }

  if (!errors.gym_name && value.gym_name === null) {
    errors.gym_name = "Every gym needs a name — it's the first thing Charlie says.";
  }

  if (!errors.cheaper_tier_name && !errors.cheaper_tier_price) {
    if (value.cheaper_tier_name !== null && value.cheaper_tier_price === null) {
      errors.cheaper_tier_price = "A cheaper membership needs a monthly price as well as a name, or neither.";
    } else if (value.cheaper_tier_name === null && value.cheaper_tier_price !== null) {
      errors.cheaper_tier_name = "A cheaper membership needs a name as well as a price, or neither.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: value as unknown as GymFields };
}

const GYM_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A stored gym: the fields plus its id. Rejects anything a row should not hold. */
export function parseGymConfig(
  input: unknown,
  { allowKeys = [] }: { allowKeys?: string[] } = {}
): ParseResult<GymConfig> {
  const fields = parseGymFields(input, { allowKeys: ["gym_id", ...allowKeys] });
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const gymId = raw.gym_id;
  const idError =
    typeof gymId !== "string" || !GYM_ID.test(gymId)
      ? "gym_id must be lowercase letters, digits and dashes."
      : null;

  if (!fields.ok) {
    return { ok: false, errors: idError ? { ...fields.errors, gym_id: idError } : fields.errors };
  }
  if (idError) return { ok: false, errors: { gym_id: idError } };
  return { ok: true, value: { gym_id: gymId as string, ...fields.value } };
}

/** "Southbank Strength & Conditioning" → "southbank-strength-conditioning". */
export function slugifyGymName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "gym";
}

/** Every field blank except the name: the questionnaire's starting point. */
export function emptyGymFields(): GymFields {
  return {
    gym_name: "",
    opening_hours: null,
    quiet_hours: null,
    other_locations: null,
    has_online: null,
    books_classes: null,
    renewal_discount_percent: null,
    reengagement_perk: null,
    winback_offer: null,
    cheaper_tier_name: null,
    cheaper_tier_price: null,
  };
}

/** A cheaper tier counts only when both halves are present. */
export function hasCheaperTier(gym: GymFields): boolean {
  return gym.cheaper_tier_name !== null && gym.cheaper_tier_price !== null;
}
