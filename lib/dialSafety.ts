/**
 * Owns: deciding which number, if any, may be dialled or texted for a member (CALL_OVERRIDE_NUMBER rules).
 * Not here: whether the member is due a call at all, which lives in lib/callType.ts and lib/eligibility.ts.
 */
import datasetMeta from "@/data/dataset_meta.json";
import type { MemberSource } from "@/lib/memberSource";

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
 * did. So the dataset declares itself synthetic, and where each member came from
 * decides what may be dialled:
 *
 * - override set                         → dial the override. Normal operation.
 * - synthetic dataset member, no override → refuse, always. No setting dials
 *   a number that belongs to a stranger.
 * - uploaded member, no override          → refuse unless
 *   `ALLOW_UNVERIFIED_NUMBERS=true`, the deliberate opt-in for a gym's own
 *   members with consent, typed out by someone who has read this.
 * - a non-synthetic dataset, no override  → dial the member.
 *
 * Tying the opt-in to uploaded members means switching a deployment back to the
 * dataset can't leave it dialling the fake numbers because the flag is still set.
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

/**
 * The test number typed into the sidebar: an Australian mobile after a fixed
 * +61. It stands in for CALL_OVERRIDE_NUMBER on the call it's sent with, and
 * only as a whole override: it goes through `resolveDialTarget` exactly as the
 * env var would, so nothing about the synthetic-number refusal changes.
 *
 * Absent or blank is "no test number", and the env var stands. Anything else
 * must be a mobile (9 digits starting with 4, or 10 with the leading 0) or the
 * call is refused — a mistyped test number never falls through to another one.
 */
export function parseTestNumber(raw: unknown): { ok: true; number: string | null } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, number: null };
  if (typeof raw !== "string") return { ok: false, reason: "test_number must be a string." };
  const digits = raw.replace(/[\s-]/g, "");
  if (digits === "") return { ok: true, number: null };
  const local = /^0\d{9}$/.test(digits) ? digits.slice(1) : digits;
  if (!/^4\d{8}$/.test(local)) {
    return { ok: false, reason: "The test number isn't an Australian mobile. Type the 9 digits after +61, like 470517310." };
  }
  return { ok: true, number: `+61${local}` };
}

/** The environment a call is dialled under: the sidebar's test number, when given, in place of CALL_OVERRIDE_NUMBER. */
export function withTestNumber(testNumber: string | null, env: Record<string, string | undefined> = process.env) {
  return testNumber ? { ...env, CALL_OVERRIDE_NUMBER: testNumber } : env;
}

export function resolveDialTarget(
  memberPhone: string,
  source: MemberSource,
  env: Record<string, string | undefined> = process.env,
  datasetIsSynthetic = DATASET_IS_SYNTHETIC
): DialTarget {
  const override = env.CALL_OVERRIDE_NUMBER?.trim();
  if (override) {
    return { allowed: true, to: override, overridden: true, reason: null };
  }

  if (source.kind === "dataset" && datasetIsSynthetic) {
    return {
      allowed: false,
      to: null,
      overridden: false,
      reason:
        "This member is from the synthetic dataset and CALL_OVERRIDE_NUMBER is not set, so the number " +
        "on file belongs to a stranger rather than to a member. Set CALL_OVERRIDE_NUMBER to a verified handset.",
    };
  }

  if (source.kind === "supabase" && env.ALLOW_UNVERIFIED_NUMBERS !== "true") {
    return {
      allowed: false,
      to: null,
      overridden: false,
      reason:
        "This member was uploaded for a gym and CALL_OVERRIDE_NUMBER is not set. Dialling a gym's real members " +
        "needs ALLOW_UNVERIFIED_NUMBERS=true, set deliberately once the gym has confirmed consent.",
    };
  }

  if (!memberPhone.trim()) {
    return { allowed: false, to: null, overridden: false, reason: "There is no mobile number on file for this member." };
  }

  return { allowed: true, to: memberPhone, overridden: false, reason: null };
}
