/**
 * Owns: deciding whether the app is still on its first run — no gym saved, or that gym has no members yet.
 * Not here: what the screens do with it (the operator pages redirect, the configuration pages hide the
 * navigation), and the reset that puts the app back here (lib/demoReset.ts).
 */
import { listGyms } from "@/lib/gymStore";
import { memberDataCounts } from "@/lib/memberStore";
import { onboardingWritesEnabled } from "@/lib/onboardingWrites";

/**
 * The product tells its story in order: save a gym, import its members, then
 * everything else. Until both are done the configuration screens render without
 * the navigation and the operator screens send people back to them.
 *
 * "The gym" is the one the queue calls as, `listGyms().default_gym_id`, and it
 * counts only if that id is actually a row in the gyms table. Members count once
 * that gym has at least one row in `members`.
 *
 * Gated only where the first run can be finished: the gyms table is being read
 * (not the seed) and onboarding writes are on. Anywhere else nobody could save
 * a gym or import a member, so gating would lock the app on a screen whose
 * buttons are switched off; the app behaves as it did before instead. A member
 * count that can't be read ungates for the same reason, and says so in the log.
 */
export type FirstRun =
  | { gated: false }
  | { gated: true; step: "gym"; gymId: null }
  | { gated: true; step: "members"; gymId: string; gymName: string };

export async function firstRunState(): Promise<FirstRun> {
  if (!onboardingWritesEnabled()) return { gated: false };
  const listing = await listGyms();
  if (listing.source !== "supabase") return { gated: false };

  const gym = listing.gyms.find((g) => g.gym_id === listing.default_gym_id);
  if (!gym) return { gated: true, step: "gym", gymId: null };

  try {
    const counts = await memberDataCounts(gym.gym_id);
    if (counts.members > 0) return { gated: false };
  } catch (err) {
    console.error("First-run check couldn't count members; showing the full app:", err);
    return { gated: false };
  }
  return { gated: true, step: "members", gymId: gym.gym_id, gymName: gym.gym_name };
}

/** Where a gated operator screen sends people: the step they're on. */
export function firstRunPath(state: Extract<FirstRun, { gated: true }>): string {
  return state.step === "gym" ? "/onboarding" : `/onboarding/${encodeURIComponent(state.gymId)}/members`;
}
