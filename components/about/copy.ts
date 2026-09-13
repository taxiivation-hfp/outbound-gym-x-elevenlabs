import type { CallType } from "@/lib/callType";

/**
 * The About page's fixed prose, kept apart from the numbers.
 *
 * Every sentence here is a claim about what the code or the prompts do, and
 * each says where it comes from. Anything with a number in it is not here: the
 * page computes those from `buildQueueView()` and `evals/results/latest.json`.
 */

/**
 * What each agent does on a call. Consistent with `callTypeBlurb` in
 * lib/labels.ts, the goals in agents/prompts/<type>/goal.md, the winback
 * windows and cancellation gates in lib/callType.ts and lib/eligibility.ts.
 */
export const CALL_TYPE_WHAT: Record<CallType, string> = {
  renewal:
    "Still training, and a fixed term is about to lapse. It makes sure they know the membership won’t renew by itself and makes renewing easy. If they hesitate and the gym has a save to offer, it offers it once.",
  reengagement:
    "The membership is live and they have stopped coming. It asks once what got in the way, then asks for one visit. It is not selling anything.",
  winback:
    "The membership has already ended. It asks why they stopped, once, and matches what the gym has to the reason they give. It is tried at about one, three and six months after the end date, and never after.",
  cancellation:
    "The member has asked to cancel. It tells them the cancellation is being processed, asks why once, and puts at most two alternatives on the table — the second only if they say the first doesn’t fit. Any decline ends the offers, and the cancellation goes ahead either way.",
};

/**
 * The call types the article lists, in the order it lists them. Derived from
 * CALL_TYPE_WHAT, whose Record type forces exactly one entry per CallType, so
 * the spelled-out count in the heading and the list cannot disagree.
 */
export const ABOUT_CALL_TYPES = Object.keys(CALL_TYPE_WHAT) as CallType[];

export interface Commitment {
  text: string;
  /** Where the rule lives, for the reader who wants to check. */
  source: string;
  /** Ids in evals/results/latest.json that check this commitment. */
  scenarios: string[];
  guards: string[];
}

/**
 * The six rules a gym cannot switch off. Each is in agents/prompts/shared/
 * guardrails.md or the cancellation goal, and the ids are the checks in the
 * eval suite that exercise it — an empty list is shown as "no check yet".
 */
export const COMMITMENTS: Commitment[] = [
  {
    text: "It says it is an AI, plainly and immediately, when anyone asks. It never denies it.",
    source: "Shared guardrails",
    scenarios: ["ai-question-admitted", "cancellation-ai-question-admitted"],
    guards: [],
  },
  {
    text: "“Stop calling me” ends the call, and it is permanent across every call type.",
    source: "Shared guardrails; lib/eligibility.ts",
    scenarios: ["stop-calling-ends-immediately", "cancellation-stop-calling-ends-immediately"],
    guards: ["do-not-contact-is-permanent"],
  },
  {
    text: "No guilt, ever — not about missed visits, their fitness or their body.",
    source: "Shared guardrails",
    scenarios: [],
    guards: [],
  },
  {
    text: "An injury never gets advice. It gets pointed to a trainer or a doctor.",
    source: "Shared guardrails; winback goal",
    scenarios: ["winback-injury-no-advice"],
    guards: [],
  },
  {
    text: "It never invents a fact. If something isn’t in front of it, it says so rather than guessing yes or no.",
    source: "Shared guardrails",
    scenarios: ["invents-nothing-pool", "unanswered-gym-question-degrades"],
    guards: [],
  },
  {
    text: "It never obstructs a cancellation. “Just cancel it” ends every offer, and it never asks anyone to justify leaving.",
    source: "Cancellation goal",
    scenarios: [
      "cancellation-just-cancel-it-not-obstructed",
      "cancellation-no-justification-demanded",
      "cancellation-ladder-stops-on-refusal",
      "cancellation-ambiguous-decline-is-a-refusal",
    ],
    guards: [],
  },
];

/** The founders, as the team names themselves. Photos are in public/team/. */
export const TEAM = [
  { name: "Danar Tan", src: "/team/founder-danar.png" },
  { name: "Oliver Baldwin", src: "/team/founder-oliver.png" },
  { name: "Orlando Tan", src: "/team/founder-orlando.png" },
  { name: "Jesslyn Susanto", src: "/team/founder-jesslyn.png" },
];

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "Forty-one" for 41; digits from 100 up. For headings that spell a computed count. */
export function numberWord(n: number, capitalise = false): string {
  let word: string;
  if (!Number.isInteger(n) || n < 0 || n >= 100) word = n.toLocaleString("en-AU");
  else if (n < 20) word = ONES[n];
  else word = TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  return capitalise ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** "1 member", "129 members". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;
}
