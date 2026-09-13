import type { Eligibility } from "@/lib/eligibility";

/**
 * The refusal `/api/call` sends for a member who may not be called.
 *
 * Kept outside the route file so the guards can pin the exact response a
 * hand-rolled POST gets — for an auto-renewing member, a 403 naming the
 * auto-renew rule — without a network or a database.
 */
export interface CallRefusal {
  status: 403;
  body: { error: string; blocked_by: Eligibility["blockedBy"]; reason: string | null };
}

export function callRefusal(eligibility: Eligibility): CallRefusal | null {
  if (eligibility.allowed && eligibility.routing.call_type) return null;
  return {
    status: 403,
    body: {
      error: "Member is not eligible for an outbound call",
      blocked_by: eligibility.blockedBy,
      reason: eligibility.blockedReason,
    },
  };
}
