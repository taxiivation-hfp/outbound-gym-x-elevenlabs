import membersData from "@/data/members_scored.json";
import { today } from "@/lib/clock";
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

export function memberSource(env: Record<string, string | undefined> = process.env): MemberSource {
  const source = env.MEMBER_SOURCE?.trim() || "dataset";
  if (source === "dataset") return { kind: "dataset" };
  if (source === "supabase") {
    const gymId = env.MEMBER_SOURCE_GYM_ID?.trim();
    if (!gymId) {
      throw new MemberSourceError(
        "MEMBER_SOURCE=supabase needs MEMBER_SOURCE_GYM_ID set to the gym whose uploaded members to use. No gym is assumed."
      );
    }
    return { kind: "supabase", gymId };
  }
  throw new MemberSourceError(`MEMBER_SOURCE must be "dataset" or "supabase", not "${source}".`);
}

export interface MemberList {
  members: Member[];
  source: MemberSource;
  unrouted: Array<{ member_id: string; reason: string }>;
}

export async function loadMembers(asOf: Date = today()): Promise<MemberList> {
  const source = memberSource();
  if (source.kind === "dataset") return { members: datasetMembers, source, unrouted: [] };
  const loaded = await loadGymMembers(source.gymId, asOf);
  return { members: loaded.members, source, unrouted: loaded.unrouted };
}

export async function loadMember(
  memberId: string,
  asOf: Date = today()
): Promise<{ member: Member | null; source: MemberSource; unroutedReason: string | null }> {
  const source = memberSource();
  if (source.kind === "dataset") {
    return { member: datasetMembers.find((m) => m.member_id === memberId) ?? null, source, unroutedReason: null };
  }
  const loaded = await loadGymMember(source.gymId, memberId, asOf);
  return { member: loaded.member, source, unroutedReason: loaded.unroutedReason };
}
