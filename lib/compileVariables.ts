import type { CallType, Routing } from "@/lib/callType";
import { today } from "@/lib/clock";
import type { GymFields } from "@/lib/gymConfig";
import { incentivesFor, type Gym } from "@/lib/gyms";
import type { Member } from "@/lib/types";

/**
 * The one place where the app's vocabulary becomes the agent's vocabulary.
 *
 * Inside the app, names are the pipeline's: `signals.days_since_visit`,
 * `old_rate`, `tenure_days`, `expiry_date`, `renewal_fee`. At the ElevenLabs
 * boundary they are the prompt's: `last_visit`, `tenure`, `time_left`,
 * `context`, `renewal_price`. That translation happens here and nowhere else,
 * so a prompt-variable rename touches one file. The mirror of this module is
 * the webhook, which translates the agent's data-collection field names back
 * into columns.
 *
 * Two design decisions worth the words:
 *
 * **Compiled plain English, not conditionals in the prompt.** Every gym rule
 * reaches the call as a finished sentence — `expiry_line` either tells the
 * agent to raise the expiry or forbids it; `incentives` either hands it a
 * discount or closes the door. The prompt contains no `if`. The gym's rules
 * change, the prompt does not, and one prompt per call type serves every gym.
 *
 * **Compiled at call time, not in the pipeline.** `time_left` and
 * `attempt_number` depend on the reference date and on live call history in
 * Supabase; the offline pipeline has neither. It emits raw facts and this
 * module turns them into speech.
 */

// --- Formatters -------------------------------------------------------------

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "dame", "rev"]);
const SUFFIXES = new Set(["phd", "md", "jr", "snr", "sr", "ii", "iii", "iv", "dvm", "dds", "esq"]);

/**
 * First name only, which is the first thing the agent says out loud.
 * Faker's Australian names include 19 titles and suffixes in this dataset
 * ("Dr. Jordan Hill PhD"), and "Hi, is that Dr.?" ends a call before it starts.
 */
export function firstName(fullName: string, fallback = "there"): string {
  const tokens = fullName
    .split(/\s+/)
    .map((t) => t.replace(/[.,]/g, ""))
    .filter((t) => t.length > 0)
    .filter((t) => !TITLES.has(t.toLowerCase()) && !SUFFIXES.has(t.toLowerCase()));
  return tokens[0] ?? fallback;
}

/**
 * Numbers are spelled out up to twenty. Everything in this module is read aloud
 * by a text-to-speech model, and "3" is a coin toss between "three" and "third"
 * depending on what follows it. Above twenty the words get clumsier than the
 * digits, and the agent is not saying those numbers often.
 */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];

function spell(n: number): string {
  return n >= 0 && n <= 20 ? NUMBER_WORDS[n] : String(n);
}

function plural(n: number, word: string): string {
  return `${spell(n)} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * A span of time as a duration: "twelve days", "five weeks", "two months".
 * The unit steps up as the span grows, because nobody says "sixty-three days".
 */
function formatSpan(days: number): string {
  if (days <= 0) return "no time at all";
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  const months = Math.round(days / 30);
  if (months < 24) return plural(months, "month");
  return plural(Math.round(months / 12), "year");
}

function spelledDays(days: number): string {
  if (days <= 0) return "today";
  return plural(days, "day");
}

/** "eight months" / "three weeks" — how long they have been a member. */
export function formatTenure(tenureDays: number): string {
  return formatSpan(tenureDays);
}

/** "five weeks" — how long they have been away, as a duration. */
export function formatAbsence(days: number): string {
  return formatSpan(days);
}

/** "five weeks ago" — when they last came in, as a point in the past. */
export function formatLastVisit(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${formatSpan(days)} ago`;
}

/** "14 March" — no year, the way someone says a date on the phone. */
export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en-AU", { month: "long", timeZone: "UTC" });
  return `${day} ${month}`;
}

/** "about three times a week" — the habit they had before they stopped. */
export function formatHabit(oldRate: number): string {
  const rounded = Math.round(oldRate);
  if (oldRate < 0.5) return "only now and then";
  if (rounded <= 1) return "about once a week";
  if (rounded === 2) return "about twice a week";
  return `about ${spell(rounded)} times a week`;
}

/** "$79 a month" — what renewing actually costs this member today. */
export function formatPrice(fee: number): string {
  return `$${fee} a month`;
}

// --- The compiled variables -------------------------------------------------

/**
 * `time_left`.
 *
 * Renewal and reengagement read it forwards ("it ends in {{time_left}}"), so
 * the value is a duration: "twelve days". The winback prompt reads it as
 * "Their membership expired {{time_left}}", so the value is a point in the
 * past: "three weeks ago" — *without* the word "expired", which the brief's
 * example value carried and which would have produced "expired expired three
 * weeks ago". The word stays in the prompt and comes out of the value.
 */
export function compileTimeLeft(callType: CallType, daysToExpiry: number): string {
  if (callType === "winback") {
    return `${formatSpan(Math.max(1, -daysToExpiry))} ago`;
  }
  return spelledDays(daysToExpiry);
}

/** More than a month left on the membership and the absence is the subject. */
const EXPIRY_LINE_FAR = `Do not bring up their expiry date or how much time is left on the membership.
There is no deadline here and mentioning one tells them there's no rush. If they
ask directly, answer honestly.`;

/**
 * A month or less. The brief's version of this block contains a literal
 * `{{time_left}}` inside the variable's own value; ElevenLabs substitutes
 * dynamic variables into the prompt once and does not re-scan the values it
 * just inserted, so the placeholder would have been read out verbatim. The
 * compiler inlines it here instead.
 */
function expiryLineNear(timeLeft: string): string {
  return `Once they have agreed to come in, mention once that the membership ends in ${timeLeft} and the front desk can sort the renewal while they're there. Say
it as a heads-up, not a pitch. If they declined coming in, still tell them the
date so they know, then end the call. Do not turn it into a second ask.`;
}

/** Threshold between the two expiry_line variants, in days. */
const EXPIRY_LINE_NEAR_DAYS = 30;

export function compileExpiryLine(daysToExpiry: number, timeLeft: string): string {
  return daysToExpiry <= EXPIRY_LINE_NEAR_DAYS ? expiryLineNear(timeLeft) : EXPIRY_LINE_FAR;
}

/**
 * `context` — the member's situation as two or three plain sentences.
 *
 * The brief supplies one example, for an absent member. The other two are
 * written here: a renewal member has not stopped coming, and a winback
 * member's membership is not "live until" anything.
 *
 * `priorCall` is the closed loop: if a previous conversation already extracted
 * why they stopped, say so, so the agent does not ask a question it has the
 * answer to.
 */
export interface PriorCallContext {
  reason_for_absence?: string | null;
  reason_detail?: string | null;
  committed_day?: string | null;
  outcome?: string | null;
  offer_made?: boolean | null;
}

export function compileContext(
  callType: CallType,
  member: Member,
  priorCall?: PriorCallContext | null
): string {
  const sentences: string[] = [];
  const expiry = formatDate(member.expiry_date);
  const habit = formatHabit(member.signals.old_rate);
  const awayFor = formatAbsence(member.signals.days_since_visit);
  const lastIn = formatLastVisit(member.signals.days_since_visit);

  if (callType === "renewal") {
    sentences.push(
      `Their membership is live until ${expiry} and won't auto-renew.`,
      `They're still coming in, ${habit}.`
    );
  } else if (callType === "reengagement") {
    sentences.push(
      `Their membership is live until ${expiry} and won't auto-renew.`,
      `They've not been in for ${awayFor}.`,
      `Before that they came ${habit}.`
    );
  } else {
    sentences.push(
      `Their membership ended on ${expiry} and was never renewed.`,
      `They'd stopped coming before that — their last visit was ${lastIn}.`,
      `When they were training they came ${habit}.`
    );
  }

  sentences.push(...priorCallSentences(priorCall));
  return sentences.join(" ");
}

function priorCallSentences(priorCall?: PriorCallContext | null): string[] {
  if (!priorCall) return [];
  const out: string[] = [];
  const reason = priorCall.reason_for_absence;
  if (reason && reason !== "none_given") {
    const detail = priorCall.reason_detail?.trim();
    // "Is anything else stopping you?" is the same question with a hat on, and
    // the first eval run caught it being asked that way. Naming it explicitly is
    // cheaper than hoping the agent generalises.
    const doNotReask =
      "Do not ask why they stopped, and do not ask whether anything else is stopping them — " +
      "that is the same question. Acknowledge what you already know and move on to the ask.";
    out.push(
      detail
        ? `You already know why they stopped: ${reason}. They said "${detail}". ${doNotReask}`
        : `You already know why they stopped: ${reason}. ${doNotReask}`
    );
  }
  if (priorCall.committed_day?.trim()) {
    out.push(
      `On the last call they said they'd come in on ${priorCall.committed_day.trim()} and did not. Do not hold it against them and do not mention it as a broken promise.`
    );
  }
  if (priorCall.offer_made) {
    out.push("They have already heard your offer once. Do not re-pitch it.");
  }
  return out;
}

// --- The payload ------------------------------------------------------------

/**
 * Every variable the three prompts reference, with a default for each. A
 * missing variable must degrade to a sentence the agent can say, never fail the
 * call — which is why the defaults are phrases and not empty strings.
 *
 * `NOT_RECORDED` is also what a gym's blank opening hours or quiet times compile
 * to. It is an absence the agent is told to admit, not a value it can
 * paraphrase: the first eval run caught an agent inventing quiet times when the
 * placeholder read like a fact, and the `unanswered-gym-question-degrades`
 * scenario has asserted this exact string against the live agent since.
 */
export const NOT_RECORDED = "not recorded — tell them you don't have that in front of me";

export const VARIABLE_DEFAULTS: Record<string, string> = {
  member_name: "there",
  member_id: "unknown",
  tenure: "a while",
  last_visit: "a while ago",
  time_left: "soon",
  context: "",
  attempt_number: "1",
  renewal_price: NOT_RECORDED,
  expiry_line: EXPIRY_LINE_FAR,
  gym_name: "the gym",
  opening_hours: NOT_RECORDED,
  quiet_hours: NOT_RECORDED,
  other_locations: "none",
  has_online: "no",
  books_classes: "no",
  incentives:
    "You have nothing to offer. Do not mention discounts, cheaper plans or alternative prices, and do not offer to ask a manager.",
};

/** "Brisbane CBD and Fortitude Valley"; "none" for a single site or a blank field. */
export function formatLocations(locations: string[] | null): string {
  if (!locations || locations.length === 0) return "none";
  if (locations.length === 1) return locations[0];
  return `${locations.slice(0, -1).join(", ")} and ${locations[locations.length - 1]}`;
}

/**
 * The gym facts the Environment section lists, from typed config.
 *
 * Blank fields do not become plausible values. Opening hours, quiet times and
 * online training the gym never gave compile to `NOT_RECORDED`, which tells the
 * agent to admit it doesn't have them — "no online training" is a fact about a
 * business, and nobody stated it. Two blanks compile to the literal words the
 * prompts branch on, because anything else would be worse:
 *
 * - `other_locations` → "none". The winback prompt says to mention the nearest
 *   site when this is not "none"; an absence sentence there would send the agent
 *   looking for a site it was never given.
 * - `books_classes` → "no". It describes what the agent can do for the member,
 *   not a fact about the gym, and the prompt only offers a booking on "yes".
 */
export function compileGymFacts(gym: GymFields): {
  gym_name: string;
  opening_hours: string;
  quiet_hours: string;
  other_locations: string;
  has_online: string;
  books_classes: "yes" | "no";
} {
  return {
    gym_name: gym.gym_name,
    opening_hours: gym.opening_hours ?? NOT_RECORDED,
    quiet_hours: gym.quiet_hours ?? NOT_RECORDED,
    other_locations: formatLocations(gym.other_locations),
    has_online: gym.has_online === null ? NOT_RECORDED : gym.has_online ? "yes" : "no",
    books_classes: gym.books_classes === true ? "yes" : "no",
  };
}

/**
 * Sentences about the gym that belong in `context` because the prompt cannot
 * branch on them. Empty for any gym that gave the facts involved, so the two
 * seed gyms' payloads are unchanged.
 *
 * The winback prompt suggests "the quiet times" when time or routine is why a
 * member stopped. A gym that never gave its quiet times would have the agent
 * offering something it doesn't have, so the compiler tells it not to, in the
 * same finished-sentence form as every other call-time instruction.
 */
export function gymContextSentences(gym: GymFields, callType: CallType): string[] {
  if (callType === "winback" && gym.quiet_hours === null) {
    return [
      "You don't have this gym's quiet times. If time or routine is why they stopped, suggest shorter sessions and don't mention quiet times.",
    ];
  }
  return [];
}

export interface CompileInput {
  member: Member;
  gym: Gym;
  routing: Routing;
  callType: CallType;
  attemptNumber?: number;
  priorCall?: PriorCallContext | null;
  asOf?: Date;
}

/**
 * The dynamic_variables payload, in the prompt's vocabulary.
 *
 * Values are strings throughout: ElevenLabs substitutes them into the prompt as
 * text, and a number that arrives as a number still lands as text — sending
 * strings keeps what the agent reads identical to what is logged here.
 */
export function compileVariables(input: CompileInput): Record<string, string> {
  const { member, gym, routing, callType, attemptNumber = 1, priorCall, asOf } = input;
  void asOf; // routing already carries the date arithmetic; kept for symmetry

  const timeLeft = compileTimeLeft(callType, routing.days_to_expiry);

  return {
    ...VARIABLE_DEFAULTS,
    member_name: firstName(member.name),
    member_id: member.member_id,
    tenure: formatTenure(member.signals.tenure_days),
    last_visit: formatLastVisit(member.signals.days_since_visit),
    time_left: timeLeft,
    context: [compileContext(callType, member, priorCall), ...gymContextSentences(gym, callType)].join(" "),
    attempt_number: String(attemptNumber),
    renewal_price: formatPrice(member.renewal_fee),
    expiry_line: compileExpiryLine(routing.days_to_expiry, timeLeft),
    ...compileGymFacts(gym),
    incentives: incentivesFor(gym, callType),
  };
}

/** Reference date used by callers that want to log what "today" meant. */
export function referenceDate(): string {
  return today().toISOString().slice(0, 10);
}
