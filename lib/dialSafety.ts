import datasetMeta from "@/data/dataset_meta.json";

/**
 * The last thing between this app and a stranger's phone.
 *
 * Every phone number in `members_scored.json` is Faker output. They are
 * well-formed Australian numbers, which is the problem: they are not invalid,
 * they belong to people who never joined a gym. `CALL_OVERRIDE_NUMBER` exists to
 * route every call and text to one verified handset, and in local development it
 * is always set.
 *
 * Relying on it being remembered in a second environment is not good enough. A
 * deployment with the agent ids filled in and the override left blank would dial
 * 173 real Australians, and it would look exactly like a working demo while it
 * did. So the dataset declares itself synthetic and this refuses to dial it:
 *
 * - override set          → dial the override. Normal operation.
 * - synthetic, no override → refuse, and say why.
 * - real data, no override → dial the member. What production looks like.
 *
 * `ALLOW_UNVERIFIED_NUMBERS=true` is the deliberate escape hatch, and it has to
 * be typed out by someone who has read this.
 */
const DATASET_IS_SYNTHETIC = (datasetMeta as { synthetic?: boolean }).synthetic === true;

export interface DialTarget {
  allowed: boolean;
  /** The number to actually dial, when allowed. */
  to: string | null;
  /** Whether `to` is the override rather than the member's own number. */
  overridden: boolean;
  /** Why not, when refused — written to be read by an operator. */
  reason: string | null;
}

export function resolveDialTarget(memberPhone: string): DialTarget {
  const override = process.env.CALL_OVERRIDE_NUMBER?.trim();
  if (override) {
    return { allowed: true, to: override, overridden: true, reason: null };
  }

  if (DATASET_IS_SYNTHETIC && process.env.ALLOW_UNVERIFIED_NUMBERS !== "true") {
    return {
      allowed: false,
      to: null,
      overridden: false,
      reason:
        "This dataset is synthetic and CALL_OVERRIDE_NUMBER is not set, so the number " +
        "on file belongs to a stranger rather than to a member. Set " +
        "CALL_OVERRIDE_NUMBER to a verified handset — or, on real member data, set " +
        "ALLOW_UNVERIFIED_NUMBERS=true deliberately.",
    };
  }

  return { allowed: true, to: memberPhone, overridden: false, reason: null };
}
