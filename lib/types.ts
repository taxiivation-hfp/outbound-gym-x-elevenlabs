/**
 * Owns: the shared shapes of a scored Member and a call_records row, with their enums.
 * Not here: gym config types live in lib/gymConfig.ts; CallType itself is defined in lib/callType.ts.
 */
import type { CallType } from "@/lib/callType";

export type Cohort = "new_joiner" | "sliding" | "sleeping_dog" | "winback" | "steady";

export type Channel = "staff" | "ai_call" | null;

export type ContractType = "month-to-month" | "6-month" | "12-month";

export type ContractStatus = "active" | "expired";

export interface Signals {
  days_since_visit: number;
  old_rate: number;
  tenure_days: number;
  visit_count_90d: number;
}

/**
 * One member as the offline pipeline emits them: raw facts only. Every
 * plain-English phrase the voice agent hears is compiled from these at call
 * time in `lib/compileVariables.ts`, and which agent to dial is derived in
 * `lib/callType.ts`.
 */
export interface Member {
  member_id: string;
  name: string;
  phone: string;
  /** Router output. Explains the member; does not decide the call. */
  cohort: Cohort;
  contact: boolean;
  channel: Channel;
  action: string;
  reason: string;
  /** The hard exclusion. True → never called, at any point, however absent. */
  auto_renew: boolean;
  /**
   * The plan's name. The synthetic dataset uses the three `ContractType`
   * values; an uploaded export carries whatever the platform calls its plans.
   * Nothing routes on it — routing reads `auto_renew` and the dates.
   */
  contract_type: ContractType | string;
  contract_status: ContractStatus;
  /** ISO `YYYY-MM-DD`. Present for every member — all three triggers date off it. */
  expiry_date: string;
  /** What they pay today. */
  monthly_fee: number;
  /**
   * What renewing costs them today, which is not always what they pay now. Null
   * when an uploaded export didn't say — the agent is then told it doesn't have
   * the renewal price, rather than being handed the monthly fee as a guess.
   */
  renewal_fee: number | null;
  /**
   * When the member asked to cancel, as local gym time (`YYYY-MM-DDTHH:MM:SS`),
   * or null for no request. Visibility only for now: nothing routes on it, and
   * an auto-renewing member who has asked is still never called — a guard pins
   * that until the path for them is built.
   */
  cancellation_requested: string | null;
  signals: Signals;
}

/**
 * `status` is the plumbing state machine: did ElevenLabs deliver a transcript.
 * `outcome` is what the conversation achieved, extracted afterwards by the
 * agent's own analysis. They are independent — `status: "failed"` means no
 * transcript ever arrived, while `outcome: "no_answer"` means one did and it
 * showed nobody picked up. Both can be true of different calls to one member.
 */
export type CallStatus = "not_started" | "initiated" | "completed" | "failed";

/**
 * The ten values the agents extract, furthest point reached. Set on the agents
 * as an enum in `scripts/agentConfig.mjs`; the column is deliberately
 * unconstrained so an unexpected extraction is recorded rather than dropped.
 */
export type CallOutcome =
  | "renewed"
  | "link_sent"
  | "booked"
  | "will_return"
  | "callback_requested"
  | "not_interested"
  | "do_not_contact"
  | "bad_time"
  | "wrong_number"
  | "no_answer"
  | null;

export type ReasonForAbsence =
  | "time"
  | "money"
  | "injury"
  | "motivation"
  | "moved"
  | "gym_issue"
  | "none_given"
  | "other";

export type Sentiment = "positive" | "neutral" | "negative";

/** 'success' | 'failure' | 'unknown', as ElevenLabs reports its criteria. */
export type EvalResult = string | null;

/** One row of `call_records`. See supabase/migrations/ for the column comments. */
export interface CallRecord {
  id: string;
  member_id: string;
  member_name?: string | null;
  status: CallStatus;
  conversation_id?: string;
  call_type?: CallType | null;
  attempt_number?: number | null;
  gym_id?: string | null;
  transcript: string | null;
  outcome: CallOutcome;

  reached_member?: boolean | null;
  reason_for_absence?: ReasonForAbsence | string | null;
  reason_detail?: string | null;
  committed_day?: string | null;
  offer_made?: boolean | null;
  offer_accepted?: boolean | null;
  link_sent?: boolean | null;
  do_not_contact?: boolean | null;
  human_followup?: string | null;
  sentiment?: Sentiment | string | null;

  eval_stuck_to_one_ask?: EvalResult;
  eval_invented_nothing?: EvalResult;
  eval_no_guilt?: EvalResult;

  analysis?: unknown;
  created_at: string;
  completed_at?: string | null;
}
