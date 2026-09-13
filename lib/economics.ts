/**
 * Owns: per-call cost, a saved member's value and break-even conversion, with every assumption named.
 * Not here: the queue those figures are computed over, which lib/queueView.ts and lib/intelligence.ts build.
 */
import type { Member } from "@/lib/types";

/**
 * What a call costs and what a saved member is worth.
 *
 * Every assumption is a named constant with its source, and all of them are sent
 * to the dashboard so they appear on screen next to the numbers they produce. An
 * unaudited ROI figure in a pitch is worth nothing; an auditable one is worth
 * arguing about.
 *
 * The number that does the real work here is the **break-even conversion rate**.
 * It needs no guess about how often a call succeeds — it says what the success
 * rate would have to be for the campaign to pay for itself, and lets the reader
 * decide whether that is plausible. Everything downstream of a guessed
 * conversion rate is a guess; this is arithmetic.
 */

export interface Assumption {
  key: string;
  label: string;
  value: string;
  source: string;
}

/** ElevenLabs Conversational AI, per minute, on the Pro tier's published rate. */
const ELEVENLABS_PER_MINUTE = 0.1;
/** Twilio outbound voice, US number to an Australian mobile, per minute. */
const TWILIO_PER_MINUTE = 0.055;
/**
 * Average call length. The prompts target under three minutes and the agents cap
 * at four; the simulated conversations run 9-17 turns, which is around two and a
 * half minutes of speech. Measured properly this becomes a real average.
 */
const AVERAGE_CALL_MINUTES = 2.5;
/** One SMS to an Australian mobile, when a link is sent. */
const SMS_COST = 0.0515;
/** Share of calls that send a link, and therefore incur the SMS. */
const SMS_SHARE = 0.35;

/**
 * How much longer a saved member stays. Six months is deliberately conservative:
 * the dataset's members have a median tenure well past that, so a member who
 * renews once is assumed to last only until their next decision point rather
 * than indefinitely.
 */
const RETAINED_MONTHS = 6;

export const COST_PER_CALL =
  (ELEVENLABS_PER_MINUTE + TWILIO_PER_MINUTE) * AVERAGE_CALL_MINUTES + SMS_COST * SMS_SHARE;

export const ASSUMPTIONS: Assumption[] = [
  {
    key: "elevenlabs",
    label: "Voice agent",
    value: `$${ELEVENLABS_PER_MINUTE.toFixed(2)}/min`,
    source: "ElevenLabs Conversational AI, Pro tier published rate",
  },
  {
    key: "twilio",
    label: "Telephony",
    value: `$${TWILIO_PER_MINUTE.toFixed(3)}/min`,
    source: "Twilio outbound voice, US number to an Australian mobile",
  },
  {
    key: "duration",
    label: "Average call",
    value: `${AVERAGE_CALL_MINUTES} min`,
    source: "Estimated from the simulated conversations; the prompts target under three minutes and the agents hard-stop at four",
  },
  {
    key: "sms",
    label: "Text message",
    value: `$${SMS_COST.toFixed(4)} on ${Math.round(SMS_SHARE * 100)}% of calls`,
    source: "Twilio SMS to an Australian mobile, applied to the share of calls that send a link",
  },
  {
    key: "retained_months",
    label: "A saved member stays",
    value: `${RETAINED_MONTHS} more months`,
    source: "Deliberately conservative — one renewal cycle, not an indefinite life",
  },
];

export interface MemberValue {
  member_id: string;
  monthly_fee: number;
  /** Revenue if this member is retained for `RETAINED_MONTHS`. */
  retained_value: number;
}

export function memberValue(member: Member): MemberValue {
  return {
    member_id: member.member_id,
    monthly_fee: member.monthly_fee,
    retained_value: member.monthly_fee * RETAINED_MONTHS,
  };
}

export interface CampaignEconomics {
  calls: number;
  cost_per_call: number;
  total_cost: number;
  /** Average retained value across the members actually in the queue. */
  average_retained_value: number;
  total_value_if_all_saved: number;
  /**
   * The share of calls that would have to result in a save for the campaign to
   * cover its own cost. No conversion assumption goes into it.
   */
  break_even_conversion: number;
  /** Saves needed to break even, rounded up. */
  break_even_saves: number;
  retained_months: number;
}

export function campaignEconomics(queue: Member[]): CampaignEconomics {
  const calls = queue.length;
  const totalCost = calls * COST_PER_CALL;
  const values = queue.map((m) => memberValue(m).retained_value);
  const totalValue = values.reduce((a, b) => a + b, 0);
  const averageValue = calls > 0 ? totalValue / calls : 0;

  return {
    calls,
    cost_per_call: round(COST_PER_CALL, 4),
    total_cost: round(totalCost, 2),
    average_retained_value: round(averageValue, 2),
    total_value_if_all_saved: round(totalValue, 2),
    break_even_conversion: averageValue > 0 ? round(COST_PER_CALL / averageValue, 6) : 0,
    break_even_saves: totalValue > 0 ? Math.ceil(totalCost / averageValue) : 0,
    retained_months: RETAINED_MONTHS,
  };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Tenure bands, for the churn breakdown. Short tenure churns differently. */
export function tenureBand(tenureDays: number): string {
  if (tenureDays < 90) return "under 3 months";
  if (tenureDays < 180) return "3-6 months";
  if (tenureDays < 365) return "6-12 months";
  if (tenureDays < 730) return "1-2 years";
  return "over 2 years";
}

export const TENURE_BANDS = [
  "under 3 months",
  "3-6 months",
  "6-12 months",
  "1-2 years",
  "over 2 years",
];
