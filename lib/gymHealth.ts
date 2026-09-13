import { ROUTING_THRESHOLDS, type CallType } from "@/lib/callType";
import { daysUntil } from "@/lib/clock";
import type { Eligibility } from "@/lib/eligibility";
import { parseLocalInstant } from "@/lib/memberData";
import type { Member } from "@/lib/types";

/**
 * The numbers an operator runs their week on, from data the product already
 * holds: who is a member, what they pay, when their term ends, when they come in.
 *
 * Pure functions over `Member` rows and check-in counts, so the intelligence
 * page, `/api/intelligence` and the guards all compute them the same way. Every
 * trend is the gym's own, measured over its own history — nothing here is
 * compared with any other gym or any industry figure.
 *
 * Two things the data cannot say, and so these functions don't claim:
 *
 * - **A member who left before the data begins is invisible.** A "lost member"
 *   is one whose current term has ended; an export that only lists recent
 *   members makes older months look healthier than they were.
 * - **An auto-renewing member's end date is the next rollover, not an expiry.**
 *   They are active until they cancel, and cancellation is not an event in the
 *   data, so they are never counted as "expiring".
 */

const DAY_MS = 86_400_000;

function midnight(asOf: Date): number {
  return Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

// --- Membership over time ---------------------------------------------------------

/** The day the member joined, from tenure as of the reference date. */
export function joinedOn(member: Member, asOf: Date): number {
  return midnight(asOf) - member.signals.tenure_days * DAY_MS;
}

/** The router's own definition of a membership that has ended. */
export function hasLapsed(member: Member, asOf: Date): boolean {
  return member.contract_status === "expired" || daysUntil(member.expiry_date, asOf) < 0;
}

/** The last day a lapsed member was paying, or null for a live membership. */
export function lastPaidDay(member: Member, asOf: Date): number | null {
  return hasLapsed(member, asOf) ? Date.parse(`${member.expiry_date}T00:00:00Z`) : null;
}

/** Was this member a member on that day? */
export function memberOn(member: Member, day: number, asOf: Date): boolean {
  const last = lastPaidDay(member, asOf);
  return joinedOn(member, asOf) <= day && (last === null || last >= day);
}

export interface MonthHealth {
  /** `YYYY-MM`. */
  month: string;
  /** True for the month the reference date falls in, which is counted to date. */
  to_date: boolean;
  members_at_start: number;
  /** Members at the start of the month whose last paid day fell inside it. */
  lost: number;
  churn_rate: number | null;
  retention_rate: number | null;
}

export interface MembershipHealth {
  active: number;
  /** Live fixed-term memberships whose term ends inside the window. Auto-renewers roll over and are not counted. */
  expiring: { within_14: number; within_30: number; within_90: number };
  auto_renewing_active: number;
  /** `monthly_fee` summed across active members. */
  mrr: number;
  /** MRR ÷ active members. */
  arpm: number | null;
  months: MonthHealth[];
  ninety_day: NinetyDayRetention;
}

export interface NinetyDayRetention {
  /** Joiners old enough to measure, from this window. */
  joined_from: string;
  joined_to: string;
  measured: number;
  /** Still a member 120 days after joining: the first paid month plus 90 days. */
  retained: number;
  rate: number | null;
}

/** Six complete calendar months and the current month to date. */
export const HEALTH_MONTHS = 6;
/** The first paid month (30 days) plus the 90 days the measure is named for. */
export const NINETY_DAY_MARK_DAYS = 120;
/** Joiners whose 120-day mark fell in the last year. */
const NINETY_DAY_WINDOW_DAYS = 365;

export function monthlyHealth(members: Member[], asOf: Date, months = HEALTH_MONTHS): MonthHealth[] {
  const today = midnight(asOf);
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const out: MonthHealth[] = [];
  for (let i = months; i >= 0; i -= 1) {
    const start = Date.UTC(y, m - i, 1);
    const end = i === 0 ? today : Date.UTC(y, m - i + 1, 1);
    const atStart = members.filter((member) => memberOn(member, start, asOf));
    const lost = atStart.filter((member) => {
      const last = lastPaidDay(member, asOf);
      return last !== null && last >= start && last < end;
    }).length;
    const churn = ratio(lost, atStart.length);
    out.push({
      month: isoDay(start).slice(0, 7),
      to_date: i === 0,
      members_at_start: atStart.length,
      lost,
      churn_rate: churn,
      retention_rate: churn === null ? null : 1 - churn,
    });
  }
  return out;
}

export function ninetyDayRetention(members: Member[], asOf: Date): NinetyDayRetention {
  const today = midnight(asOf);
  const latestJoin = today - NINETY_DAY_MARK_DAYS * DAY_MS;
  const earliestJoin = latestJoin - NINETY_DAY_WINDOW_DAYS * DAY_MS;
  const measured = members.filter((member) => {
    const joined = joinedOn(member, asOf);
    return joined >= earliestJoin && joined <= latestJoin;
  });
  const retained = measured.filter((member) => {
    const last = lastPaidDay(member, asOf);
    return last === null || last >= joinedOn(member, asOf) + NINETY_DAY_MARK_DAYS * DAY_MS;
  }).length;
  return {
    joined_from: isoDay(earliestJoin),
    joined_to: isoDay(latestJoin),
    measured: measured.length,
    retained,
    rate: ratio(retained, measured.length),
  };
}

export function membershipHealth(members: Member[], asOf: Date): MembershipHealth {
  const active = members.filter((member) => !hasLapsed(member, asOf));
  const fixedEndingWithin = (days: number) =>
    active.filter((member) => {
      if (member.auto_renew) return false;
      const left = daysUntil(member.expiry_date, asOf);
      return left >= 0 && left <= days;
    }).length;
  const mrr = active.reduce((sum, member) => sum + member.monthly_fee, 0);
  return {
    active: active.length,
    expiring: { within_14: fixedEndingWithin(14), within_30: fixedEndingWithin(30), within_90: fixedEndingWithin(90) },
    auto_renewing_active: active.filter((member) => member.auto_renew).length,
    mrr,
    arpm: ratio(mrr, active.length),
    months: monthlyHealth(members, asOf),
    ninety_day: ninetyDayRetention(members, asOf),
  };
}

// --- Revenue in each call queue -----------------------------------------------------

export interface QueueRevenue {
  members: number;
  /** `monthly_fee` summed. For winback this is what the lapsed members used to pay. */
  monthly_fees: number;
}

/** From the same eligibility the queue and `/api/call` use. */
export function revenueAtRisk(evaluated: Array<{ member: Member; eligibility: Eligibility }>): Record<CallType, QueueRevenue> {
  const out: Record<CallType, QueueRevenue> = {
    renewal: { members: 0, monthly_fees: 0 },
    reengagement: { members: 0, monthly_fees: 0 },
    winback: { members: 0, monthly_fees: 0 },
  };
  for (const { member, eligibility } of evaluated) {
    const type = eligibility.allowed ? eligibility.routing.call_type : null;
    if (!type) continue;
    out[type].members += 1;
    out[type].monthly_fees += member.monthly_fee;
  }
  return out;
}

// --- Visit frequency ----------------------------------------------------------------

export interface FrequencySegments {
  /** Active members only. */
  total: number;
  /** In within the absence window and historically at least the habit rate. */
  frequent: number;
  /** In within the absence window, historically below the habit rate. */
  occasional: number;
  /** Absent for the absence window or longer, after a settled habit — who reengagement is for. */
  inactive_after_habit: number;
  /** Absent for the absence window or longer, and never a regular. */
  inactive_never_regular: number;
  thresholds: { absence_days: number; habit_min_rate: number };
}

/**
 * Frequent, occasional and inactive, cut at the router's own thresholds: absent
 * `ABSENCE_DAYS` or more is inactive, and `HABIT_MIN_RATE` visits a week before
 * the last four weeks is a habit. The screen and the queue can't disagree about
 * who is inactive, because they read the same two numbers.
 */
export function frequencySegments(members: Member[], asOf: Date): FrequencySegments {
  const { ABSENCE_DAYS, HABIT_MIN_RATE } = ROUTING_THRESHOLDS;
  const out: FrequencySegments = {
    total: 0,
    frequent: 0,
    occasional: 0,
    inactive_after_habit: 0,
    inactive_never_regular: 0,
    thresholds: { absence_days: ABSENCE_DAYS, habit_min_rate: HABIT_MIN_RATE },
  };
  for (const member of members) {
    if (hasLapsed(member, asOf)) continue;
    out.total += 1;
    const habit = member.signals.old_rate >= HABIT_MIN_RATE;
    if (member.signals.days_since_visit >= ABSENCE_DAYS) {
      if (habit) out.inactive_after_habit += 1;
      else out.inactive_never_regular += 1;
    } else if (habit) {
      out.frequent += 1;
    } else {
      out.occasional += 1;
    }
  }
  return out;
}

// --- Check-in activity ------------------------------------------------------------------

/** Weeks of attendance shown as a trend. */
export const TREND_WEEKS = 12;
/** Weeks of check-ins the time-of-day grid is built from. */
export const BUSY_WEEKS = 12;

export interface CheckinActivity {
  /** Seven-day windows of completed days ending the day before the reference date, oldest first. `week_start` is the first day. */
  weeks: Array<{ week_start: string; visits: number }>;
  /** `by_hour[weekday][hour]`: visits over the last `BUSY_WEEKS`, Monday = 0, local gym time. */
  by_hour: number[][];
  busy_weeks: number;
}

function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

function weekStart(today: number, index: number): string {
  return isoDay(today - 7 * (index + 1) * DAY_MS);
}

/**
 * Check-in timestamps (local gym time, as imported) into weekly totals and a
 * weekday × hour grid. The database functions in the pass-one migration compute
 * the same thing for uploaded data; `npm run db:verify` checks they agree.
 */
export function summariseCheckins(timestamps: string[], asOf: Date): CheckinActivity {
  const today = midnight(asOf);
  const weeks = Array.from({ length: TREND_WEEKS }, () => 0);
  const grid = emptyGrid();
  for (const raw of timestamps) {
    const t = parseLocalInstant(raw);
    if (Number.isNaN(t)) continue;
    const at = new Date(t);
    const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const daysAgo = Math.round((today - day) / DAY_MS);
    // Completed days only, the pipeline's windows: the reference day itself is
    // still happening on a live clock.
    if (daysAgo < 1) continue;
    const index = Math.floor((daysAgo - 1) / 7);
    if (index < TREND_WEEKS) weeks[index] += 1;
    if (daysAgo <= BUSY_WEEKS * 7) grid[(at.getUTCDay() + 6) % 7][at.getUTCHours()] += 1;
  }
  return {
    weeks: weeks.map((visits, index) => ({ week_start: weekStart(today, index), visits })).reverse(),
    by_hour: grid,
    busy_weeks: BUSY_WEEKS,
  };
}

/** The same shape, from the database functions' rows. */
export function activityFromRows(
  asOf: Date,
  weekly: Array<{ weeks_ago: number | string; visits: number | string }>,
  hourly: Array<{ weekday: number | string; hour: number | string; visits: number | string }>
): CheckinActivity {
  const today = midnight(asOf);
  const weeks = Array.from({ length: TREND_WEEKS }, () => 0);
  for (const row of weekly) {
    const index = Number(row.weeks_ago);
    if (Number.isInteger(index) && index >= 0 && index < TREND_WEEKS) weeks[index] += Number(row.visits);
  }
  const grid = emptyGrid();
  for (const row of hourly) {
    const d = Number(row.weekday);
    const h = Number(row.hour);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) grid[d][h] += Number(row.visits);
  }
  return {
    weeks: weeks.map((visits, index) => ({ week_start: weekStart(today, index), visits })).reverse(),
    by_hour: grid,
    busy_weeks: BUSY_WEEKS,
  };
}

export interface AttendanceWeek {
  week_start: string;
  visits: number;
  /** Members on the first day of the week. */
  members: number;
  per_member: number | null;
}

export function attendanceTrend(activity: CheckinActivity, members: Member[], asOf: Date): AttendanceWeek[] {
  return activity.weeks.map((week) => {
    const day = Date.parse(`${week.week_start}T00:00:00Z`);
    const count = members.filter((member) => memberOn(member, day, asOf)).length;
    return { week_start: week.week_start, visits: week.visits, members: count, per_member: ratio(week.visits, count) };
  });
}

export interface Busyness {
  by_hour: number[][];
  /** Visits per hour of the day across every weekday, 0–23. */
  hour_totals: number[];
  busiest: Array<{ weekday: number; hour: number; visits: number }>;
  weeks: number;
}

export function busyness(activity: CheckinActivity): Busyness {
  const hourTotals = Array.from({ length: 24 }, (_, hour) => activity.by_hour.reduce((sum, day) => sum + day[hour], 0));
  const cells = activity.by_hour.flatMap((day, weekday) => day.map((visits, hour) => ({ weekday, hour, visits })));
  return {
    by_hour: activity.by_hour,
    hour_totals: hourTotals,
    busiest: cells.filter((c) => c.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 5),
    weeks: activity.busy_weeks,
  };
}
