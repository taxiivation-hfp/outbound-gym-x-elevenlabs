/**
 * Owns: the nightly recompute: the clock plan, the routing snapshot and reason themes, and the latest run.
 * Not here: the live queue the dashboard and /api/queue render, which is built in lib/queueView.ts.
 */
import type { CallHistory } from "@/lib/callHistory";
import { NO_HISTORY, getAllCallHistory } from "@/lib/callHistory";
import type { CallType } from "@/lib/callType";
import { DATA_AS_OF } from "@/lib/clock";
import { evaluateEligibility } from "@/lib/eligibility";
import type { GymFields } from "@/lib/gymConfig";
import { resolveGym } from "@/lib/gymStore";
import { loadMembers, memberSource, type MemberSource } from "@/lib/memberSource";
import { readAllCallRows } from "@/lib/callRecords";
import { reasonDetails, type ReasonRow, type StoredReasonThemes } from "@/lib/reasonThemes";
import { summariseReasonThemes } from "@/lib/reasonThemesSummary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Member } from "@/lib/types";

/**
 * The nightly recompute.
 *
 * Nothing in this product needs to be real-time; it needs to be daily. There is
 * no moment where a call at 2pm beats a call at 9am tomorrow. Contracts and
 * expiry dates don't move, so renewal and winback triggers run fine off a
 * periodic export plus a clock, and the one signal that goes stale —
 * `days_since_visit` — changes nothing whether a 28-day absence trigger fires on
 * day 28 or day 29.
 *
 * So once a day this recomputes every member's routing and eligibility against
 * the clock and records the result: when it ran, which date it measured from,
 * whether that date was the wall clock or the synthetic dataset's frozen one,
 * where the members came from, and who was due. The call route does not trust
 * this record — it re-reads the member and re-checks eligibility at dial time —
 * so a stale snapshot can never produce a wrong call. The record is for knowing
 * what the queue looked like on a given morning.
 *
 * The frozen clock exists because the dataset is synthetic: every date in it was
 * generated relative to one instant. Real member data measured against that
 * instant would route wrongly, so that combination is refused, not run.
 */

export type ClockKind = "live" | "frozen";

export type RecomputePlan =
  | { ok: true; source: MemberSource; clock: ClockKind; asOf: Date }
  | { ok: false; status: number; reason: string };

/** Decides whether and how tonight's run happens. Pure, so a guard can pin it. */
export function planRecompute(env: { MEMBER_SOURCE?: string; MEMBER_SOURCE_GYM_ID?: string; DATASET_CLOCK?: string }, now: Date): RecomputePlan {
  let source: MemberSource;
  try {
    source = memberSource(env);
  } catch (err) {
    return { ok: false, status: 409, reason: err instanceof Error ? err.message : String(err) };
  }

  const clock: ClockKind = env.DATASET_CLOCK === "live" ? "live" : "frozen";
  if (source.kind === "supabase" && clock === "frozen") {
    return {
      ok: false,
      status: 409,
      reason:
        "Uploaded member data would be measured against the synthetic dataset's frozen date, which would route real members wrongly. " +
        "Set DATASET_CLOCK=live for a gym's real data. Nothing was recomputed.",
    };
  }
  return { ok: true, source, clock, asOf: clock === "live" ? now : DATA_AS_OF };
}

export interface SnapshotEntry {
  member_id: string;
  call_type: CallType | null;
  blocked_by: string | null;
  reason: string | null;
}

export interface SnapshotCounts {
  total: number;
  due: number;
  renewal: number;
  reengagement: number;
  winback: number;
  cancellation: number;
  auto_renew: number;
  do_not_contact: number;
  cooldown: number;
  max_attempts: number;
  nothing_to_offer: number;
  not_due: number;
}

/**
 * Routing and eligibility for every member, as of one date. Pure. `gym` is the
 * config a cancellation call would speak for; without it that call's
 * "anything to offer?" gate isn't applied, and the snapshot says so.
 */
export function computeSnapshot(
  members: Member[],
  history: Map<string, CallHistory>,
  asOf: Date,
  gym: GymFields | null = null
): { counts: SnapshotCounts; entries: SnapshotEntry[] } {
  const counts: SnapshotCounts = {
    total: members.length,
    due: 0,
    renewal: 0,
    reengagement: 0,
    winback: 0,
    cancellation: 0,
    auto_renew: 0,
    do_not_contact: 0,
    cooldown: 0,
    max_attempts: 0,
    nothing_to_offer: 0,
    not_due: 0,
  };
  const entries = members.map((member) => {
    const e = evaluateEligibility(member, history.get(member.member_id) ?? NO_HISTORY, asOf, gym);
    if (e.allowed && e.routing.call_type) {
      counts.due += 1;
      counts[e.routing.call_type] += 1;
    } else if (e.blockedBy) {
      counts[e.blockedBy] += 1;
    }
    return {
      member_id: member.member_id,
      call_type: e.allowed ? e.routing.call_type : null,
      blocked_by: e.blockedBy,
      reason: e.allowed ? e.routing.trigger : e.blockedReason,
    };
  });
  return { counts, entries };
}

export const QUEUE_RUNS_MIGRATION = "supabase/migrations/20260914020000_queue_runs.sql";

export interface RecomputeResult {
  run_id: string;
  as_of: string;
  clock: ClockKind;
  member_source: MemberSource["kind"];
  gym_id: string | null;
  counts: SnapshotCounts;
  history_error: string | null;
  /** What happened to tonight's themed summary of members' stated reasons. */
  reason_themes: { status: string; statements?: number; reason?: string };
}

export class RecomputeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RecomputeError";
    this.status = status;
  }
}

/** Runs tonight's recompute and records it. Throws `RecomputeError` with the reason when it can't. */
export async function runRecompute(now: Date): Promise<RecomputeResult> {
  const plan = planRecompute(
    {
      MEMBER_SOURCE: process.env.MEMBER_SOURCE,
      MEMBER_SOURCE_GYM_ID: process.env.MEMBER_SOURCE_GYM_ID,
      DATASET_CLOCK: process.env.DATASET_CLOCK,
    },
    now
  );
  if (!plan.ok) throw new RecomputeError(plan.reason, plan.status);

  const { members } = await loadMembers(plan.asOf);

  // Recorded, not hidden: a run without call history counts members that
  // do-not-contact or the cooldown would have blocked. The call route still
  // enforces both at dial time.
  let history = new Map<string, CallHistory>();
  let historyError: string | null = null;
  try {
    history = await getAllCallHistory();
  } catch (err) {
    historyError = err instanceof Error ? err.message : String(err);
  }

  const asOfIso = plan.asOf.toISOString().slice(0, 10);
  const gymId = plan.source.kind === "supabase" ? plan.source.gymId : null;

  // The gym a cancellation call would speak for: the uploaded members' own
  // gym, or the default gym for the synthetic dataset. If it can't be read
  // the run still records — without that one gate, and it says so — because
  // the call route re-checks everything, gym included, before dialling.
  const gymLookup = await resolveGym(gymId);
  if (!gymLookup.ok) {
    historyError = [historyError, `gym config not read, so the cancellation call's nothing-to-offer gate wasn't applied: ${gymLookup.error}`]
      .filter(Boolean)
      .join("; ");
  }
  const { counts, entries } = computeSnapshot(members, history, plan.asOf, gymLookup.ok ? gymLookup.gym : null);

  const { data, error } = await supabaseAdmin
    .from("queue_runs")
    .insert({
      as_of: asOfIso,
      clock: plan.clock,
      member_source: plan.source.kind,
      gym_id: gymId,
      counts,
      history_error: historyError,
    })
    .select("id")
    .single();
  if (error || !data) {
    const missing = /could not find the table|relation .* does not exist/i.test(error?.message ?? "") || error?.code === "PGRST205";
    throw new RecomputeError(
      missing
        ? `The queue_runs table hasn't been created, so the run couldn't be recorded. Apply ${QUEUE_RUNS_MIGRATION}.`
        : `The run couldn't be recorded: ${error?.message ?? "no id returned"}`,
      missing ? 503 : 502
    );
  }

  const runId = (data as { id: string }).id;
  for (let i = 0; i < entries.length; i += 500) {
    const { error: entryError } = await supabaseAdmin
      .from("queue_run_entries")
      .insert(entries.slice(i, i + 500).map((e) => ({ run_id: runId, ...e })));
    if (entryError) {
      // The run row exists but is incomplete; mark it so nobody reads it as whole.
      await supabaseAdmin.from("queue_runs").update({ history_error: `entries incomplete: ${entryError.message}` }).eq("id", runId);
      throw new RecomputeError(`The run was recorded but its member entries failed at ${i + 1}: ${entryError.message}`, 502);
    }
  }

  // The themed summary of what members said. The one model call in the nightly
  // job, and never on a page render; its result is stored on this run for the
  // intelligence page to read. Nothing it returns can fail the run.
  const themes = await nightlyReasonThemes();
  const { error: themesError } = await supabaseAdmin.from("queue_runs").update({ reason_themes: themes }).eq("id", runId);

  return {
    run_id: runId,
    as_of: asOfIso,
    clock: plan.clock,
    member_source: plan.source.kind,
    gym_id: gymId,
    counts,
    history_error: historyError,
    reason_themes: themesError ? { status: "not_stored", reason: themesError.message } : { status: themes.status, statements: themes.statements },
  };
}

async function nightlyReasonThemes(): Promise<StoredReasonThemes> {
  const { rows, error } = await readAllCallRows<ReasonRow>();
  if (error) {
    return { status: "unavailable", statements: 0, reason: `Call records couldn't be read: ${error}`, generated_at: new Date().toISOString() };
  }
  return summariseReasonThemes(reasonDetails(rows));
}

export interface LatestRun {
  ran_at: string;
  as_of: string;
  clock: ClockKind;
  member_source: string;
  gym_id: string | null;
  counts: SnapshotCounts;
  history_error: string | null;
}

/**
 * The most recent recorded run for one gym's uploaded members, or why there
 * isn't one to show. A run over the synthetic dataset has no gym and is never
 * shown as a gym's.
 */
export async function latestRun(gymId: string): Promise<{ run: LatestRun | null; notice: string | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { run: null, notice: "Runs can't be read because Supabase isn't configured on this deployment." };
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("queue_runs")
      .select("ran_at, as_of, clock, member_source, gym_id, counts, history_error")
      .eq("gym_id", gymId)
      .order("ran_at", { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));
    if (error) {
      const missing = /could not find the table|relation .* does not exist/i.test(error.message) || error.code === "PGRST205";
      return {
        run: null,
        notice: missing ? `No run can be recorded until ${QUEUE_RUNS_MIGRATION} is applied.` : `Runs couldn't be read: ${error.message}`,
      };
    }
    const run = (data?.[0] as LatestRun | undefined) ?? null;
    return { run, notice: run ? null : "No nightly recompute has been recorded for this gym yet." };
  } catch (err) {
    return { run: null, notice: `Runs couldn't be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}
