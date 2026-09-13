import { getAllCallHistory, NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import type { CallType } from "@/lib/callType";
import { referenceDate } from "@/lib/compileVariables";
import { campaignEconomics, ASSUMPTIONS, type CampaignEconomics, type Assumption } from "@/lib/economics";
import { evaluateEligibility } from "@/lib/eligibility";
import { listGyms, type GymSource } from "@/lib/gymStore";
import { sortByPriority } from "@/lib/sortMembers";
import { loadMembers } from "@/lib/memberSource";
import type { Cohort, Member } from "@/lib/types";

/**
 * One description of the queue, used by both the dashboard page and
 * `/api/queue`.
 *
 * The page is a server component and calls this directly rather than fetching
 * its own API — one fewer hop, and, more to the point, no chance of the screen
 * and the endpoint disagreeing about who is due a call.
 */

export interface QueueEntry {
  member_id: string;
  name: string;
  phone: string;
  cohort: Cohort;
  reason: string;
  auto_renew: boolean;
  contract_type: string;
  expiry_date: string;
  monthly_fee: number;
  renewal_fee: number | null;
  days_since_visit: number;
  old_rate: number;
  tenure_days: number;
  visit_count_90d: number;
  call_type: CallType | null;
  winback_window: number | null;
  days_to_expiry: number;
  trigger: string | null;
  blocked_by: string | null;
  blocked_reason: string | null;
  attempt_number: number;
  dial_count: number;
  last_call_at: string | null;
  last_outcome: string | null;
}

export interface QueueCounts {
  renewal: number;
  reengagement: number;
  winback: number;
  due_total: number;
  excluded_auto_renew: number;
  excluded_do_not_contact: number;
  excluded_cooldown: number;
  excluded_max_attempts: number;
  not_due: number;
  total: number;
}

export interface QueueView {
  as_of: string;
  counts: QueueCounts;
  /**
   * Members whose expiry date is inside a fortnight and who are never called
   * because the membership renews itself. The pitch, computed rather than
   * asserted: this is how many calls a date-triggered dialer would get wrong.
   */
  auto_renewers_inside_expiry_window: number;
  entries: QueueEntry[];
  gyms: Array<{ gym_id: string; gym_name: string }>;
  default_gym_id: string;
  economics: CampaignEconomics & { assumptions: Assumption[] };
  /** Set when Supabase could not be read; the counts are then history-blind. */
  history_error: string | null;
  /** Where the gym list came from: the gyms table, or the repo seed before its migration. */
  gym_source: GymSource;
  /** Why the gym list is the seed, or which rows failed validation. */
  gym_notice: string | null;
}

function toEntry(member: Member, history: CallHistory): QueueEntry {
  const e = evaluateEligibility(member, history);
  return {
    member_id: member.member_id,
    name: member.name,
    phone: member.phone,
    cohort: member.cohort,
    reason: member.reason,
    auto_renew: member.auto_renew,
    contract_type: member.contract_type,
    expiry_date: member.expiry_date,
    monthly_fee: member.monthly_fee,
    renewal_fee: member.renewal_fee,
    days_since_visit: member.signals.days_since_visit,
    old_rate: member.signals.old_rate,
    tenure_days: member.signals.tenure_days,
    visit_count_90d: member.signals.visit_count_90d,
    call_type: e.allowed ? e.routing.call_type : null,
    winback_window: e.routing.winback_window,
    days_to_expiry: e.routing.days_to_expiry,
    trigger: e.allowed ? e.routing.trigger : null,
    blocked_by: e.blockedBy,
    blocked_reason: e.blockedReason,
    attempt_number: e.attemptNumber,
    dial_count: history.dialCount,
    last_call_at: history.lastCallAt,
    last_outcome: history.lastOutcome,
  };
}

export async function buildQueueView(): Promise<QueueView> {
  // The gym list doesn't depend on call history, so both reads start at once.
  // `listGyms` never rejects — every failure comes back as a notice — so the
  // early start cannot leave an unhandled rejection behind.
  const gymListingRead = listGyms();
  // The synthetic dataset by default, or a gym's uploaded members when
  // MEMBER_SOURCE=supabase — derived fresh, so a renewal imported since the
  // last render has already moved that member out of the queue.
  const { members } = await loadMembers();
  let history = new Map<string, CallHistory>();
  let historyError: string | null = null;
  try {
    history = await getAllCallHistory();
  } catch (err) {
    historyError = err instanceof Error ? err.message : String(err);
  }

  // Cohort urgency first, most dormant first within each — the framework's own
  // definition of priority, kept as the default order of the member list.
  const entries = sortByPriority(
    members.map((m) => toEntry(m, history.get(m.member_id) ?? NO_HISTORY))
  );
  const count = (predicate: (e: QueueEntry) => boolean) => entries.filter(predicate).length;

  const counts: QueueCounts = {
    renewal: count((e) => e.call_type === "renewal"),
    reengagement: count((e) => e.call_type === "reengagement"),
    winback: count((e) => e.call_type === "winback"),
    due_total: count((e) => e.call_type !== null),
    excluded_auto_renew: count((e) => e.blocked_by === "auto_renew"),
    excluded_do_not_contact: count((e) => e.blocked_by === "do_not_contact"),
    excluded_cooldown: count((e) => e.blocked_by === "cooldown"),
    excluded_max_attempts: count((e) => e.blocked_by === "max_attempts"),
    not_due: count((e) => e.blocked_by === "not_due"),
    total: entries.length,
  };

  const dueIds = new Set(entries.filter((e) => e.call_type).map((e) => e.member_id));
  const dueMembers = members.filter((m) => dueIds.has(m.member_id));

  // The gym switcher offers whatever the gyms table holds — including gyms
  // added through onboarding — or the two seed gyms before its migration runs.
  const gymListing = await gymListingRead;

  return {
    as_of: referenceDate(),
    counts,
    auto_renewers_inside_expiry_window: count(
      (e) => e.blocked_by === "auto_renew" && e.days_to_expiry >= 0 && e.days_to_expiry <= 14
    ),
    entries,
    gyms: gymListing.gyms.map((g) => ({ gym_id: g.gym_id, gym_name: g.gym_name })),
    default_gym_id: gymListing.default_gym_id,
    economics: { ...campaignEconomics(dueMembers), assumptions: ASSUMPTIONS },
    history_error: historyError,
    gym_source: gymListing.source,
    gym_notice: gymListing.notice,
  };
}
