export type Quadrant = "persuadable" | "sure_thing" | "lost_cause" | "sleeping_dog";

export type Cohort = "new_joiner" | "sliding" | "sleeping_dog" | "winback" | "steady";

export type Channel = "staff" | "ai_call" | null;

export interface Signals {
  days_since_visit: number;
  old_rate: number;
  tenure_days: number;
}

export interface Member {
  member_id: string;
  name: string;
  phone: string;
  cohort: Cohort;
  uplift: number;
  quadrant: Quadrant;
  contact: boolean;
  channel: Channel;
  action: string;
  reason: string;
  signals: Signals;
  // only present for winback members — feeds the /api/call payload
  last_visit?: string;
  expiry?: string;
  offer?: string;
}

// Matches the call_records table (Dan -> Jesslyn contract, Section 1.3/1.6)
export type CallStatus = "not_started" | "initiated" | "completed" | "failed";
export type CallOutcome = "rebooked" | "callback" | "not_interested" | null;

export interface CallRecord {
  id: string;
  member_id: string;
  status: CallStatus;
  conversation_id?: string;
  transcript: string | null;
  outcome: CallOutcome;
  created_at: string;
}
