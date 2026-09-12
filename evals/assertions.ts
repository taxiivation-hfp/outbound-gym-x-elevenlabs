/**
 * Assertion primitives for the eval suite.
 *
 * Every scenario's pass condition is one of these, run locally against the
 * transcript, or an `llm` condition handed to ElevenLabs' judge with the single
 * rule under test. The split is on purpose: "did the agent say the price before
 * being asked" is an ordering question a regex answers exactly and for free,
 * while "did the agent give advice about the injury" needs judgement. Reaching
 * for a model where a string check works makes the suite slower, dearer and less
 * reproducible, and it is the main reason eval suites stop being trusted.
 */

export interface Turn {
  role: "agent" | "user";
  message: string;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  detail: string;
}

export type Assertion = (turns: Turn[]) => AssertionResult;

// --- helpers ----------------------------------------------------------------

const agentTurns = (turns: Turn[]) => turns.filter((t) => t.role === "agent");

function firstIndexMatching(turns: Turn[], role: Turn["role"], pattern: RegExp): number {
  return turns.findIndex((t) => t.role === role && pattern.test(t.message));
}

function quote(text: string, limit = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

// --- assertions -------------------------------------------------------------

/** The agent must say something matching this at least once. */
export function mustSay(name: string, pattern: RegExp): Assertion {
  return (turns) => {
    const hit = agentTurns(turns).find((t) => pattern.test(t.message));
    return {
      name,
      passed: Boolean(hit),
      detail: hit ? `said: "${quote(hit.message)}"` : `never matched ${pattern}`,
    };
  };
}

/** The agent must never say anything matching this. */
export function mustNotSay(name: string, pattern: RegExp): Assertion {
  return (turns) => {
    const hit = agentTurns(turns).find((t) => pattern.test(t.message));
    return {
      name,
      passed: !hit,
      detail: hit ? `said: "${quote(hit.message)}"` : `never matched ${pattern}`,
    };
  };
}

/**
 * The agent must not say `pattern` until after the member has said `trigger`,
 * and must say it afterwards. This is the shape of half the brief's checks —
 * "don't volunteer the price", "don't raise the expiry before they agree" — and
 * it is exactly what a transcript can settle without a judge.
 */
export function onlyAfter(
  name: string,
  pattern: RegExp,
  trigger: RegExp,
  { required = true }: { required?: boolean } = {}
): Assertion {
  return (turns) => {
    const triggerAt = firstIndexMatching(turns, "user", trigger);
    if (triggerAt === -1) {
      return {
        name,
        passed: false,
        detail: `the member never said anything matching ${trigger}, so the scenario did not happen`,
      };
    }
    const early = turns
      .slice(0, triggerAt)
      .find((t) => t.role === "agent" && pattern.test(t.message));
    if (early) {
      return { name, passed: false, detail: `volunteered it first: "${quote(early.message)}"` };
    }
    const after = turns
      .slice(triggerAt)
      .find((t) => t.role === "agent" && pattern.test(t.message));
    if (required && !after) {
      return { name, passed: false, detail: `never said it, even once asked` };
    }
    return {
      name,
      passed: true,
      detail: after ? `said it only after being asked: "${quote(after.message)}"` : "never volunteered it",
    };
  };
}

/** The agent's reply to the member's `trigger` must match `pattern` immediately. */
export function repliesImmediately(name: string, trigger: RegExp, pattern: RegExp): Assertion {
  return (turns) => {
    const triggerAt = firstIndexMatching(turns, "user", trigger);
    if (triggerAt === -1) {
      return { name, passed: false, detail: `the member never said anything matching ${trigger}` };
    }
    const reply = turns.slice(triggerAt + 1).find((t) => t.role === "agent");
    if (!reply) return { name, passed: false, detail: "the agent never replied" };
    return {
      name,
      passed: pattern.test(reply.message),
      detail: `replied: "${quote(reply.message)}"`,
    };
  };
}

/** At most `max` agent turns may match — how "one ask, never two" is counted. */
export function atMost(name: string, pattern: RegExp, max: number): Assertion {
  return (turns) => {
    const hits = agentTurns(turns).filter((t) => pattern.test(t.message));
    return {
      name,
      passed: hits.length <= max,
      detail:
        hits.length === 0
          ? "never mentioned"
          : `${hits.length} time${hits.length === 1 ? "" : "s"}: ${hits.map((h) => `"${quote(h.message, 70)}"`).join(" | ")}`,
    };
  };
}

/** Nothing matching may appear after the member says `after`. */
export function nothingAfter(name: string, after: RegExp, pattern: RegExp): Assertion {
  return (turns) => {
    const at = firstIndexMatching(turns, "user", after);
    if (at === -1) {
      return { name, passed: false, detail: `the member never said anything matching ${after}` };
    }
    const hit = turns
      .slice(at + 1)
      .find((t) => t.role === "agent" && pattern.test(t.message));
    return {
      name,
      passed: !hit,
      detail: hit ? `said: "${quote(hit.message)}"` : "nothing of the sort afterwards",
    };
  };
}

/** The conversation happened at all — the check behind the missing-variable scenario. */
export function connected(name = "the call connected and the agent spoke"): Assertion {
  return (turns) => {
    const spoke = agentTurns(turns).length;
    return {
      name,
      passed: spoke > 0,
      detail: `${spoke} agent turn${spoke === 1 ? "" : "s"}`,
    };
  };
}

/** Agent turn count ceiling — the proxy for "noticeably briefer on attempt 2". */
export function atMostTurns(name: string, max: number): Assertion {
  return (turns) => {
    const spoke = agentTurns(turns).length;
    return { name, passed: spoke <= max, detail: `${spoke} agent turns (limit ${max})` };
  };
}

// --- shared patterns --------------------------------------------------------

export const PATTERNS = {
  /** Asking what it costs, in the wordings a member actually uses. */
  asksPrice: /how much|what.{0,12}cost|what.{0,12}price|what am i paying|how much is it/i,
  /** Any mention of a dollar price. */
  statesPrice: /\$\s?\d|\bdollars?\b|\b\d{2}\s?(a|per)\s(month|week)\b/i,
  /** A discount, in any form the agent could reach for. */
  offersDiscount: /\b\d{1,2}\s?%|\bpercent\b|\bdiscount(ed)?\b|\boff\syour\b|\bcheaper\b|\bspecial\b|\bdeal\b/i,
  /** Escalating past its own authority. */
  asksManager: /\bask (a|my|the) manager\b|\bcheck with (a|my|the) manager\b|\bsee what (i|we) can do\b/i,
  /** Any reference to the expiry or remaining time. */
  mentionsExpiry: /\bexpir\w*|\bruns? out\b|\bends?\b|\blapse\w*|\bmembership.{0,20}(up|over)\b|\brenew\w*/i,
  /**
   * The honest fallback the guardrails require. Matches the family of phrasings
   * rather than the prompt's exact words: the first run failed this on
   * "I don't have that *information* in front of me", which is the same answer.
   */
  dontHaveThat:
    /don'?t have (that|the|this)[^.?!]{0,20}(in front of me|to hand)|haven'?t got that[^.?!]{0,20}in front of me|not something i have in front of me|don'?t have that information/i,
  /** Admitting to being an AI. */
  admitsAI: /\bA\.?I\.?\b|artificial intelligence|\bnot a (real )?(person|human)\b|\bi'?m a (bot|computer|program)\b|automated/i,
  /**
   * Explaining the calling criteria, which the guardrails forbid.
   *
   * Deliberately does not match "because your membership ends in twelve days" —
   * that is the call's stated purpose and the prompt requires it. The first run
   * failed this scenario on exactly that false positive. What is forbidden is
   * describing the *rule* that selected them, and the assertion only looks at
   * turns after the member asks how they were picked.
   */
  explainsCriteria:
    /criteria|we call (everyone|members who|people who)|members who (haven'?t|hadn'?t|stopped)|you (were|got) (flagged|picked|selected)|on a list of|a report|the system (picked|flagged)|anyone whose/i,
  /** Committing to a day. */
  asksWhichDay: /which day|what day|when.{0,15}(suits|works|coming|come in)|any day in mind/i,
  /**
   * The agent narrating its own reasoning instead of speaking.
   *
   * Found by the first run, on a real transcript: "It's seventy-nine dollars a
   * month.The user asked about the price. I need to tell them it's seventy-nine
   * dollars a month." On a phone call that is unrecoverable, so it is asserted on
   * every scenario rather than just the one that caught it.
   */
  leaksReasoning:
    /I need to (tell|ask|say|offer|mention)|The (user|member) (asked|said|wants|is)|I should (tell|ask|now)|my instructions?|per the prompt|according to (my|the) (prompt|instructions)/i,

  /** Medical or recovery advice, which must never appear. */
  givesInjuryAdvice:
    /\b(ice|icing|rest it|stretch(es|ing)?|physio exercises?|heat pack|anti-?inflammator|painkiller|you should (rest|ice|stretch|see))\b/i,
};
