import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PriorCallContext } from "@/lib/compileVariables";
import { SCHEDULABLE_OFFERS, type SchedulableOffer } from "@/lib/gymConfig";

/**
 * What previous calls to a member mean for the next one.
 *
 * This is the half of the product that makes it more than a dialer: a second
 * call is not a repeat of the first. It knows which conversation this is, it
 * does not re-ask a question the last call answered, and it will not ring
 * someone who asked to be left alone.
 *
 * Read with `select("*")` rather than a column list, on purpose: the analysis
 * columns arrive in a migration, and a dashboard that 500s because a column is
 * one deploy behind is worse than one that shows a member as attempt 1.
 */

export interface CallHistory {
  /** Which conversation the next call will be. Dials that reached nobody don't count. */
  attemptNumber: number;
  /** Permanent. Any single call where the member asked to stop blocks all future calls. */
  doNotContact: boolean;
  /** Total dials, including the ones nobody answered. */
  dialCount: number;
  /** When the most recent dial went out. */
  lastCallAt: string | null;
  /** When the member last actually spoke to the agent. */
  lastConversationAt: string | null;
  /** Outcome of the most recent call that reached the member. */
  lastOutcome: string | null;
  /** Did any call get them back through the door? Resets the cooldown. */
  cameBackAfterCall: boolean;
  /** What the last real conversation established, folded into the next `context`. */
  priorCall: PriorCallContext | null;
  /**
   * When each type of offer was last made to this member, from conversations
   * where the analysis says an offer was made. What the offer schedule's
   * cooldowns are measured from.
   */
  offersLastMade: Partial<Record<SchedulableOffer, string>>;
}

export const NO_HISTORY: CallHistory = {
  attemptNumber: 1,
  doNotContact: false,
  dialCount: 0,
  lastCallAt: null,
  lastConversationAt: null,
  lastOutcome: null,
  cameBackAfterCall: false,
  priorCall: null,
  offersLastMade: {},
};

interface RawRow {
  member_id?: string;
  status?: string | null;
  created_at?: string | null;
  outcome?: string | null;
  reached_member?: boolean | null;
  do_not_contact?: boolean | null;
  reason_for_absence?: string | null;
  reason_detail?: string | null;
  committed_day?: string | null;
  offer_made?: boolean | null;
  transcript?: string | null;
  call_type?: string | null;
  offers_available?: string[] | null;
}

/**
 * A dial counts as a conversation when the analysis says the member spoke. On
 * rows written before `reached_member` existed, fall back to "the call completed
 * and produced a transcript", which is the same claim with less confidence.
 */
function reachedMember(row: RawRow): boolean {
  if (typeof row.reached_member === "boolean") return row.reached_member;
  return row.status === "completed" && Boolean(row.transcript);
}

/**
 * What a call type's block can grant, for a record that predates
 * `offers_available`. Every offer the call type could have carried counts as
 * made, so an old record can only make a cooldown longer, never skip one.
 */
const OFFERS_BY_CALL_TYPE: Record<string, SchedulableOffer[]> = {
  renewal: ["renewal_discount"],
  reengagement: ["guest_pass", "free_session"],
  winback: ["free_pt_session", "guest_pass", "cheaper_tier"],
};

/**
 * The offers a conversation made. `offers_available` is what the compiled block
 * granted, recorded by `/api/call` before dialling; when the agent made an
 * offer on a block with two (a winback PT session and a cheaper tier), both are
 * spent, because the analysis doesn't say which one it was.
 */
export function offersMade(row: RawRow): SchedulableOffer[] {
  if (row.offer_made !== true) return [];
  if (Array.isArray(row.offers_available)) {
    return row.offers_available.filter((o): o is SchedulableOffer => (SCHEDULABLE_OFFERS as readonly string[]).includes(o));
  }
  return OFFERS_BY_CALL_TYPE[row.call_type ?? ""] ?? [...SCHEDULABLE_OFFERS];
}

/** Outcomes that mean the call worked: they came in, or committed to. */
const CAME_BACK_OUTCOMES = new Set(["booked", "will_return", "renewed", "link_sent"]);

export function summarise(rows: RawRow[]): CallHistory {
  if (rows.length === 0) return NO_HISTORY;

  // Newest first.
  const sorted = [...rows].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? "")
  );
  const conversations = sorted.filter(reachedMember);
  const lastConversation = conversations[0] ?? null;

  const priorCall: PriorCallContext | null = lastConversation
    ? {
        reason_for_absence: lastConversation.reason_for_absence ?? null,
        reason_detail: lastConversation.reason_detail ?? null,
        committed_day: lastConversation.committed_day ?? null,
        outcome: lastConversation.outcome ?? null,
        offer_made: lastConversation.offer_made ?? null,
      }
    : null;

  return {
    // The next call is one past however many conversations have happened.
    attemptNumber: conversations.length + 1,
    doNotContact: sorted.some(
      (r) => r.do_not_contact === true || r.outcome === "do_not_contact"
    ),
    dialCount: sorted.length,
    lastCallAt: sorted[0]?.created_at ?? null,
    lastConversationAt: lastConversation?.created_at ?? null,
    lastOutcome: lastConversation?.outcome ?? null,
    cameBackAfterCall: conversations.some((r) =>
      CAME_BACK_OUTCOMES.has(r.outcome ?? "")
    ),
    priorCall,
    offersLastMade: lastMade(conversations),
  };
}

function lastMade(conversations: RawRow[]): Partial<Record<SchedulableOffer, string>> {
  const out: Partial<Record<SchedulableOffer, string>> = {};
  // Newest first, so the first time an offer is seen is the latest.
  for (const row of conversations) {
    if (!row.created_at) continue;
    for (const offer of offersMade(row)) out[offer] ??= row.created_at;
  }
  return out;
}

export async function getCallHistory(memberId: string): Promise<CallHistory> {
  const { data, error } = await supabaseAdmin
    .from("call_records")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    // A history read that fails must not stop a call going out, but it must not
    // silently claim a clean slate either — the caller logs this.
    throw new Error(`call history read failed: ${error.message}`);
  }
  return summarise((data ?? []) as RawRow[]);
}

/** Same, for every member at once — the dashboard queue needs all of them. */
export async function getAllCallHistory(): Promise<Map<string, CallHistory>> {
  const { data, error } = await supabaseAdmin
    .from("call_records")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`call history read failed: ${error.message}`);

  const byMember = new Map<string, RawRow[]>();
  for (const row of (data ?? []) as RawRow[]) {
    const id = row.member_id;
    if (!id) continue;
    const list = byMember.get(id);
    if (list) list.push(row);
    else byMember.set(id, [row]);
  }

  return new Map([...byMember].map(([id, rows]) => [id, summarise(rows)]));
}
