import membersData from "@/data/members_scored.json";
import { getAllCallHistory, NO_HISTORY } from "@/lib/callHistory";
import { ASSUMPTIONS, campaignEconomics, tenureBand } from "@/lib/economics";
import { evaluateEligibility } from "@/lib/eligibility";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Member } from "@/lib/types";

const members = membersData as Member[];

/**
 * Churn intelligence: why members leave, who said they're coming in, and what the
 * whole exercise costs against what it is worth.
 *
 * The first of those is the part no competitor has. Every retention product
 * records *that* a member churned; this records *why*, in the member's own words,
 * because something asked them and wrote the answer down. A gym that has never
 * had that data can act on it in a week — if the reason is the 6am crowd, that is
 * a rota change, not a discount.
 */
interface CallRow {
  member_id?: string;
  call_type?: string | null;
  outcome?: string | null;
  reached_member?: boolean | null;
  reason_for_absence?: string | null;
  reason_detail?: string | null;
  committed_day?: string | null;
  human_followup?: string | null;
  sentiment?: string | null;
  offer_made?: boolean | null;
  offer_accepted?: boolean | null;
  link_sent?: boolean | null;
  member_name?: string | null;
  created_at?: string | null;
  status?: string | null;
  eval_stuck_to_one_ask?: string | null;
  eval_invented_nothing?: string | null;
  eval_no_guilt?: string | null;
}

function tally(rows: CallRow[], key: (row: CallRow) => string | null | undefined) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function crossTally(
  rows: CallRow[],
  outer: (row: CallRow) => string | null | undefined,
  inner: (row: CallRow) => string | null | undefined
) {
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const o = outer(row);
    const i = inner(row);
    if (!o || !i) continue;
    (out[o] ??= {});
    out[o][i] = (out[o][i] ?? 0) + 1;
  }
  return out;
}

export async function buildIntelligence() {
  const memberById = new Map(members.map((m) => [m.member_id, m]));

  let rows: CallRow[] = [];
  let dbError: string | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("call_records")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    rows = (data ?? []) as CallRow[];
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const completed = rows.filter((r) => r.status === "completed");
  const conversations = completed.filter(
    (r) => r.reached_member === true || (r.reached_member == null && Boolean(r.outcome))
  );
  const withReason = conversations.filter(
    (r) => r.reason_for_absence && r.reason_for_absence !== "none_given"
  );

  const bandOf = (row: CallRow) => {
    const m = row.member_id ? memberById.get(row.member_id) : undefined;
    return m ? tenureBand(m.signals.tenure_days) : null;
  };
  const cohortOf = (row: CallRow) => {
    const m = row.member_id ? memberById.get(row.member_id) : undefined;
    return m?.cohort ?? null;
  };

  // What the front desk needs: who said they're coming in, and when.
  const commitments = conversations
    .filter((r) => r.committed_day?.trim())
    .map((r) => ({
      member_id: r.member_id,
      member_name: r.member_name ?? memberById.get(r.member_id ?? "")?.name ?? null,
      call_type: r.call_type ?? null,
      day: r.committed_day!.trim(),
      reason: r.reason_for_absence ?? null,
      said_at: r.created_at ?? null,
    }));

  // What a person has to pick up, because the agent could not.
  const followUps = conversations
    .filter((r) => r.human_followup?.trim())
    .map((r) => ({
      member_id: r.member_id,
      member_name: r.member_name ?? memberById.get(r.member_id ?? "")?.name ?? null,
      call_type: r.call_type ?? null,
      task: r.human_followup!.trim(),
      said_at: r.created_at ?? null,
    }));

  // In the member's own words. The quotes are the artefact, not the histogram:
  // "the 6am crowd" is a rota change, and no churn score says that.
  const quotes = withReason
    .filter((r) => r.reason_detail?.trim())
    .slice(0, 40)
    .map((r) => ({
      member_id: r.member_id,
      member_name: r.member_name ?? memberById.get(r.member_id ?? "")?.name ?? null,
      reason: r.reason_for_absence,
      quote: r.reason_detail!.trim(),
      sentiment: r.sentiment ?? null,
      call_type: r.call_type ?? null,
    }));

  // The three always-on evaluation criteria, as they scored on real calls. The
  // simulated suite in evals/ is the controlled measurement; this is the field.
  const criteria = ["eval_stuck_to_one_ask", "eval_invented_nothing", "eval_no_guilt"] as const;
  const liveCriteria = Object.fromEntries(
    criteria.map((key) => {
      const scored = completed.filter((r) => r[key]);
      return [
        key.replace("eval_", ""),
        {
          scored: scored.length,
          passed: scored.filter((r) => r[key] === "success").length,
        },
      ];
    })
  );

  // Economics run off the live queue, not off call history, so the panel says
  // something on day one — before a single call has been placed.
  let queue: Member[] = [];
  try {
    const history = await getAllCallHistory();
    queue = members.filter(
      (m) => evaluateEligibility(m, history.get(m.member_id) ?? NO_HISTORY).allowed
    );
  } catch {
    queue = members.filter((m) => evaluateEligibility(m, NO_HISTORY).allowed);
  }

  return {
    db_error: dbError,
    calls: {
      dials: rows.length,
      completed: completed.length,
      conversations: conversations.length,
      with_a_stated_reason: withReason.length,
    },
    why_they_leave: {
      overall: tally(withReason, (r) => r.reason_for_absence),
      by_call_type: crossTally(withReason, (r) => r.call_type, (r) => r.reason_for_absence),
      by_cohort: crossTally(withReason, cohortOf, (r) => r.reason_for_absence),
      by_tenure_band: crossTally(withReason, bandOf, (r) => r.reason_for_absence),
    },
    outcomes: {
      overall: tally(conversations, (r) => r.outcome),
      by_call_type: crossTally(conversations, (r) => r.call_type, (r) => r.outcome),
    },
    sentiment: tally(conversations, (r) => r.sentiment),
    offers: {
      made: conversations.filter((r) => r.offer_made === true).length,
      accepted: conversations.filter((r) => r.offer_accepted === true).length,
      links_sent: conversations.filter((r) => r.link_sent === true).length,
    },
    commitments,
    follow_ups: followUps,
    quotes,
    live_criteria: liveCriteria,
    economics: {
      ...campaignEconomics(queue),
      assumptions: ASSUMPTIONS,
    },
  };
}
