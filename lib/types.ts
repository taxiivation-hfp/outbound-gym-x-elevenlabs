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
