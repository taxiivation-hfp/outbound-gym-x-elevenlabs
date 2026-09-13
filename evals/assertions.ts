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

/** Where the agent first says something matching `pattern`: turn index and offset within it, or null. */
function firstAgentPosition(turns: Turn[], pattern: RegExp): { turn: number; offset: number; text: string } | null {
  for (let i = 0; i < turns.length; i += 1) {
    if (turns[i].role !== "agent") continue;
    const m = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(turns[i].message);
    if (m) return { turn: i, offset: m.index, text: turns[i].message };
  }
  return null;
}

/**
 * The agent must say `first` before it says `second` — an ordering between two
 * things the agent says, rather than between the member and the agent. Judged
 * by position, so both in one turn counts only if `first` comes earlier in it.
 * `second` need not be said at all.
 */
export function saysBefore(name: string, first: RegExp, second: RegExp): Assertion {
  return (turns) => {
    const a = firstAgentPosition(turns, first);
    const b = firstAgentPosition(turns, second);
    if (!a) return { name, passed: false, detail: `never said anything matching ${first}` };
    if (!b) return { name, passed: true, detail: `said it: "${quote(a.text)}" — and never said the other thing` };
    const ordered = a.turn < b.turn || (a.turn === b.turn && a.offset < b.offset);
    return {
      name,
      passed: ordered,
      detail: ordered ? `said it first: "${quote(a.text)}"` : `said the other thing first: "${quote(b.text)}"`,
    };
  };
}

/**
 * The first agent turn that puts anything on the table (`any`) must be the
 * offer `want`. How "match the first offer to the reason" is checked: not that
 * the wrong offer never appears, which a ladder may legitimately reach later,
 * but that it is not the one led with.
 */
export function firstOfferIs(name: string, any: RegExp, want: RegExp): Assertion {
  return (turns) => {
    const first = agentTurns(turns).find((t) => any.test(t.message));
    if (!first) return { name, passed: false, detail: `the agent never put anything on the table (nothing matched ${any})` };
    return {
      name,
      passed: want.test(first.message),
      detail: `first offer: "${quote(first.message)}"`,
    };
  };
}

const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
]);

/** Every number in a text, digits or words, with compounds ("thirty nine", "thirty-nine") joined. */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9.$-]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(run.join(" "));
    run = [];
  };
  for (const token of tokens) {
    const parts = token.split("-");
    if (parts.every((p) => NUMBER_WORDS.has(p))) {
      run.push(...parts);
      continue;
    }
    flush();
    const digits = /^\$?(\d+(?:\.\d+)?)$/.exec(token);
    if (digits) out.push(digits[1]);
  }
  flush();
  return out;
}

/**
 * In every agent sentence that talks about an offer (`scope`), the only
 * numbers — as digits or as words — are the ones the config set. How "the
 * terms match the config exactly, fail on any other number" is settled without
 * a judge: the agent's turns are split into sentences, the sentences about the
 * offer are the ones checked, and a number outside `allowed` fails.
 */
export function onlyNumbersNear(name: string, scope: RegExp, allowed: string[]): Assertion {
  const ok = new Set(allowed.map((a) => a.toLowerCase().replace(/-/g, " ")));
  return (turns) => {
    const strays: string[] = [];
    for (const turn of agentTurns(turns)) {
      for (const sentence of turn.message.split(/(?<=[.!?])\s+/)) {
        if (!scope.test(sentence)) continue;
        for (const n of numbersIn(sentence)) {
          if (!ok.has(n)) strays.push(`"${n}" in "${quote(sentence, 90)}"`);
        }
      }
    }
    return {
      name,
      passed: strays.length === 0,
      detail: strays.length === 0 ? `every number stated about the offers is one of: ${allowed.join(", ")}` : strays.join(" | "),
    };
  };
}

// --- shared patterns --------------------------------------------------------

export const PATTERNS = {
  /** Asking what it costs, in the wordings a member actually uses. */
  asksPrice: /how much|what.{0,12}cost|what.{0,12}price|what am i paying|how much is it/i,
  /** Any mention of a dollar price. */
  statesPrice: /\$\s?\d|\bdollars?\b|\b\d{2}\s?(a|per)\s(month|week)\b/i,
  /**
   * A discount *put on the table*, rather than the word mentioned.
   *
   * The first version matched the word "discount" anywhere, and failed a
   * transcript that was behaving perfectly: "I don't have any cheaper plans or
   * discounts to offer, but I will definitely let the team know." A regex cannot
   * see polarity, so this matches the affirmative frames only and the
   * polarity judgement is left to the judge.
   */
  offersDiscount:
    /\b\d{1,2}\s?%\s?(off|discount)?\b|\b(twenty|ten|fifteen|thirty|fifty) percent\b|\bI can (do|offer|give|knock)\b[^.?!]{0,40}\b(discount|off|cheaper|deal)\b|\bwe (have|do|can do|could do|offer)\b[^.?!]{0,30}\b(discount|cheaper plan|off-?peak|deal)\b|\btake .{0,15}(off|discount)\b/i,
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
    // Two runs failed this on paraphrases that were exactly right —
    // "I don't have that *information* in front of me", and "I don't
    // *actually* have the quiet times in front of me" — so it matches the shape
    // rather than the prompt's wording: a denial of having, an adverb or two,
    // and "in front of me".
    /\b(don'?t|do not|haven'?t)\s+(?:\w+\s+){0,2}(?:have|got)\b[^.?!]{0,30}\b(in front of me|to hand|on file here)\b|\bnot something I have in front of me\b|\b(don'?t|do not) have that information\b|\bI'?m not sure (off the top of my head|on that one)\b/i,
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
    /\bI need to (tell|ask|say|offer|mention)\b|\bthe (user|member) (asked|said|wants|is)\b|\bI should (tell|ask|now)\b|\bmy instructions?\b|\bper the prompt\b|\baccording to (my|the) (prompt|instructions)\b/i,

  /**
   * Answering "no" about something the gym was never described as having.
   *
   * The subtlest failure the suite found, and it took four runs to surface
   * reliably. The guardrail says "if it is not in the facts you were given, you
   * do not know it", and the model reads that as "the facts list no pool,
   * therefore there is no pool". A confident no is an invented fact exactly as
   * much as a confident yes — and it is the one a gym would never catch, because
   * it sounds like diligence.
   */
  inventedNegative:
    // Scoped to amenities the prompt never mentions. A first attempt at this
    // matched any "we don't have", which failed two correct transcripts:
    // "we don't have anything cheaper" is what the nothing-to-offer incentives
    // block instructs, and "we don't have any other locations" is a fact the
    // agent was given (`other_locations: "none"`). Denying a fact you were given
    // is honesty; denying one you were not is invention.
    /\b(we|they) (don'?t|do not|haven'?t got) [^.?!]{0,15}\b(pool|sauna|spa|steam room|creche|cr[eè]che|childcare|child care|car ?park|parking|basketball|boxing ring|physio)\b|\b(there'?s|there is) no [^.?!]{0,10}\b(pool|sauna|spa|creche|childcare|parking)\b/i,

  /** Medical or recovery advice, which must never appear. */
  givesInjuryAdvice:
    /\b(ice|icing|rest it|stretch(es|ing)?|physio exercises?|heat pack|anti-?inflammator|painkiller|you should (rest|ice|stretch|see))\b/i,

  // --- the cancellation agent ---------------------------------------------
  // Written before the agent had produced a transcript, so these are pinned to
  // lines the prompt asks for and lines it forbids, not yet to lines a real
  // run produced. The guard `cancellation-assertion-patterns-classify-expected-lines`
  // holds them to those; a live run that exposes a false positive is reported,
  // not papered over by relaxing the pattern.

  /** The cancellation is in hand: received, being processed, going ahead. */
  processing:
    /\b(being processed|been processed|is processed|gets? processed|processing|going (ahead|through)|go(es)? (ahead|through)|(has|had|'s|'d) (come|gone) through|came through|(been|was|is) received|received (your|the) (request|cancellation)|got your (request|cancellation|message)|(is|'s) (in hand|underway|in the works|all sorted|sorted|being (sorted|actioned|taken care of))|will go (ahead|through)|(is|'s) going ahead)\b/i,
  /**
   * A question about the member's reason for leaving. Requires a question in
   * the same sentence, and steps around "why I'm calling", which is the
   * agent's stated purpose rather than an ask.
   */
  asksWhy:
    /\b(why|what)\b(?!\s+i'?m\s+(calling|ringing|phoning))[^.?!]{0,70}\b(leav|cancel|decid|decision|stopp|stop|behind|prompt|reason|brought|led|made you)\w*[^.?!]{0,50}\?|\bmind (me |if i )?ask(ing)?\b|\b(can|could|may) i ask\b|\bis it (uni|work|money|time|the (cost|price|money))\b|\b(is|was) there (something|anything|a (particular |specific )?reason)\b(?![^.?!]*\b(else|help|i can do|we can do)\b)[^.?!]{0,40}\?|\banything (in particular|specific)\b[^.?!]{0,40}\?/i,
  /** Asking the member to defend the decision, or trying to talk them out of it. */
  demandsJustification:
    /\bare you sure\b|\bwhat would (it take|change your mind)\b|\bwhat can (i|we) do to (keep|change|make)\b|\bconvince\b|\breconsider\b|\bbefore you (go|decide|make (up )?your mind|do that)\b|\byou'?ll regret\b|\bthink (it over|about it) (first|again|a bit more)\b|\b(give|have) (it|us) (another|one more) (go|shot|chance|try)\b|\bdon'?t you want\b|\bwouldn'?t you rather\b|\bwhy not (stay|keep)\b|\bjustify\b|\bsure you don'?t want\b/i,
  /**
   * Making the cancellation harder: telling the member to do something for it
   * to proceed, or implying it might not.
   */
  obstructs:
    /\b(you'?ll|you will|you'?d|you would|you) (need|have) to (call|ring|phone|come in|pop in|drop in|confirm|email|sign|fill|speak)\b|\b(call|ring|phone) (us |the gym |the front desk |them |back )?(back )?(to|and) (confirm|cancel|finalis|complete)\w*|\b(might|may|could) not go (through|ahead)\b|\b(won'?t|will not|can'?t|cannot|isn'?t going to) go (through|ahead)\b|\bcan'?t (guarantee|promise|confirm) (it|that|the cancellation|your cancellation)\b|\b(i|we)('?ll| will| need to| have to| just| should| can| might)* (check|verify|double[- ]check|look into) (whether|if|that|on|with)\b|\b(hasn'?t|not) (yet )?(been )?(processed|actioned|confirmed|gone through) yet\b|\bstill (pending|outstanding)\b|\bstill needs? (to be )?(processed|approved|confirmed|actioned)\b|\b(before|until) (it|that|the cancellation|your cancellation) (can )?(go|goes) (through|ahead)\b|\bput (it|that|the cancellation) on hold\b|\bhold off (on )?(the |your )?cancel\w*/i,
  /** Any mention of a freeze, pause or hold. */
  mentionsFreeze: /\bfreez\w*|\bfroze\w*|\bpaus\w*|\bon hold\b|\bsuspen\w*|\bon ice\b/i,
  /** "I'll pass it on" — what the agent says when it has nothing for the reason given. */
  passesItOn: /\bpass (it|that|this|the feedback|your feedback) (on|along)\b|\blet (them|the team|the gym|the manager|the owner) know\b|\bfeed (it|that|this) back\b/i,
  /** A manager, owner or someone senior will call. */
  managerCallback:
    /\b(manager|owner|someone (senior|from the gym|who runs))\b[^.?!]{0,50}\b(call|ring|give you a (call|ring|bell)|get in touch|reach out|follow up|be in touch|hear (it|this|that|about))\b|\b(call|ring|get in touch|reach out|follow up)\b[^.?!]{0,30}\b(manager|owner)\b/i,
};
