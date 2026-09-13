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

/**
 * `other` is the long tail: a protein shake, a towel, a smoothie. The gym
 * supplies a short noun (`*_other_label`, held to `textSafety`'s "offer_label"
 * rules) and how it's delivered; the compiler still writes every sentence.
 */
export const REENGAGEMENT_PERKS = ["guest_pass", "free_session", "other", "none"] as const;
export const WINBACK_OFFERS = ["free_pt_session", "guest_pass", "other", "none"] as const;
export const OTHER_OFFER_DELIVERIES = ["link", "booking"] as const;

export type ReengagementPerk = (typeof REENGAGEMENT_PERKS)[number];
export type WinbackOffer = (typeof WINBACK_OFFERS)[number];
export type OtherOfferDelivery = (typeof OTHER_OFFER_DELIVERIES)[number];

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
  /**
   * A membership freeze: the longest pause the gym allows, in weeks (1–26).
   * Both or neither with the fee. Null → the gym offers no freeze, which is a
   * different thing from a free one. Only the cancellation call can offer it.
   */
  freeze_max_weeks: number | null;
  /** Dollars a week while frozen, 0–50. Zero is a free freeze and is valid. */
  freeze_weekly_fee: number | null;
  /** Set exactly when `reengagement_perk` is "other": what the offer is, as a short noun ("protein shake"). */
  reengagement_other_label: string | null;
  /** Set exactly when `reengagement_perk` is "other": texted as a link, or booked by a person. */
  reengagement_other_delivery: OtherOfferDelivery | null;
  /** Set exactly when `winback_offer` is "other". */
  winback_other_label: string | null;
  /** Set exactly when `winback_offer` is "other". */
  winback_other_delivery: OtherOfferDelivery | null;
}

export interface GymConfig extends GymFields {
  /** URL-safe identifier. Not something a gym fills in; derived from the name. */
  gym_id: string;
  /**
   * How often each offer may be made to the same member. Absent when the gym
   * set no schedule — every offer then behaves as it always has. Never reaches a
   * prompt: it decides, in `lib/eligibility.ts`, whether an offer is compiled
   * into the block at all.
   */
  offer_schedule?: OfferSchedule;
}

// --- Offer schedule --------------------------------------------------------------

/**
 * The offers a gym can schedule. One per offer *type*, not per call: a guest
 * pass given on a reengagement call spends the guest pass on a winback call too.
 */
export const SCHEDULABLE_OFFERS = [
  "renewal_discount",
  "guest_pass",
  "free_session",
  "free_pt_session",
  "cheaper_tier",
  "reengagement_other",
  "winback_other",
] as const;
export type SchedulableOffer = (typeof SCHEDULABLE_OFFERS)[number];

/**
 * "Every [period], allow the agent to offer [offer]". `never` switches the offer
 * off without removing it from the gym's config. There is no lifetime cap: the
 * period is the whole rule.
 */
export const OFFER_PERIODS = ["monthly", "quarterly", "twice_yearly", "yearly", "never"] as const;
export type OfferPeriod = (typeof OFFER_PERIODS)[number];

export const OFFER_PERIOD_DAYS: Record<Exclude<OfferPeriod, "never">, number> = {
  monthly: 30,
  quarterly: 91,
  twice_yearly: 182,
  yearly: 365,
};

export const OFFER_PERIOD_LABEL: Record<OfferPeriod, string> = {
  monthly: "month",
  quarterly: "quarter",
  twice_yearly: "six months",
  yearly: "year",
  never: "never",
};

export const SCHEDULABLE_OFFER_LABEL: Record<SchedulableOffer, string> = {
  renewal_discount: "renewal discount",
  guest_pass: "guest pass",
  free_session: "free session",
  free_pt_session: "free PT session",
  cheaper_tier: "cheaper membership",
  reengagement_other: "other perk",
  winback_other: "other winback offer",
};

/** The schedule's name for an offer, with the gym's own label for an "other". */
export function scheduledOfferLabel(offer: SchedulableOffer, gym: GymFields | null): string {
  if (offer === "reengagement_other" && gym?.reengagement_other_label) return gym.reengagement_other_label;
  if (offer === "winback_other" && gym?.winback_other_label) return gym.winback_other_label;
  return SCHEDULABLE_OFFER_LABEL[offer];
}

export type OfferSchedule = Partial<Record<SchedulableOffer, OfferPeriod>>;

/**
 * The offers this gym's own config grants on some call. The schedule's offer
 * dropdown is built from this, and a schedule naming anything else is refused:
 * a gym cannot schedule something it never configured.
 */
export function configuredOffers(gym: GymFields): SchedulableOffer[] {
  const out: SchedulableOffer[] = [];
  if (gym.renewal_discount_percent !== null) out.push("renewal_discount");
  if (gym.reengagement_perk === "guest_pass" || gym.winback_offer === "guest_pass") out.push("guest_pass");
  if (gym.reengagement_perk === "free_session") out.push("free_session");
  if (gym.winback_offer === "free_pt_session") out.push("free_pt_session");
  if (hasCheaperTier(gym)) out.push("cheaper_tier");
  if (gym.reengagement_perk === "other") out.push("reengagement_other");
  if (gym.winback_offer === "other") out.push("winback_other");
  return out;
}

/**
 * Parses a schedule against the fields it schedules. Null, undefined and an
 * empty object are all "no schedule". Refused, with the reason: anything but an
 * object, an unknown offer, an offer this gym doesn't configure, or a period
 * that isn't one of the fixed choices.
 */
export function parseOfferSchedule(value: unknown, gym: GymFields): FieldParse<OfferSchedule> {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { value: null, error: "The offer schedule needs to be a set of offers and how often each may be made." };
  }
  const configured = new Set(configuredOffers(gym));
  const out: OfferSchedule = {};
  for (const [offer, period] of Object.entries(value as Record<string, unknown>)) {
    if (!(SCHEDULABLE_OFFERS as readonly string[]).includes(offer)) {
      return { value: null, error: `"${offer}" isn't an offer that can be scheduled.` };
    }
    const key = offer as SchedulableOffer;
    if (!configured.has(key)) {
      return { value: null, error: `This gym doesn't offer a ${SCHEDULABLE_OFFER_LABEL[key]}, so there's nothing to schedule. Remove it from the schedule.` };
    }
    if (typeof period !== "string" || !(OFFER_PERIODS as readonly string[]).includes(period)) {
      return { value: null, error: `Choose how often the ${SCHEDULABLE_OFFER_LABEL[key]} may be offered: monthly, quarterly, twice yearly, yearly or never.` };
    }
    out[key] = period as OfferPeriod;
  }
  return { value: Object.keys(out).length > 0 ? out : null };
}

export type GymFieldKey = keyof GymFields;

/**
 * The fields a document can fill: everything but an "other" offer's name and
 * delivery, which a person types, and the freeze terms, which are set on the
 * form (a document's suspension clause is read by a person, not the extractor).
 */
export type ExtractableFieldKey = Exclude<
  GymFieldKey,
  | "reengagement_other_label"
  | "reengagement_other_delivery"
  | "winback_other_label"
  | "winback_other_delivery"
  | "freeze_max_weeks"
  | "freeze_weekly_fee"
>;

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
  "freeze_max_weeks",
  "freeze_weekly_fee",
  "reengagement_other_label",
  "reengagement_other_delivery",
  "winback_other_label",
  "winback_other_delivery",
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
/** Half a year is the longest pause a membership agreement plausibly allows. */
export const FREEZE_WEEKS_MIN = 1;
export const FREEZE_WEEKS_MAX = 26;
/** A weekly holding fee. Above this it is a membership, not a freeze. */
export const FREEZE_FEE_MAX = 50;

const LIMITS = {
  gym_name: 80,
  fact: 120,
  location: 60,
  tier_name: 40,
  offer_label: 40,
} as const;

export const OTHER_OFFER_LABEL_MAX = LIMITS.offer_label;

// --- Field descriptions ------------------------------------------------------

export type FieldKind = "text" | "text_list" | "boolean" | "integer" | "decimal" | "enum";

export interface FieldSpec {
  key: GymFieldKey;
  label: string;
  /** The label as it reads inside a sentence or a list: "class booking". */
  shortLabel: string;
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
  /**
   * A short example of a good value, shown as a placeholder. Never a value any
   * configured gym actually uses, and never for numbers, where a grey "20" reads
   * as a discount already set.
   */
  example?: string;
  /** What counts as the document stating this, for the extraction model. */
  extraction: string;
  /**
   * False for the fields a document never fills: an "other" offer's label and
   * delivery are named by a person on the form. Omitted means extracted.
   */
  extract?: false;
  /** Enum values the extraction model may return, when narrower than `options`. */
  extractionOptions?: readonly string[];
}

export const FIELD_SPECS: FieldSpec[] = [
  {
    key: "gym_name",
    label: "Gym name",
    shortLabel: "gym name",
    kind: "text",
    required: true,
    whenBlank: null,
    example: "Riverside Fitness",
    extraction: "The gym's trading name, exactly as the document writes it.",
  },
  {
    key: "opening_hours",
    label: "Opening hours",
    shortLabel: "opening hours",
    kind: "text",
    required: false,
    whenBlank: "Charlie says he doesn't have the opening hours in front of him.",
    example: "6am to 9pm weekdays, 8am to 1pm Saturdays",
    extraction:
      "The gym's opening hours as a short phrase, in the document's own terms. Null if the document gives no opening hours.",
  },
  {
    key: "quiet_hours",
    label: "Quiet times",
    shortLabel: "quiet times",
    kind: "text",
    required: false,
    whenBlank: "Charlie has no quiet times to suggest. Asked, he says he doesn't have them in front of him.",
    example: "weekday afternoons between 1pm and 4pm",
    extraction:
      "Times the document itself describes as quiet, least busy or a good time to avoid crowds. An off-peak membership's access window is not a statement that the gym is quiet — do not use it. Null unless quiet times are stated.",
  },
  {
    key: "other_locations",
    label: "Other locations",
    shortLabel: "other locations",
    kind: "text_list",
    required: false,
    whenBlank: "Charlie treats this as your only site. Asked about other locations, he'll say there aren't any.",
    example: "Coburg",
    extraction:
      "Names of the gym's other sites or branches that the document names. An empty list only if the document explicitly says this is the only location. Null if other locations are not mentioned.",
  },
  {
    key: "has_online",
    label: "Online training",
    shortLabel: "online training",
    kind: "boolean",
    required: false,
    whenBlank: "Charlie won't offer online training. Asked, he says he doesn't have that in front of him.",
    extraction:
      "true if the document says the gym offers online, virtual or remote training. false only if it explicitly says it does not. Null otherwise.",
  },
  {
    key: "books_classes",
    label: "Charlie can book classes",
    shortLabel: "class booking",
    kind: "boolean",
    required: false,
    whenBlank: "Charlie won't offer to book anyone into a class.",
    extraction:
      "true if the document says members can book into classes (a class timetable with booking). false only if it explicitly says there are no bookable classes. Null otherwise.",
  },
  {
    key: "renewal_discount_percent",
    label: "Renewal discount",
    shortLabel: "renewal discount",
    kind: "integer",
    required: false,
    whenBlank:
      "No renewal save. If price is the problem, Charlie says he'll pass it on — no discount, and no offer to ask a manager.",
    extraction:
      "A percentage discount the document offers to existing members who renew, as a whole number (20 for \"20% off\"). Not a joining discount and not a discount for new members. Null unless a renewal discount is stated.",
  },
  {
    key: "reengagement_perk",
    label: "Perk for a member who's stopped coming",
    shortLabel: "perk for a member who's stopped coming",
    kind: "enum",
    required: false,
    options: REENGAGEMENT_PERKS,
    extractionOptions: ["guest_pass", "free_session", "none"],
    optionLabels: {
      guest_pass: "Guest pass (texted as a link)",
      free_session: "Free session (someone calls to book it)",
      other: "Something else",
      none: "Nothing",
    },
    whenBlank: "Charlie calls with nothing to give — he checks in and offers nothing.",
    extraction:
      "What the document offers existing members that the gym could give someone who has stopped coming: \"guest_pass\" for a guest or bring-a-friend pass, \"free_session\" for a free training session, \"none\" only if the document explicitly says there is nothing. Null otherwise.",
  },
  {
    key: "winback_offer",
    label: "Offer for a lapsed member",
    shortLabel: "offer for a lapsed member",
    kind: "enum",
    required: false,
    options: WINBACK_OFFERS,
    extractionOptions: ["free_pt_session", "guest_pass", "none"],
    optionLabels: {
      free_pt_session: "Free PT session (someone calls to book it)",
      guest_pass: "Guest pass (texted as a link)",
      other: "Something else",
      none: "Nothing",
    },
    whenBlank: "Charlie has no free session or guest pass for someone whose membership has ended.",
    extraction:
      "What the document offers a former member to come back: \"free_pt_session\" for a free personal-training session, \"guest_pass\" for a guest or day pass, \"none\" only if the document explicitly says there is nothing. Null otherwise.",
  },
  {
    key: "cheaper_tier_name",
    label: "Cheaper membership name",
    shortLabel: "cheaper membership name",
    kind: "text",
    required: false,
    whenBlank: "Charlie won't mention a cheaper membership.",
    example: "concession membership",
    extraction:
      "The name of a lower-priced membership option the document presents as cheaper (off-peak, concession, student), as the document names it. Null if none is stated.",
  },
  {
    key: "cheaper_tier_price",
    label: "Cheaper membership price",
    shortLabel: "cheaper membership price",
    kind: "decimal",
    required: false,
    whenBlank: null,
    extraction:
      "The monthly price in dollars of that cheaper option, as a number (39 for \"$39 a month\"). If the document only gives a weekly or fortnightly price, return null — do not convert it.",
  },
  {
    key: "freeze_max_weeks",
    label: "Membership freeze — longest pause",
    shortLabel: "freeze length",
    kind: "integer",
    required: false,
    whenBlank:
      "No freeze. Charlie never offers to pause a membership, and a member who has asked to cancel is called only if there is a cheaper membership to mention.",
    extraction: "",
    extract: false,
  },
  {
    key: "freeze_weekly_fee",
    label: "Freeze fee per week",
    shortLabel: "freeze fee",
    kind: "decimal",
    required: false,
    whenBlank: null,
    extraction: "",
    extract: false,
  },
  {
    key: "reengagement_other_label",
    label: "What the something else is",
    shortLabel: "other perk",
    kind: "text",
    required: false,
    whenBlank: null,
    example: "protein shake",
    extraction: "",
    extract: false,
  },
  {
    key: "reengagement_other_delivery",
    label: "How it reaches them",
    shortLabel: "other perk delivery",
    kind: "enum",
    required: false,
    options: OTHER_OFFER_DELIVERIES,
    optionLabels: { link: "Texted as a link", booking: "Someone calls to book it" },
    whenBlank: null,
    extraction: "",
    extract: false,
  },
  {
    key: "winback_other_label",
    label: "What the something else is",
    shortLabel: "other winback offer",
    kind: "text",
    required: false,
    whenBlank: null,
    example: "smoothie",
    extraction: "",
    extract: false,
  },
  {
    key: "winback_other_delivery",
    label: "How it reaches them",
    shortLabel: "other winback offer delivery",
    kind: "enum",
    required: false,
    options: OTHER_OFFER_DELIVERIES,
    optionLabels: { link: "Texted as a link", booking: "Someone calls to book it" },
    whenBlank: null,
    extraction: "",
    extract: false,
  },
];

/** The fields a document can fill. The extraction schema, prompt and sanitiser use only these. */
export const EXTRACTABLE_SPECS: FieldSpec[] = FIELD_SPECS.filter((spec) => spec.extract !== false);

export function fieldSpec(key: GymFieldKey): FieldSpec {
  const spec = FIELD_SPECS.find((f) => f.key === key);
  if (!spec) throw new Error(`no field spec for ${key}`);
  return spec;
}

// --- Parsing ------------------------------------------------------------------

export type FieldErrors = Partial<Record<GymFieldKey | "gym_id" | "offer_schedule" | "_form", string>>;

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
    return { value: null, error: `${label} needs to be written as text.` };
  }
  // What is checked is what is stored: normalised first, never after.
  const text = normaliseText(value);
  if (text.length > max) {
    return { value: null, error: `That's ${text.length} characters. Keep it under ${max}.` };
  }
  const problem = checkText(text, kind);
  if (problem) return { value: null, error: problem.message };
  return { value: text };
}

function parseBoolean(value: unknown): FieldParse<boolean> {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "boolean") {
    return { value: null, error: "Choose Yes, No or Not stated." };
  }
  return { value };
}

function parseEnum<T extends string>(value: unknown, options: readonly T[], label: string): FieldParse<T> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    return {
      value: null,
      error: `Choose one of the options for ${label.toLowerCase()}, or Not stated.`,
    };
  }
  return { value: value as T };
}

function parseLocations(value: unknown): FieldParse<string[]> {
  if (value === undefined || value === null) return { value: null };
  if (!Array.isArray(value)) {
    return { value: null, error: "Add each other location as its own site name." };
  }
  if (value.length > MAX_OTHER_LOCATIONS) {
    return { value: null, error: `List ${MAX_OTHER_LOCATIONS} other locations at most.` };
  }
  const parsed: string[] = [];
  for (const entry of value) {
    if (isBlank(entry)) continue;
    const one = parseText(entry, { kind: "place", max: LIMITS.location, label: "A location name" });
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
      error: `Together the site names run to ${joined.length} characters. Keep them under ${LIMITS.fact}, or shorten the names.`,
    };
  }
  // An explicitly empty list is the gym saying "no other sites"; a list of
  // blanks from a form is the gym saying nothing.
  return { value: deduped.length > 0 ? deduped : value.length === 0 ? [] : null };
}

function parseDiscount(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: "Enter a whole number, like 15 — no % sign needed." };
  }
  if (!Number.isInteger(value)) return { value: null, error: "Enter a whole number, like 15 — no decimals." };
  if (value === 0) {
    return { value: null, error: "0% isn't a discount — leave it blank if there's no renewal discount." };
  }
  if (value < 0) return { value: null, error: "Enter a number above 0, like 15, or leave it blank." };
  if (value > RENEWAL_DISCOUNT_MAX) {
    return { value: null, error: `Enter ${RENEWAL_DISCOUNT_MAX} or less, or leave it blank.` };
  }
  return { value };
}

function parsePrice(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: "Enter the monthly price as a number, like 45 or 39.50." };
  }
  if (value <= 0) return { value: null, error: "Enter a price above $0, or leave it blank." };
  if (value > TIER_PRICE_MAX) {
    return { value: null, error: `Enter a monthly price of $${TIER_PRICE_MAX} or less.` };
  }
  if (!hasAtMostTwoDecimals(value)) {
    return { value: null, error: "Use two decimal places at most, like 39.50." };
  }
  return { value };
}

function parseFreezeWeeks(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: "Enter the longest pause as a whole number of weeks, like 8." };
  }
  if (!Number.isInteger(value)) return { value: null, error: "Enter a whole number of weeks, like 8 — no decimals." };
  if (value < FREEZE_WEEKS_MIN) {
    return { value: null, error: `A freeze needs at least ${FREEZE_WEEKS_MIN} week. Leave this blank if there is no freeze.` };
  }
  if (value > FREEZE_WEEKS_MAX) {
    return { value: null, error: `Enter ${FREEZE_WEEKS_MAX} weeks or fewer, or leave it blank.` };
  }
  return { value };
}

/** Zero is a free freeze, and a valid answer; blank is no freeze at all. */
function parseFreezeFee(value: unknown): FieldParse<number> {
  if (isBlank(value)) return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: "Enter the weekly fee as a number, like 5 or 2.50 — 0 if the freeze is free." };
  }
  if (value < 0) return { value: null, error: "Enter 0 for a free freeze, or the weekly fee." };
  if (value > FREEZE_FEE_MAX) {
    return { value: null, error: `Enter a weekly fee of $${FREEZE_FEE_MAX} or less.` };
  }
  if (!hasAtMostTwoDecimals(value)) {
    return { value: null, error: "Use two decimal places at most, like 2.50." };
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
      return parseText(value, { kind: "hours", max: LIMITS.fact, label: "Opening hours" });
    case "quiet_hours":
      return parseText(value, { kind: "hours", max: LIMITS.fact, label: "Quiet times" });
    case "other_locations":
      return parseLocations(value);
    case "has_online":
      return parseBoolean(value);
    case "books_classes":
      return parseBoolean(value);
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
    case "freeze_max_weeks":
      return parseFreezeWeeks(value);
    case "freeze_weekly_fee":
      return parseFreezeFee(value);
    case "reengagement_other_label":
    case "winback_other_label":
      return parseText(value, { kind: "offer_label", max: LIMITS.offer_label, label: "The offer" });
    case "reengagement_other_delivery":
    case "winback_other_delivery":
      return parseEnum(value, OTHER_OFFER_DELIVERIES, "How it reaches them");
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
    errors.gym_name = "Enter the gym's name — it's the first thing Charlie says.";
  }

  if (!errors.cheaper_tier_name && !errors.cheaper_tier_price) {
    if (value.cheaper_tier_name !== null && value.cheaper_tier_price === null) {
      errors.cheaper_tier_price = "Add the monthly price for this membership, or clear its name.";
    } else if (value.cheaper_tier_name === null && value.cheaper_tier_price !== null) {
      errors.cheaper_tier_name = "Add a name for this membership, or clear its price.";
    }
  }

  // A freeze is its length and its fee, both or neither. A fee of 0 is a free
  // freeze; a blank fee beside a length is a question nobody answered.
  if (!errors.freeze_max_weeks && !errors.freeze_weekly_fee) {
    if (value.freeze_max_weeks !== null && value.freeze_weekly_fee === null) {
      errors.freeze_weekly_fee = "Add the weekly fee — 0 if the freeze is free — or clear the number of weeks.";
    } else if (value.freeze_max_weeks === null && value.freeze_weekly_fee !== null) {
      errors.freeze_max_weeks = "Add the longest pause in weeks, or clear the fee.";
    }
  }

  // An "other" offer is its label and its delivery, both or neither — and only
  // when "other" is the choice. A label left behind by another choice is an
  // error, not something to keep quietly or drop.
  for (const [choiceKey, labelKey, deliveryKey] of [
    ["reengagement_perk", "reengagement_other_label", "reengagement_other_delivery"],
    ["winback_offer", "winback_other_label", "winback_other_delivery"],
  ] as const) {
    if (errors[choiceKey] || errors[labelKey] || errors[deliveryKey]) continue;
    if (value[choiceKey] === "other") {
      if (value[labelKey] === null) errors[labelKey] = 'Name the offer, like "protein shake" — Charlie says exactly this.';
      if (value[deliveryKey] === null) errors[deliveryKey] = "Choose whether it's texted as a link or someone calls to book it.";
    } else if (value[labelKey] !== null || value[deliveryKey] !== null) {
      errors[labelKey] = 'Choose "Something else" for this offer, or clear what it is and how it\'s delivered.';
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
  const fields = parseGymFields(input, { allowKeys: ["gym_id", "offer_schedule", ...allowKeys] });
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
  const schedule = parseOfferSchedule(raw.offer_schedule, fields.value);
  if (schedule.error) return { ok: false, errors: { offer_schedule: schedule.error } };
  // The key is present only when a schedule is: a gym without one parses to
  // exactly the object it did before schedules existed.
  return {
    ok: true,
    value: { gym_id: gymId as string, ...fields.value, ...(schedule.value ? { offer_schedule: schedule.value } : {}) },
  };
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
    freeze_max_weeks: null,
    freeze_weekly_fee: null,
    reengagement_other_label: null,
    reengagement_other_delivery: null,
    winback_other_label: null,
    winback_other_delivery: null,
  };
}

/** A cheaper tier counts only when both halves are present. */
export function hasCheaperTier(gym: GymFields): boolean {
  return gym.cheaper_tier_name !== null && gym.cheaper_tier_price !== null;
}

/** A freeze counts only when both halves are present. A fee of 0 is a freeze; null is none. */
export function hasFreeze(gym: GymFields): boolean {
  return gym.freeze_max_weeks !== null && gym.freeze_weekly_fee !== null;
}
