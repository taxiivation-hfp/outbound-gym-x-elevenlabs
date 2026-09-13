/**
 * Owns: picking the member source (dataset or one gym's upload) and which gym a member may be called as.
 * Not here: the Supabase queries for uploaded members, which live in lib/memberStore.ts.
 */
import membersData from "@/data/members_scored.json";
import { today } from "@/lib/clock";
import { listGyms } from "@/lib/gymStore";
import { loadGymMember, loadGymMembers } from "@/lib/memberStore";
import type { Member } from "@/lib/types";

/**
 * Where members come from: the synthetic dataset, or a gym's uploaded exports.
 *
 * `MEMBER_SOURCE` picks, and the default is the dataset, so a deployment that
 * sets nothing behaves exactly as it did before member upload existed.
 *
 *   MEMBER_SOURCE=dataset                      data/members_scored.json (default)
 *   MEMBER_SOURCE=supabase MEMBER_SOURCE_GYM_ID=<gym>  that gym's uploaded members
 *   MEMBER_SOURCE=onboarded                    the uploaded members of the gym saved at
 *                                              /onboarding (the demo's first run)
 *
 * `onboarded` is its own value rather than "supabase with no gym id", which is
 * still refused: a forgotten variable must not quietly pick a gym. It resolves
 * to the gym the queue calls as (`listGyms().default_gym_id`, the same one the
 * first run checks), read from the gyms table on every call — so after a reset
 * and a new gym saved, the queue follows the new gym without a redeploy.
 *
 * Supabase-sourced members are derived fresh on every read — the queue at
 * render time, and one member again at dial time — so a renewal imported after
 * the queue was built is what the call route sees. A misconfigured source
 * throws with the reason rather than quietly falling back to the synthetic
 * members, which would put strangers' fake numbers back in front of the dial
 * button without anyone having chosen that.
 */

const datasetMembers = membersData as Member[];

export type MemberSource = { kind: "dataset" } | { kind: "supabase"; gymId: string };

export class MemberSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberSourceError";
  }
}

/**
 * `onboardedGymId` is only read for `MEMBER_SOURCE=onboarded`, and only
 * `currentMemberSource` supplies it; without one that setting is refused.
 */
export function memberSource(
  env: Record<string, string | undefined> = process.env,
  onboardedGymId: string | null = null
): MemberSource {
  const source = env.MEMBER_SOURCE?.trim() || "dataset";
  if (source === "dataset") return { kind: "dataset" };
  if (source === "onboarded") {
    if (env.DATASET_CLOCK !== "live") {
      throw new MemberSourceError(
        "Uploaded members are only read against today's date. Set DATASET_CLOCK=live alongside MEMBER_SOURCE=onboarded — the frozen date belongs to the synthetic dataset."
      );
    }
    if (!onboardedGymId) {
      throw new MemberSourceError("MEMBER_SOURCE=onboarded reads the members of the gym saved at /onboarding, and no gym is saved yet.");
    }
    return { kind: "supabase", gymId: onboardedGymId };
  }
  if (source === "supabase") {
    const gymId = env.MEMBER_SOURCE_GYM_ID?.trim();
    if (!gymId) {
      throw new MemberSourceError(
        "MEMBER_SOURCE=supabase needs MEMBER_SOURCE_GYM_ID set to the gym whose uploaded members to use. No gym is assumed."
      );
    }
    // The frozen date belongs to the synthetic dataset. Real members measured
    // against it would be routed, called and texted on the wrong day, so every
    // reader — the queue, the call route, send_text, the nightly job — refuses.
    if (env.DATASET_CLOCK !== "live") {
      throw new MemberSourceError(
        "Uploaded members are only read against today's date. Set DATASET_CLOCK=live alongside MEMBER_SOURCE=supabase — the frozen date belongs to the synthetic dataset."
      );
    }
    return { kind: "supabase", gymId };
  }
  throw new MemberSourceError(`MEMBER_SOURCE must be "dataset", "supabase" or "onboarded", not "${source}".`);
}

/** The gym `MEMBER_SOURCE=onboarded` follows: the default gym, when it is a row in the gyms table. */
export async function onboardedGymId(): Promise<string | null> {
  const listing = await listGyms();
  if (listing.source !== "supabase") return null;
  return listing.gyms.some((g) => g.gym_id === listing.default_gym_id) ? listing.default_gym_id : null;
}

/** `memberSource` for a caller that can wait: resolves `onboarded` to its gym first. */
export async function currentMemberSource(env: Record<string, string | undefined> = process.env): Promise<MemberSource> {
  if (env.MEMBER_SOURCE?.trim() !== "onboarded") return memberSource(env);
  return memberSource(env, await onboardedGymId());
}

/**
 * The gym a call or text must speak for, given where its member came from.
 *
 * A gym's uploaded members belong to that gym. Calling one of them under
 * another gym's config would put the other gym's name and offers in the agent's
 * mouth, so for Supabase-sourced members the source gym is the default and any
 * other gym is refused. Synthetic members belong to no gym, so any gym's rules
 * may be tried on them, which is the dashboard's gym switch.
 */
export function gymForMember(
  source: MemberSource,
  requestedGymId: string | null
): { ok: true; gymId: string | null } | { ok: false; reason: string } {
  if (source.kind === "dataset") return { ok: true, gymId: requestedGymId };
  if (requestedGymId !== null && requestedGymId !== source.gymId) {
    return {
      ok: false,
      reason: `This member was uploaded for "${source.gymId}", so they can't be contacted as "${requestedGymId}".`,
    };
  }
  return { ok: true, gymId: source.gymId };
}

export interface MemberList {
  members: Member[];
  source: MemberSource;
  unrouted: Array<{ member_id: string; reason: string }>;
}

/**
 * A synthetic member's name, for greeting them on a texted link's page. Null
 * for anything else, including every uploaded member: that page can be opened by
 * anyone who edits the link, so it never shows a real person's name.
 */
export function datasetMemberName(memberId: string, env: Record<string, string | undefined> = process.env): string | null {
  let source: MemberSource;
  try {
    source = memberSource(env);
  } catch {
    return null;
  }
  if (source.kind !== "dataset") return null;
  return datasetMembers.find((m) => m.member_id === memberId)?.name ?? null;
}

export async function loadMembers(asOf: Date = today()): Promise<MemberList> {
  const source = await currentMemberSource();
  if (source.kind === "dataset") return { members: datasetMembers, source, unrouted: [] };
  const loaded = await loadGymMembers(source.gymId, asOf);
  return { members: loaded.members, source, unrouted: loaded.unrouted };
}

export async function loadMember(
  memberId: string,
  asOf: Date = today()
): Promise<{ member: Member | null; source: MemberSource; unroutedReason: string | null }> {
  const source = await currentMemberSource();
  if (source.kind === "dataset") {
    return { member: datasetMembers.find((m) => m.member_id === memberId) ?? null, source, unroutedReason: null };
  }
  const loaded = await loadGymMember(source.gymId, memberId, asOf);
  return { member: loaded.member, source, unroutedReason: loaded.unroutedReason };
}
