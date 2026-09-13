/**
 * Owns: deriving the router's Member (signals, contract, cohort) from member, contract and check-in rows.
 * Not here: reading or writing those rows in Supabase, which lives in lib/memberStore.ts.
 */
import type { Channel, Cohort, Member, Signals } from "@/lib/types";

/**
 * A member, derived from the three tables a gym platform exports.
 *
 * The offline pipeline (`pipeline/build_scores.py`) computes these same facts
 * against a frozen reference date for the synthetic dataset. Member data that
 * arrives by CSV upload lives in Supabase instead, and this module derives the
 * identical `Member` shape from it at query time — so the router, the
 * eligibility gate and the variable compiler cannot tell which source a member
 * came from. The formulas are ported line for line; `scripts/verify-member-port.mjs`
 * checks the port against the pipeline's own output for all 500 synthetic
 * members.
 *
 * Three decisions that matter:
 *
 * - **Contracts are one row per term.** A renewal at the front desk is a new
 *   row with a new end date, so a member who renewed three days ago drops out of
 *   the renewal queue on the next import instead of being rung about it. When
 *   rows disagree about whether the member auto-renews, `currentContract`
 *   resolves it towards not calling (see there).
 * - **Nothing time-relative is stored.** `days_since_visit` comes from the
 *   latest check-in timestamp at query time; contract status comes from the end
 *   date against today. A stored "days since visit" would be wrong by tomorrow.
 * - **A blank is not a value.** A contract with no renewal fee yields a member
 *   whose renewal price the agent says it doesn't have. A member with no mobile
 *   number cannot be dialled. Nothing here fills a gap with a plausible guess.
 */

const DAY_MS = 86_400_000;
const WINDOW_4WK = 28;
const WINDOW_8WK = 56;
const WINDOW_90D = 90;

export interface MemberRecord {
  member_id: string;
  name: string;
  /** Null when the export had no number. Never defaulted. */
  mobile: string | null;
  /** ISO YYYY-MM-DD. */
  join_date: string;
  /** Local timestamp of a cancellation request, or null. Absent from an export means no request. */
  cancellation_requested: string | null;
}

export interface ContractRecord {
  member_id: string;
  contract_type: string;
  auto_renew: boolean;
  /** ISO YYYY-MM-DD. */
  start_date: string;
  /** ISO YYYY-MM-DD. The last day of the term, or the next rollover for an auto-renewing plan. */
  end_date: string;
  monthly_fee: number;
  /** Null when the export did not say what renewing costs. */
  renewal_fee: number | null;
  /**
   * The last import that contained this exact row. Re-uploading an export that
   * still lists a term moves this forward even though no new row is written, so
   * it says what the platform reported most recently — which is what decides a
   * term exported with conflicting facts.
   */
  last_seen_at: string;
  /** Database identity; the last tie-break, between rows seen in the same import. */
  id?: number;
}

/** Check-in counts for one member, relative to a reference date. */
export interface VisitCounts {
  /** ISO timestamp of the most recent check-in, or null for a member who never came. */
  last_visit_at: string | null;
  visits_last_4wk: number;
  visits_prior_4wk: number;
  visits_90d: number;
  visits_before_4wk: number;
}

export interface DerivedSignals extends Signals {
  visits_last_4wk: number;
  visits_prior_4wk: number;
}

// --- Dates, the way the pipeline reads them --------------------------------------

/** Parses an ISO date or local timestamp as a UTC instant, with no timezone shifting. */
export function parseLocalInstant(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/.exec(value);
  if (!m) return Number.NaN;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0)
  );
}

/** Midnight UTC of the reference date — the pipeline's naive `TODAY`. */
function midnight(asOf: Date): number {
  return Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
}

/** Python's `timedelta.days`: whole days, floored toward negative infinity. */
function floorDays(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * Python's `round(x, n)`: rounds the double's exact decimal value, and exact
 * halves go to the even neighbour. `Math.round(x * 10 ** n)` is not the same:
 * the multiplication itself rounds, so 1.7149999999999999 × 100 becomes exactly
 * 171.5 and rounds up where Python rounds down. The port is checked against the
 * pipeline's output byte for byte, so this works on the exact expansion, which
 * `toFixed` gives (to 100 places — every double this is used on fits).
 */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const [whole, fraction] = Math.abs(x).toFixed(100).split(".");
  let kept = Number(whole + fraction.slice(0, digits));
  const next = fraction[digits];
  const beyond = /[1-9]/.test(fraction.slice(digits + 1));
  if (next > "5" || (next === "5" && (beyond || kept % 2 === 1))) kept += 1;
  return (x < 0 ? -kept : kept) / 10 ** digits;
}

// --- Check-ins ---------------------------------------------------------------------

/**
 * Counts one member's check-ins against a reference date, with the pipeline's
 * windows. The same counts come from the `member_visit_counts` database function
 * for uploaded data; this version exists for the guards, the CSV preview and the
 * port check.
 */
export function countVisits(timestamps: string[], asOf: Date): VisitCounts {
  const today = midnight(asOf);
  let last = Number.NEGATIVE_INFINITY;
  let lastRaw: string | null = null;
  const counts = { visits_last_4wk: 0, visits_prior_4wk: 0, visits_90d: 0, visits_before_4wk: 0 };
  for (const raw of timestamps) {
    const t = parseLocalInstant(raw);
    if (Number.isNaN(t)) continue;
    if (t > last) {
      last = t;
      lastRaw = raw;
    }
    if (t >= today - WINDOW_4WK * DAY_MS) counts.visits_last_4wk += 1;
    if (t >= today - WINDOW_8WK * DAY_MS && t < today - WINDOW_4WK * DAY_MS) counts.visits_prior_4wk += 1;
    if (t >= today - WINDOW_90D * DAY_MS) counts.visits_90d += 1;
    if (t < today - WINDOW_4WK * DAY_MS) counts.visits_before_4wk += 1;
  }
  return { last_visit_at: lastRaw, ...counts };
}

/** `build_scores.py` feature engineering, for one member. */
export function deriveSignals(joinDate: string, visits: VisitCounts, asOf: Date): DerivedSignals {
  const today = midnight(asOf);
  const joined = parseLocalInstant(joinDate);
  const tenureDays = floorDays(today - joined);

  // Members with zero check-ins ever are treated as dormant since joining. A
  // visit later on the reference day than its midnight (a live clock reads the
  // date in UTC, which an Australian morning is still "yesterday" in) counts as
  // today, never as a negative number of days.
  const daysSinceVisit =
    visits.last_visit_at === null ? tenureDays : Math.max(0, floorDays(today - parseLocalInstant(visits.last_visit_at)));

  // old_rate: average weekly visits over history before the last four weeks.
  const cutoff = today - WINDOW_4WK * DAY_MS;
  const priorWeeks = Math.max(floorDays(cutoff - joined) / 7, 1);
  const oldRate = visits.last_visit_at === null ? 0 : pyRound(visits.visits_before_4wk / priorWeeks, 2);

  return {
    days_since_visit: daysSinceVisit,
    old_rate: oldRate,
    tenure_days: tenureDays,
    visit_count_90d: visits.visits_90d,
    visits_last_4wk: visits.visits_last_4wk,
    visits_prior_4wk: visits.visits_prior_4wk,
  };
}

// --- Contracts -------------------------------------------------------------------------

function seenAt(contract: ContractRecord): number {
  const t = Date.parse(contract.last_seen_at);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Is this auto-renewing row replaced by a fixed term? Only by one the platform
 * reported at least as recently: a fixed term that starts later and was seen in
 * the same import or a later one, or the same term (same start) seen strictly
 * later with auto-renew off. A fixed term the latest export no longer lists, or
 * an older term re-exported with a correction, replaces nothing.
 */
function autoRenewReplaced(auto: ContractRecord, contracts: ContractRecord[]): boolean {
  return contracts.some(
    (c) =>
      !c.auto_renew &&
      ((c.start_date > auto.start_date && seenAt(c) >= seenAt(auto)) ||
        (c.start_date === auto.start_date && seenAt(c) > seenAt(auto)))
  );
}

function newestFirst(a: ContractRecord, b: ContractRecord): number {
  if (a.end_date !== b.end_date) return b.end_date.localeCompare(a.end_date);
  if (a.start_date !== b.start_date) return b.start_date.localeCompare(a.start_date);
  if (seenAt(a) !== seenAt(b)) return seenAt(b) - seenAt(a);
  return (b.id ?? 0) - (a.id ?? 0);
}

/**
 * The contract in force. Null for a member with no contract at all.
 *
 * Term history arrives as rows from exports of different ages, and they can
 * disagree: a term re-exported with auto-renew switched on, then off, then on
 * again; a fixed term converted mid-way to a rolling plan whose next rollover is
 * earlier than the fixed term's end; two rows for the same date in one file.
 * "Which row is current" is then a judgement, and it has to fall on the side of
 * not calling, because calling an auto-renewing member is the one call this
 * product exists never to make.
 *
 * So: if any auto-renewing row is still standing — not replaced by a fixed term
 * the platform reported at least as recently — the member is on that plan.
 * Otherwise the current contract is the fixed term with the latest end date
 * (then the latest start, then the most recently seen). A missed renewal call
 * is the cost of an ambiguous export; a call that reminds a rolling member to
 * cancel is not a cost this chooses.
 */
export function currentContract(contracts: ContractRecord[]): ContractRecord | null {
  if (contracts.length === 0) return null;
  const standingAutoRenew = contracts.filter((c) => c.auto_renew && !autoRenewReplaced(c, contracts));
  const pool = standingAutoRenew.length > 0 ? standingAutoRenew : contracts.filter((c) => !c.auto_renew);
  return [...pool].sort(newestFirst)[0];
}

/** Derived, never stored: a term that ended before today is expired. */
export function contractStatus(contract: ContractRecord, asOf: Date): "active" | "expired" {
  return parseLocalInstant(contract.end_date) < midnight(asOf) ? "expired" : "active";
}

// --- Cohort and reason ---------------------------------------------------------------

/** `build_scores.py` `classify`, first match wins. Explains the member; never decides the call. */
export function classifyCohort(status: "active" | "expired", s: DerivedSignals): Cohort {
  if (s.tenure_days <= 21) return "new_joiner";
  if (status === "expired") return "winback";
  if (status === "active" && s.days_since_visit >= 60) return "sleeping_dog";
  if (
    status === "active" &&
    s.old_rate >= 1.5 &&
    s.visits_prior_4wk >= 2 &&
    s.visits_last_4wk <= s.visits_prior_4wk * 0.5 &&
    s.days_since_visit < 55
  ) {
    return "sliding";
  }
  return "steady";
}

const COHORT_ACTIONS: Record<Cohort, { contact: boolean; channel: Channel; action: string }> = {
  steady: { contact: false, channel: null, action: "no action" },
  new_joiner: { contact: true, channel: "staff", action: "in-person welcome conversation" },
  sliding: { contact: true, channel: "staff", action: "floor conversation on next visit" },
  sleeping_dog: { contact: false, channel: null, action: "do not contact" },
  winback: { contact: true, channel: "ai_call", action: "outbound reactivation call" },
};

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function formatRate(rate: number): string {
  if (rate <= 0) return "rarely";
  // Python prints the float: "2.4x/week", and "3.0x/week" for a whole number.
  return `${(pyRound(rate * 10) / 10).toFixed(1)}x/week`;
}

function formatDaysSince(days: number): string {
  if (days < 7) return `${days} day${plural(days)}`;
  if (days < 60) {
    const weeks = pyRound(days / 7);
    return `${weeks} week${plural(weeks)}`;
  }
  const months = pyRound(days / 30);
  return `${months} month${plural(months)}`;
}

/** `build_scores.py` `generate_reason`. */
export function cohortReason(
  name: string,
  cohort: Cohort,
  tenureDays: number,
  oldRate: number,
  daysSince: number,
  autoRenew: boolean
): string {
  const tenureMonths = Math.max(1, pyRound(tenureDays / 30));
  const rate = formatRate(oldRate);
  const since = formatDaysSince(daysSince);

  switch (cohort) {
    case "winback":
      return (
        `${name} trained ${rate} for about ${tenureMonths} month${plural(tenureMonths)} ` +
        `and hasn't visited in ${since}. Membership has lapsed — an outbound call has ` +
        "nothing left to cancel."
      );
    case "sleeping_dog":
      return autoRenew
        ? `${name} hasn't visited in ${since} but is still billing on an auto-renewing ` +
            "membership. A call reminds them to cancel — never contacted."
        : `${name} hasn't visited in ${since} and is on a fixed term that will simply lapse. ` +
            "Nothing is lost by calling and a lapse is lost either way.";
    case "sliding":
      return (
        `${name}'s visits have dropped off recently after training ${rate}. Still ` +
        "attending occasionally — a floor conversation next visit can catch this before it " +
        "becomes a lapse."
      );
    case "new_joiner": {
      const when = tenureMonths <= 1 ? "recently" : `${tenureMonths} months ago`;
      return (
        `${name} joined ${when} and has visited fewer than twice so far. An in-person ` +
        "welcome conversation now sets the habit early."
      );
    }
    case "steady":
      return `${name} is training consistently at ${rate} with no signs of drop-off. No action needed right now.`;
  }
}

// --- The member ------------------------------------------------------------------------

export type BuiltMember =
  | { ok: true; member: Member }
  | { ok: false; member_id: string; reason: string };

/**
 * Assembles the `Member` the router reads. A member with no contract has no
 * expiry date for any trigger to date from, so it is reported rather than
 * invented.
 */
export function buildMember(
  record: MemberRecord,
  contracts: ContractRecord[],
  visits: VisitCounts,
  asOf: Date
): BuiltMember {
  const contract = currentContract(contracts);
  if (!contract) {
    return {
      ok: false,
      member_id: record.member_id,
      reason: "No contract on file, so there is no term for any call to date from. Not routed.",
    };
  }

  const status = contractStatus(contract, asOf);
  const signals = deriveSignals(record.join_date, visits, asOf);
  const cohort = classifyCohort(status, signals);
  const meta = COHORT_ACTIONS[cohort];

  return {
    ok: true,
    member: {
      member_id: record.member_id,
      name: record.name,
      phone: record.mobile ?? "",
      cohort,
      contact: meta.contact,
      channel: meta.channel,
      action: meta.action,
      reason: cohortReason(
        record.name,
        cohort,
        signals.tenure_days,
        signals.old_rate,
        signals.days_since_visit,
        contract.auto_renew
      ),
      auto_renew: contract.auto_renew,
      contract_type: contract.contract_type,
      contract_status: status,
      expiry_date: contract.end_date,
      monthly_fee: contract.monthly_fee,
      renewal_fee: contract.renewal_fee,
      cancellation_requested: record.cancellation_requested,
      signals: {
        days_since_visit: signals.days_since_visit,
        old_rate: signals.old_rate,
        tenure_days: signals.tenure_days,
        visit_count_90d: signals.visit_count_90d,
      },
    },
  };
}
