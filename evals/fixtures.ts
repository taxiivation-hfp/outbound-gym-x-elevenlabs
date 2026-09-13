import { DATA_AS_OF } from "@/lib/clock";
import type { Member } from "@/lib/types";

/**
 * Synthetic members for the eval suite.
 *
 * Deliberately not drawn from `members_scored.json`: a scenario has to pin the
 * exact situation it is testing — seven months left, absent five weeks, lapsed
 * three weeks — and dataset rows drift when the generator is re-run. Dates are
 * expressed as offsets from the dataset's reference date so the routing these
 * fixtures produce never changes.
 *
 * They go through `routeMember` and `compileVariables` like any real member, so
 * the suite tests the payload the live call would actually send rather than a
 * hand-written approximation of it.
 */

export function isoOffset(days: number): string {
  const d = new Date(DATA_AS_OF.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

let seq = 0;

export function fixtureMember(overrides: Partial<Member> = {}): Member {
  seq += 1;
  const base: Member = {
    member_id: `E${String(seq).padStart(4, "0")}`,
    name: "Sarah Whitlock",
    phone: "+61400000000",
    cohort: "steady",
    contact: true,
    channel: "ai_call",
    action: "outbound call",
    reason: "eval fixture",
    auto_renew: false,
    contract_type: "12-month",
    contract_status: "active",
    expiry_date: isoOffset(12),
    monthly_fee: 79,
    renewal_fee: 79,
    cancellation_requested: null,
    signals: {
      days_since_visit: 3,
      old_rate: 2.4,
      tenure_days: 240,
      visit_count_90d: 30,
    },
    ...overrides,
  };
  if (overrides.signals) base.signals = { ...base.signals, ...overrides.signals };
  return base;
}

/** Still training, fixed term ends in twelve days → renewal. */
export const renewalMember = () =>
  fixtureMember({
    name: "Sarah Whitlock",
    expiry_date: isoOffset(12),
    signals: { days_since_visit: 3, old_rate: 2.4, tenure_days: 240, visit_count_90d: 30 },
  });

/** Absent five weeks, seven months left on the term → reengagement, far expiry_line. */
export const earlyAbsenceMember = () =>
  fixtureMember({
    name: "Dr. Jordan Hill PhD",
    expiry_date: isoOffset(212),
    signals: { days_since_visit: 35, old_rate: 2.8, tenure_days: 300, visit_count_90d: 14 },
  });

/** Absent five weeks with thirteen days left → reengagement, near expiry_line. */
export const nearExpiryAbsentMember = () =>
  fixtureMember({
    name: "Michael Farrow",
    expiry_date: isoOffset(13),
    signals: { days_since_visit: 35, old_rate: 2.2, tenure_days: 400, visit_count_90d: 10 },
  });

/**
 * Auto-renewing, away two months after a settled habit, asked to cancel three
 * days ago → cancellation. The exact member the exclusion used to refuse.
 */
export const cancellationMember = () =>
  fixtureMember({
    name: "Tom Reilly",
    auto_renew: true,
    contract_type: "month-to-month",
    expiry_date: isoOffset(12),
    cancellation_requested: `${isoOffset(-3)}T18:30:00`,
    signals: { days_since_visit: 60, old_rate: 2.3, tenure_days: 500, visit_count_90d: 2 },
  });

/** Lapsed three weeks ago → winback, one-month window. */
export const winbackMember = () =>
  fixtureMember({
    name: "Aisha Brennan",
    contract_status: "expired",
    contract_type: "6-month",
    expiry_date: isoOffset(-24),
    monthly_fee: 69,
    renewal_fee: 69,
    signals: { days_since_visit: 52, old_rate: 1.9, tenure_days: 320, visit_count_90d: 3 },
  });
