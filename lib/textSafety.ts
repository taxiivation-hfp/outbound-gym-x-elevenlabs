/**
 * Free text that ends up inside an agent's system prompt.
 *
 * Gym config is structured on purpose — numbers, booleans, enums — but five
 * fields cannot be anything other than short strings: the gym's name, its
 * opening hours, its quiet times, its other sites and the name of a cheaper
 * tier. Every one of them is substituted into a prompt verbatim, and the gym's
 * name is also the first thing the agent says out loud. That makes them the only
 * place a config can smuggle an instruction to the agent, whether a gym owner
 * typed it or an uploaded document put it there.
 *
 * A blocklist of bad words loses to the first synonym, look-alike letter or
 * invisible character nobody listed, so each field is held to an allowlist of
 * the shape of the fact it names, and the word checks are a second layer:
 *
 * - text is NFKC-normalised first, so fullwidth or stylised letters are checked
 *   as the letters they display as;
 * - its letters come from an explicit list — ASCII, and the accented Latin
 *   letters European place and family names use — so small capitals, IPA
 *   letters, look-alikes from other scripts, invisible fillers and combining
 *   marks that NFKC leaves in place are all refused, as characters;
 * - opening hours and quiet times may only use the vocabulary of days and times
 *   ("6am to 9pm weekdays, closed Sundays"): an offer can't be written without a
 *   word that isn't on that list;
 * - site names and gym names are short, and a tier name must end in the noun
 *   that says what it is;
 * - every field is also checked for text addressed to the agent and for the
 *   vocabulary of an offer, matched on word stems;
 * - a written-out blank ("N/A", "TBC", "none") is refused, because a blank is
 *   meant to be left blank — that is what makes the agent admit it doesn't know.
 *
 * All of it is deliberately conservative. A false positive costs the operator
 * one rewrite of one field; a false negative lets a PDF author the guardrails
 * on a call that makes financial offers to real people.
 */

export type TextKind = "gym_name" | "hours" | "place" | "tier_name" | "offer_label";

export interface TextProblem {
  /** Written for the operator, next to the field. */
  message: string;
}

/**
 * Letters, listed rather than matched by script: Basic Latin, the Latin-1 and
 * Latin Extended-A accented letters (é, ü, ø, ł, ő …), and Romanian ș and ț.
 * After NFKC an accented letter is one precomposed character, so no combining
 * mark is ever needed — and none is allowed.
 */
export const NAME_LETTERS = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u017F\\u0218-\\u021B";

const CHARACTERS: Record<TextKind, RegExp> = {
  /** Times and days: sentence-internal punctuation allowed. */
  hours: new RegExp(`^[${NAME_LETTERS}0-9 ,.'’&()/:;+\\-–—]+$`, "u"),
  /** A suburb or site name. */
  place: new RegExp(`^[${NAME_LETTERS}0-9 .'’&\\-]+$`, "u"),
  /** A gym's name: no commas, colons or semicolons, which only a sentence needs. */
  gym_name: new RegExp(`^[${NAME_LETTERS}0-9 .'’&()/+\\-–—]+$`, "u"),
  /**
   * A tier name sits inside an offer sentence ("you can mention the {tier_name}
   * at $39 a month"), so it is the tightest: letters, spaces, apostrophes,
   * hyphens and ampersands. No digits, which could read as a second price.
   */
  tier_name: new RegExp(`^[${NAME_LETTERS} '’&\\-]+$`, "u"),
  /**
   * What an "other" offer is ("protein shake"). It sits inside an offer
   * sentence exactly like a tier name, so it gets the same characters.
   */
  offer_label: new RegExp(`^[${NAME_LETTERS} '’&\\-]+$`, "u"),
};

const ALLOWED_DESCRIPTION: Record<TextKind, string> = {
  hours: "letters, numbers, spaces and , . ' & ( ) / : ; + -",
  place: "letters, numbers, spaces and . ' & -",
  gym_name: "letters, numbers, spaces and . ' & ( ) / + -",
  tier_name: "letters, spaces and ' & -",
  offer_label: "letters, spaces and ' & -",
};

const MAX_WORDS: Record<TextKind, number> = { hours: 24, place: 5, gym_name: 6, tier_name: 4, offer_label: 4 };

const WHAT_IT_IS: Record<TextKind, string> = {
  hours: "days and times",
  place: "site name",
  gym_name: "name",
  tier_name: "membership name",
  offer_label: "short name for the offer",
};

/**
 * The words opening hours and quiet times are written in. Anything else — an
 * offer, a note to staff, a sentence to the agent — needs a word that isn't here.
 */
const HOURS_WORDS = new Set(
  (
    "am pm noon midday midnight hr hrs h oclock o'clock " +
    "monday tuesday wednesday thursday friday saturday sunday mondays tuesdays wednesdays thursdays fridays saturdays sundays " +
    "mon tue tues wed weds thu thur thurs fri sat sun " +
    "weekday weekdays weekend weekends weeknight weeknights daily everyday every day days night nights nightly week weeks " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec " +
    "public holiday holidays christmas easter anzac boxing good new year years eve school term terms " +
    "morning mornings afternoon afternoons evening evenings lunchtime lunch early late mid dawn " +
    "open opens opening closed close closes closing staffed unstaffed access hours hour " +
    "to from until till til through thru and or except excluding including between before after " +
    "at on the a an in by of all most usually generally typically mostly often always sometimes " +
    "around about approximately approx roughly only also then when is are it its it's there not no " +
    "busy busier busiest quiet quieter quietest peak offpeak crowd crowds crowded empty emptier calm calmer slow slower " +
    "less least fewer people time times class classes floor gym"
  ).split(" ")
);

const HOURS_NUMBER = [
  /^\d{1,2}([:.]\d{2})?(am|pm)?$/, // 6, 6am, 5:30am, 5.30pm
  /^\d{3,4}(hrs?|h)?$/, // 0600, 2100hrs
  /^\d{1,2}(hrs?|h)$/, // 24hr
  /^\d{1,2}(st|nd|rd|th)$/, // 25th
];

/** The first word in some hours text that isn't the vocabulary of days and times. */
function wordOutsideHours(text: string): string | null {
  const prepared = text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\boff[- ]?peak\b/g, "offpeak")
    .replace(/\ba\.m\.?/g, "am")
    .replace(/\bp\.m\.?/g, "pm");
  for (const raw of prepared.split(/[\s,;()/&+\-–—]+/)) {
    const word = raw.replace(/^[.:']+|[.:']+$/g, "");
    if (!word) continue;
    if (HOURS_WORDS.has(word) || HOURS_NUMBER.some((p) => p.test(word))) continue;
    return word;
  }
  return null;
}

/**
 * Text that addresses a model. Checked on every free-text field.
 */
const ADDRESSES_A_MODEL: RegExp[] = [
  /\b(ignor|disregard|overrid|overrul|bypass|circumvent|jailbr)\w*/i,
  /\bforget\w*\s+(all|any|every|everything|previous|prior|earlier|the above|above|your|these|those)\b/i,
  /\b(instruct|prompt|guardrail|directive)\w*/i,
  /\bsystem (message|text|note)\w*/i,
  /\b(assistant|chatbot|chat bot|language model|llm|gpt|agents?|bots?)\b/i,
  // Case-sensitive on purpose: "AI" the acronym, not "ai" inside a word.
  /\bA\.?I\b/,
  /\b(pretend|role-?play|act as|you are now|from now on)\b/i,
];

/** Speaking to someone, or telling them what to do. */
const SPEAKS_TO_SOMEONE: RegExp[] = [
  /\b(you|your|yours|you're|youre|you'll|youll|yourself|u)\b/i,
  /\b(must|should|shall|do not|don't|dont|cannot|can't|cant)\b/i,
  /\b(say|says|said|saying|tell|tells|telling|told|mention\w*|respond\w*|repl(y|ies|ied|ying)|announc\w*|promis\w*|agree\w*|confirm\w*|charlie)\b/i,
];

/** The vocabulary of an offer. An offer reaches the agent only through a typed field. */
const OFFER_WORDS: RegExp[] = [
  /\b(offer|discount|promo|coupon|voucher|refund|waiv|rebate|cashback|giveaway|gratis|complimentar)\w*/i,
  /\b(deal|deals|bargain|half[- ]?price|percent|per cent|manager\w*|approv\w*)\b/i,
  /\b(giv(e|es|en|ing)|grant\w*|award\w*|reward\w*|prize\w*|lifetime|zero|joining|credit\w*|cash)\b/i,
  /\bsign-?up fees?\b/i,
  /\bmembers?\s+(get|gets|receive|receives|earn|earns|enjoy|enjoys|score|scores|pay|pays)\b/i,
  /\bon the house\b/i,
  /\d+\s*(%|percent|per ?cent|pc|dollars?|bucks|off)\b/i,
  /\b(half|\d+%?) off\b/i,
  /\bno (charge|cost|fee)s?\b/i,
  /\b(months?|weeks?|days?)\s+(free|gratis|off)\b/i,
];

/** Free things are offers; a gym can be called "Free Spirit Fitness", so its name isn't checked for these. */
const FREE_WORDS = /\b(free|freebie\w*|bonus\w*|gift\w*|trial\w*)\b/i;

/**
 * Words with no place in a tier name, because the name is spliced into an offer
 * sentence: a different offer type, a price or a period, a second offer joined
 * on with "and", a joining fee or introductory deal, or a discount written as
 * "off" (other than "off-peak").
 */
const NOT_A_TIER_NAME: RegExp[] = [
  /\b(guest|pass|passes|session\w*|pt|personal train\w*|trainer\w*|coach\w*|class\w*)\b/i,
  /\b(half|renew\w*|cost\w*|charg\w*|pric\w*|cheap\w*|sav(e|es|ing|ings)|months?|weeks?|fortnights?|years?|days?|week(ly)?|monthly)\b/i,
  /\b(join\w*|fees?|first|intro\w*)\b/i,
  /\boff\b(?![- ]?peak)/i,
  /\b(and|or|plus|with|but|then|also|including|includes)\b/i,
  // A freeze has its own typed fields, and its words would read as a second offer.
  /\b(freez\w*|froze\w*|paus\w*|suspen\w*|hold)\b/i,
];

/**
 * Words with no place in an "other" offer's label. The label is spliced into
 * "You are calling with something to give them from the gym: {label}", so it
 * can only be a thing: not one of the offers that have their own typed field
 * (a guest pass, a session, a discount, a cheaper plan), not a period or a
 * price ("month", "half"), not a second thing joined on, not "everyone", and
 * not the quiet times the winback block handles separately.
 */
const NOT_AN_OFFER_LABEL: RegExp[] = [
  /\b(guest|pass|passes|session\w*|pt|personal train\w*|trainer\w*|coach\w*)\b/i,
  /\b(membership\w*|plan|plans|tier\w*|rate|rates|concession\w*|access|off-?peak|cheap\w*|discount\w*|renew\w*)\b/i,
  /\b(half|cost\w*|charg\w*|pric\w*|sav(e|es|ing|ings)|months?|weeks?|fortnights?|years?|days?|weekly|monthly|hours?)\b/i,
  /\b(join\w*|fees?|first|intro\w*|unlimited|every|everyone|everybody|all|any|anyone)\b/i,
  /\boff\b/i,
  /\b(and|or|plus|with|but|then|also|including|includes)\b/i,
  /\b(quiet\w*|busy|crowd\w*)\b/i,
  /\b(freez\w*|froze\w*|paus\w*|suspen\w*|hold)\b/i,
];

/** A tier name ends in the noun that says what it is. */
const TIER_NAME_ENDING = /\b(membership|plan|tier|option|rate|concession|access)$/i;

/**
 * A sentence break inside a name — "Southbank Strength. You must …" — other than
 * after one of the abbreviations place and business names use ("St. Kilda").
 */
const SENTENCE_BREAK_IN_NAME = /(?:^|\s)(?!(?:st|mt|ft|pt|co|nth|sth|est)\.\s)\S*[.!?]\s+\S/i;

/** A blank written out as text. */
const WRITTEN_BLANK = /^(n\/?a|na|n\.a\.?|none|nil|null|nothing|unknown|not (stated|known|sure|applicable|available|given)|tb[acd]|to be (confirmed|advised|decided)|-+|—|–|\?+|\.+|x+)$/i;

/** NFKC, collapsed spaces, trimmed: what gets checked is what gets stored. */
export function normaliseText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function distinctDisallowed(text: string, allowed: RegExp): string[] {
  const out = new Set<string>();
  for (const ch of text) {
    if (!allowed.test(ch)) {
      const code = ch.codePointAt(0) ?? 0;
      // Show printable ASCII as itself; show anything else — look-alike letters,
      // invisible marks — by code point, since it may not be visible at all.
      out.add(/^[\x21-\x7e]$/.test(ch) ? ch : `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  return [...out];
}

/** The first phrase in `text` that reads as an instruction or an offer, if any. */
export function instructionPhrase(text: string, kind: TextKind = "hours"): string | null {
  const patterns: RegExp[] = [...ADDRESSES_A_MODEL, ...SPEAKS_TO_SOMEONE, ...OFFER_WORDS];
  if (kind !== "gym_name") patterns.push(FREE_WORDS);
  if (kind === "tier_name") patterns.push(...NOT_A_TIER_NAME);
  if (kind === "offer_label") patterns.push(...NOT_AN_OFFER_LABEL);
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * Text aimed at a model, as it appears inside a gym's own document. Narrower
 * than ADDRESSES_A_MODEL on purpose: that list guards the short config fields,
 * where refusing "instructor" costs one retyped word. Here a match discards
 * every value quoted from the same part of a document, so it has to be text
 * that is actually talking to an AI — not a gym's instructors, its prompt
 * payment terms or its assistant manager.
 */
const DIRECTED_AT_A_MODEL: RegExp[] = [
  /\b(ignor\w*|disregard\w*|overrid\w*|overrul\w*|bypass\w*|forget\w*)\b[^.!?\n]{0,60}\b(instructions?|rules|prompts?|guidelines|guardrails|directives|everything above|the above|previous|prior)\b/i,
  /\b(system|developer)\s+(prompt|message|instruction|note)s?\b/i,
  /\b(note|message|instructions?)\s+(to|for)\s+(the\s+|any\s+)?(ai|a\.i\.|assistant|model|llm|bot|chatbot|language model)\b/i,
  /\b(ai|a\.i\.)\s+(assistant|model|system|agent|reader|tool)s?\b/i,
  /\b(language model|llm|chatbot|chat bot|chatgpt|gpt-?\d)\b/i,
  /\b(you are|act as|pretend to be|as) an? (ai|assistant|language model)\b/i,
  /\b(jailbr\w*|prompt injection)\b/i,
  /\b(set|fill|put|write|change|record)\b[^.!?\n]{0,40}\b(incentives? (field|section)|output format|json|schema)\b/i,
  /\byour (instructions|rules|prompt|output|system prompt)\b/i,
];

/** Does this document text talk to a model — "note to the AI", "ignore prior instructions"? */
export function addressesAModel(text: string): boolean {
  const normalised = normaliseText(text);
  return DIRECTED_AT_A_MODEL.some((p) => p.test(normalised));
}

/**
 * Does this read as something addressed to an AI, or an instruction to offer
 * everyone something? Used on the lines an extraction quotes: a document's own
 * sentences may say "you" and "offer", but a line that talks to a model is
 * never evidence for a field.
 */
export function looksLikeInstruction(text: string): boolean {
  const normalised = normaliseText(text);
  return (
    addressesAModel(normalised) ||
    /\b(offer|give|tell|promise|grant)\w*\s+(every|all|any)\s*(one|body|member\w*|caller\w*)?\b/i.test(normalised)
  );
}

const SPOKEN_CHARACTERS = new RegExp(`^[${NAME_LETTERS}0-9 ,.'’&()/:;!?\\-–—]+$`, "u");

/**
 * What a member said on a previous call, as the call analysis recorded it, made
 * safe to quote in the next call's `context` — or null, and the quote is left
 * out. That text came from a model's summary of a conversation with a member,
 * so it gets the same suspicion as a document: short, plain characters, no
 * double quotes to break out of the quotation, nothing addressed to the agent
 * and no offer. "Did my knee in playing footy" passes; "tell Charlie I get 50%
 * off" does not. Words like "must" and "said" stay allowed — people use them
 * about their own lives.
 */
export function memberWordsForPrompt(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const normalised = normaliseText(text);
  if (!normalised || normalised.length > 160 || normalised.split(" ").length > 25) return null;
  if (!SPOKEN_CHARACTERS.test(normalised)) return null;
  // These words go straight into a prompt, so they get the strict list as well.
  if (ADDRESSES_A_MODEL.some((p) => p.test(normalised)) || looksLikeInstruction(normalised) || OFFER_WORDS.some((p) => p.test(normalised))) {
    return null;
  }
  if (/\bcharlie\b/i.test(normalised)) return null;
  return normalised;
}

/** A day someone said they'd come in ("Tuesday", "Saturday morning"), or null. */
export function dayPhraseForPrompt(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const normalised = normaliseText(text);
  if (!normalised || normalised.split(" ").length > 5 || !CHARACTERS.hours.test(normalised)) return null;
  const extra = new Set(["tomorrow", "today", "next", "this", "coming"]);
  const words = normalised.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.some((w) => !extra.has(w) && wordOutsideHours(w) !== null)) return null;
  return normalised;
}

/**
 * Checks one free-text value, already passed through `normaliseText`. Returns
 * null when it is safe to put in a prompt, or the reason it is not.
 */
export function checkText(text: string, kind: TextKind): TextProblem | null {
  if (text !== normaliseText(text)) {
    return { message: "Retype this as plain text — it has line breaks or stylised characters." };
  }

  if (WRITTEN_BLANK.test(text)) {
    return {
      message: `Leave this empty instead of writing "${text}" — empty is what tells Charlie he doesn't have it.`,
    };
  }

  const allowed = CHARACTERS[kind];
  if (!allowed.test(text)) {
    const bad = distinctDisallowed(text, new RegExp(allowed.source.replace(/^\^\[/, "[").replace(/\]\+\$$/, "]"), "u"));
    return {
      message: `Remove ${bad.map((c) => `"${c}"`).join(", ")} — only ${ALLOWED_DESCRIPTION[kind]} can be used here.`,
    };
  }

  const words = text.split(" ").filter(Boolean).length;
  if (words > MAX_WORDS[kind]) {
    return { message: `Keep this to ${MAX_WORDS[kind]} words or fewer — a ${WHAT_IT_IS[kind]}, not a sentence.` };
  }

  if (kind === "offer_label" && /^(a|an|the|one|some|your|our|their)\b/i.test(text)) {
    return { message: `Leave out "${text.split(" ")[0]}" — write just the thing, like "protein shake".` };
  }

  if ((kind === "gym_name" || kind === "place") && SENTENCE_BREAK_IN_NAME.test(text)) {
    return { message: "A name can't contain a full stop followed by more words — keep it to the name itself." };
  }

  if (kind === "tier_name" && /^the\b/i.test(text)) {
    return { message: `Leave out "the" — Charlie already says "the ${text.replace(/^the\s+/i, "")}".` };
  }
  if (kind === "tier_name" && !TIER_NAME_ENDING.test(text)) {
    return {
      message: 'End the name with what it is — membership, plan, tier, option, rate, concession or access (for example "off-peak membership").',
    };
  }

  const phrase = instructionPhrase(text, kind);
  if (phrase) {
    return {
      message: `Charlie can't use "${phrase}" here. Write only the ${WHAT_IT_IS[kind]} itself — anything Charlie may offer comes from the offer questions.`,
    };
  }

  if (kind === "hours") {
    const word = wordOutsideHours(text);
    if (word) {
      return {
        message: `"${word}" isn't a day or a time. Write only when, like "6am to 9pm weekdays, 8am to 1pm Saturdays" — anything Charlie may offer comes from the offer questions.`,
      };
    }
  }

  return null;
}
