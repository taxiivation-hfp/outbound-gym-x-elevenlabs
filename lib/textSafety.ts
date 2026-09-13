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
 * So a string field is held to the shape of the fact it names:
 *
 * - it is NFKC-normalised first, so fullwidth or stylised letters are checked
 *   as the letters they display as;
 * - its characters are Latin letters, ASCII digits, spaces and the punctuation
 *   hours and place names actually use — which rules out look-alike letters
 *   from other scripts, invisible fillers, markup, template braces,
 *   percentages and prices;
 * - its words are checked for text addressed to the agent rather than
 *   describing the gym, matched on word stems so "offering" is caught as surely
 *   as "offer";
 * - a written-out blank ("N/A", "TBC", "none") is refused, because a blank is
 *   meant to be left blank — that is what makes the agent admit it doesn't know.
 *
 * All of it is deliberately conservative. A false positive costs the operator
 * one rewrite of one field; a false negative lets a PDF author the guardrails
 * on a call that makes financial offers to real people.
 */

export type TextKind = "gym_name" | "fact" | "tier_name";

export interface TextProblem {
  /** Written for the operator, next to the field. */
  message: string;
}

const LATIN_LETTER = "\\p{Script=Latin}";
const COMBINING_MARK = "\\p{M}";

/** Hours, quiet times and site names: sentence-internal punctuation allowed. */
const FACT_CHARACTERS = new RegExp(`^[${LATIN_LETTER}${COMBINING_MARK}0-9 ,.'’&()/:;+\\-–—]+$`, "u");
/** A gym's name: no commas, colons or semicolons, which only a sentence needs. */
const GYM_NAME_CHARACTERS = new RegExp(`^[${LATIN_LETTER}${COMBINING_MARK}0-9 .'’&()/+\\-–—]+$`, "u");
/**
 * A tier name sits inside an offer sentence ("you can mention the {tier_name}
 * at $39 a month"), so it is the tightest: letters, spaces, apostrophes,
 * hyphens and ampersands. No digits, which could read as a second price.
 */
const TIER_NAME_CHARACTERS = new RegExp(`^[${LATIN_LETTER}${COMBINING_MARK} '’&\\-]+$`, "u");

const ALLOWED_DESCRIPTION: Record<TextKind, string> = {
  fact: "letters, numbers, spaces and , . ' & ( ) / : ; + -",
  gym_name: "letters, numbers, spaces and . ' & ( ) / + -",
  tier_name: "letters, spaces and ' & -",
};

const CHARACTERS: Record<TextKind, RegExp> = {
  fact: FACT_CHARACTERS,
  gym_name: GYM_NAME_CHARACTERS,
  tier_name: TIER_NAME_CHARACTERS,
};

const MAX_WORDS: Record<TextKind, number> = { fact: 24, gym_name: 8, tier_name: 4 };

/**
 * Text that addresses a model. Checked on every free-text field.
 */
const ADDRESSES_A_MODEL: RegExp[] = [
  /\b(ignor|disregard|overrid|overrul|bypass|circumvent|jailbr)\w*/i,
  /\bforget\w*\s+(all|any|every|everything|previous|prior|earlier|the above|above|your|these|those)\b/i,
  /\b(instruct|prompt|guardrail|directive)\w*/i,
  /\bsystem (message|text|note)\w*/i,
  /\b(assistant|chatbot|chat bot|language model|llm|gpt)\w*/i,
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
  /\b(offer|discount|promo|coupon|voucher|refund|waiv|rebate|cashback|giveaway)\w*/i,
  /\b(deal|deals|bargain|half[- ]?price|percent|per cent|manager\w*|approv\w*)\b/i,
  /\d+\s*(%|percent|per ?cent|pc|dollars?|bucks|off)\b/i,
  /\b(half|\d+%?) off\b/i,
  /\bno (charge|cost|fee)s?\b/i,
];

/** Free things are offers; a gym can be called "Free Spirit Fitness", so only facts and tiers check it. */
const FREE_WORDS = /\b(free|freebie\w*|complimentary|bonus\w*|gift\w*|trial\w*)\b/i;

/**
 * Words with no place in a tier name, because the name is spliced into an offer
 * sentence: a different offer type, a price or a period, a second offer joined
 * on with "and", or a discount written as "off" (other than "off-peak").
 */
const NOT_A_TIER_NAME: RegExp[] = [
  /\b(guest|pass|passes|session\w*|pt|personal train\w*|trainer\w*|coach\w*|class\w*)\b/i,
  /\b(half|renew\w*|cost\w*|charg\w*|pric\w*|cheap\w*|sav(e|es|ing|ings)|months?|weeks?|fortnights?|years?|days?|week(ly)?|monthly)\b/i,
  /\boff\b(?![- ]?peak)/i,
  /\b(and|or|plus|with|but|then|also|including|includes)\b/i,
];

/** A tier name ends in the noun that says what it is. */
const TIER_NAME_ENDING = /\b(membership|plan|tier|option|rate|concession|access)$/i;

/**
 * A sentence break inside a name — "Southbank Strength. You must …" — other
 * than after a short abbreviation such as "St." or "Mt.".
 */
const SENTENCE_BREAK_IN_NAME = /(?:^|\s)(?![A-Za-z]{1,3}\.\s)\S*[.!?]\s+\S/;

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
      // invisible fillers — by code point, since it may not be visible at all.
      out.add(/^[\x21-\x7e]$/.test(ch) ? ch : `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  return [...out];
}

/** The first phrase in `text` that reads as an instruction or an offer, if any. */
export function instructionPhrase(text: string, kind: TextKind = "fact"): string | null {
  const patterns: RegExp[] = [...ADDRESSES_A_MODEL, ...SPEAKS_TO_SOMEONE, ...OFFER_WORDS];
  if (kind !== "gym_name") patterns.push(FREE_WORDS);
  if (kind === "tier_name") patterns.push(...NOT_A_TIER_NAME);
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * Does this text read as something addressed to an AI? Used on the quotes an
 * extraction points to: a document's own sentences may say "you" and "offer",
 * but a sentence that talks to a model is never evidence for a field.
 */
export function looksLikeInstruction(text: string): boolean {
  const normalised = normaliseText(text);
  return (
    ADDRESSES_A_MODEL.some((p) => p.test(normalised)) ||
    /\b(offer|give|tell|promise)\w*\s+(every|all|any)\s*(one|body|member\w*|caller\w*)?\b/i.test(normalised)
  );
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
    const bad = distinctDisallowed(text, allowed);
    return {
      message: `Remove ${bad.map((c) => `"${c}"`).join(", ")} — only ${ALLOWED_DESCRIPTION[kind]} can be used here.`,
    };
  }

  const words = text.split(" ").filter(Boolean).length;
  if (words > MAX_WORDS[kind]) {
    return { message: `Keep this to ${MAX_WORDS[kind]} words or fewer — a name or a short fact, not a sentence.` };
  }

  if (kind === "gym_name" && SENTENCE_BREAK_IN_NAME.test(text)) {
    return { message: "A gym name can't contain a full stop followed by more words — keep it to the name itself." };
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
      message:
        `Charlie can't use "${phrase}" here. Write only the ${kind === "gym_name" ? "name" : "fact"} itself — anything Charlie may offer comes from the offer questions.`,
    };
  }

  return null;
}
