import { getAllCallHistory, NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import { readAllCallRows } from "@/lib/callRecords";
import { loadCheckinActivity } from "@/lib/checkinActivity";
import { today } from "@/lib/clock";
import { ASSUMPTIONS, campaignEconomics, tenureBand } from "@/lib/economics";
import { evaluateEligibility } from "@/lib/eligibility";
import type { GymFields } from "@/lib/gymConfig";
import { listGyms } from "@/lib/gymStore";
import {
  attendanceTrend,
  busyness,
  frequencySegments,
  membershipHealth,
  revenueAtRisk,
  type CheckinActivity,
} from "@/lib/gymHealth";
import { loadMembers, memberSource, type MemberSource } from "@/lib/memberSource";
import { latestReasonThemes, MIN_REASON_DETAILS, reasonDetails, type StoredReasonThemes } from "@/lib/reasonThemes";
import type { Member } from "@/lib/types";

/**
 * Churn intelligence: why members leave, who said they're coming in, and what the
 * whole exercise costs against what it is worth — surrounded by the health of
 * the gym those members belong to.
 *
 * The first of those is the part no competitor has. Every retention product
 * records *that* a member churned; this records *why*, in the member's own words,
 * because something asked them and wrote the answer down. A gym that has never
 * had that data can act on it in a week — if the reason is the 6am crowd, that is
 * a rota change, not a discount.
 *
 * Split in two so it can be checked without a database: `buildIntelligence`
 * reads (members through `loadMembers`, call history, check-in activity and the
 * stored nightly summary), and `composeIntelligence` is pure. No model is called
 * on any of it — the themed summary was written by the nightly recompute.
 */
export interface CallRow {
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

export interface IntelligenceInput {
  asOf: Date;
  members: Member[];
  members_error: string | null;
  rows: CallRow[];
  db_error: string | null;
  history: Map<string, CallHistory>;
  history_error: string | null;
  activity: CheckinActivity | null;
  activity_notice: string | null;
  themes: StoredReasonThemes | null;
  themes_ran_at: string | null;
  themes_notice: string | null;
  /** The gym a cancellation call would speak for; without it that call's offer gate isn't applied to the counts. */
  gym?: GymFields | null;
}

export type Intelligence = ReturnType<typeof composeIntelligence>;

export function composeIntelligence(input: IntelligenceInput) {
  const { asOf, members, rows, history } = input;
  const memberById = new Map(members.map((m) => [m.member_id, m]));

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

  // Eligibility exactly as the queue and /api/call decide it. Economics run off
  // the live queue, not off call history, so the panel says something on day
  // one — before a single call has been placed.
  const evaluated = members.map((member) => ({
    member,
    eligibility: evaluateEligibility(member, history.get(member.member_id) ?? NO_HISTORY, asOf, input.gym ?? null),
  }));
  const queue = evaluated.filter((e) => e.eligibility.allowed).map((e) => e.member);

  // The themed summary is shown only when enough members have said something;
  // below that the enum breakdown stands alone. Counted with the same filter
  // the nightly run uses, so the page and the run agree on "enough".
  const statements = reasonDetails(rows).length;

  return {
    as_of: asOf.toISOString().slice(0, 10),
    db_error: input.db_error,
    calls: {
      dials: rows.length,
      completed: completed.length,
      conversations: conversations.length,
      with_a_stated_reason: withReason.length,
    },
    health: {
      members_error: input.members_error,
      history_error: input.history_error,
      membership: members.length > 0 ? membershipHealth(members, asOf) : null,
      revenue_at_risk: revenueAtRisk(evaluated),
      segments: frequencySegments(members, asOf),
      attendance: input.activity ? attendanceTrend(input.activity, members, asOf) : null,
      busyness: input.activity ? busyness(input.activity) : null,
      activity_notice: input.activity_notice,
    },
    why_they_leave: {
      overall: tally(withReason, (r) => r.reason_for_absence),
      by_call_type: crossTally(withReason, (r) => r.call_type, (r) => r.reason_for_absence),
      by_cohort: crossTally(withReason, cohortOf, (r) => r.reason_for_absence),
      by_tenure_band: crossTally(withReason, bandOf, (r) => r.reason_for_absence),
      themes: {
        statements,
        minimum: MIN_REASON_DETAILS,
        enough: statements >= MIN_REASON_DETAILS,
        stored: statements >= MIN_REASON_DETAILS ? input.themes : null,
        ran_at: statements >= MIN_REASON_DETAILS ? input.themes_ran_at : null,
        notice: statements >= MIN_REASON_DETAILS ? input.themes_notice : null,
      },
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

export async function buildIntelligence(): Promise<Intelligence> {
  const asOf = today();

  let source: MemberSource | null = null;
  let members: Member[] = [];
  let membersError: string | null = null;
  try {
    source = memberSource();
    members = (await loadMembers(asOf)).members;
  } catch (err) {
    // Never the synthetic members in place of a gym's: the health section says
    // it couldn't read them instead.
    membersError = err instanceof Error ? err.message : String(err);
  }

  const [calls, historyRead, activityRead, themesRead, gymListing] = await Promise.all([
    readAllCallRows<CallRow>(),
    getAllCallHistory().then(
      (history) => ({ history, error: null as string | null }),
      (err) => ({ history: new Map<string, CallHistory>(), error: err instanceof Error ? err.message : String(err) })
    ),
    source ? loadCheckinActivity(source, asOf) : Promise.resolve({ activity: null, notice: null }),
    source ? latestReasonThemes(source) : Promise.resolve({ themes: null, ran_at: null, notice: null }),
    // The same default gym the queue judges a cancellation call against.
    listGyms(),
  ]);

  return composeIntelligence({
    asOf,
    members,
    members_error: membersError,
    rows: calls.rows,
    db_error: calls.error,
    history: historyRead.history,
    history_error: historyRead.error,
    activity: activityRead.activity,
    activity_notice: activityRead.notice,
    themes: themesRead.themes,
    themes_ran_at: themesRead.ran_at,
    themes_notice: themesRead.notice,
    gym: gymListing.gyms.find((g) => g.gym_id === gymListing.default_gym_id) ?? null,
  });
}
