import { NextResponse } from "next/server";
import membersData from "@/data/members_scored.json";
import { getAllCallHistory, NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import { referenceDate } from "@/lib/compileVariables";
import { evaluateEligibility } from "@/lib/eligibility";
import { DEFAULT_GYM_ID, gyms } from "@/lib/gyms";
import type { Member } from "@/lib/types";

const members = membersData as Member[];

/**
 * Who is due a call today, who is not, and why — for every member.
 *
 * Computed on the server because eligibility needs Supabase: do-not-contact and
 * the cooldown live in call history. The dashboard renders this; it does not
 * re-derive it, so what is shown and what the call route enforces cannot drift.
 */
export const dynamic = "force-dynamic";

export interface QueueEntry {
  member_id: string;
  name: string;
  cohort: string;
  auto_renew: boolean;
  contract_type: string;
  expiry_date: string;
  monthly_fee: number;
  days_since_visit: number;
  old_rate: number;
  tenure_days: number;
  call_type: string | null;
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

export async function GET() {
  let history: Map<string, CallHistory>;
  let historyError: string | null = null;
  try {
    history = await getAllCallHistory();
  } catch (err) {
    // The queue is still worth showing without history — it just cannot claim
    // anything about attempts or cooldowns, so say so rather than imply a clean
    // slate is a fact.
    history = new Map();
    historyError = err instanceof Error ? err.message : String(err);
  }

  const entries: QueueEntry[] = members.map((member) => {
    const h = history.get(member.member_id) ?? NO_HISTORY;
    const e = evaluateEligibility(member, h);
    return {
      member_id: member.member_id,
      name: member.name,
      cohort: member.cohort,
      auto_renew: member.auto_renew,
      contract_type: member.contract_type,
      expiry_date: member.expiry_date,
      monthly_fee: member.monthly_fee,
      days_since_visit: member.signals.days_since_visit,
      old_rate: member.signals.old_rate,
      tenure_days: member.signals.tenure_days,
      call_type: e.allowed ? e.routing.call_type : null,
      winback_window: e.routing.winback_window,
      days_to_expiry: e.routing.days_to_expiry,
      trigger: e.allowed ? e.routing.trigger : null,
      blocked_by: e.blockedBy,
      blocked_reason: e.blockedReason,
      attempt_number: e.attemptNumber,
      dial_count: h.dialCount,
      last_call_at: h.lastCallAt,
      last_outcome: h.lastOutcome,
    };
  });

  const due = entries.filter((e) => e.call_type);
  const counts = {
    renewal: due.filter((e) => e.call_type === "renewal").length,
    reengagement: due.filter((e) => e.call_type === "reengagement").length,
    winback: due.filter((e) => e.call_type === "winback").length,
    excluded_auto_renew: entries.filter((e) => e.blocked_by === "auto_renew").length,
    excluded_do_not_contact: entries.filter((e) => e.blocked_by === "do_not_contact").length,
    excluded_cooldown: entries.filter((e) => e.blocked_by === "cooldown").length,
    excluded_max_attempts: entries.filter((e) => e.blocked_by === "max_attempts").length,
    not_due: entries.filter((e) => e.blocked_by === "not_due").length,
    total: entries.length,
  };

  /**
   * The pitch line, computed rather than asserted: members an expiry-date
   * trigger would have dialled and this one refuses to, because the membership
   * renews itself and the call is the only thing that could stop it.
   */
  const autoRenewersInsideExpiryWindow = entries.filter(
    (e) => e.blocked_by === "auto_renew" && e.days_to_expiry >= 0 && e.days_to_expiry <= 14
  ).length;

  return NextResponse.json({
    as_of: referenceDate(),
    gyms: gyms.map((g) => ({ gym_id: g.gym_id, gym_name: g.gym_name })),
    default_gym_id: DEFAULT_GYM_ID,
    counts,
    auto_renewers_inside_expiry_window: autoRenewersInsideExpiryWindow,
    history_error: historyError,
    entries,
  });
}
