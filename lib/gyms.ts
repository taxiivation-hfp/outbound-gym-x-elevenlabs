import gymsData from "@/data/gyms.json";
import { parseGymConfig, type GymConfig } from "@/lib/gymConfig";

/**
 * The seed gyms, from `data/gyms.json`.
 *
 * Gym config lives in the Supabase `gyms` table once its migration is applied
 * (`lib/gymStore.ts` reads it), and the onboarding flow writes new rows there.
 * This file is where the two original gyms are defined, and it stays in the
 * repo for three reasons: it is what the migration seeds the table with, it is
 * what the deterministic guards and conversation scenarios compile against
 * without a network, and it documents what a gym config looks like.
 *
 * There are two gyms rather than one because "one agent, config per gym" is the
 * scalability claim, and switching between them live is the only way to show it
 * instead of asserting it. They are deliberately opposites: Southbank has a
 * discount, a guest pass, a PT session, a cheaper tier, two sister sites and
 * online training; Kensington has none of that and one room. The second gym is
 * what exercises the hardest guardrail in the brief — "if the incentives
 * section says you have nothing, you have nothing".
 *
 * The file holds typed values only. The incentive wording each gym used to
 * carry as prose is now compiled by `lib/incentives.ts`, and a guard pins that
 * both gyms still compile to the exact words they had.
 */
export type Gym = GymConfig;

function loadSeed(): { defaultGymId: string; gyms: GymConfig[] } {
  const config = gymsData as { default_gym_id: string; gyms: unknown[] };
  const gyms = config.gyms.map((raw, i) => {
    const parsed = parseGymConfig(raw);
    if (!parsed.ok) {
      // A checked-in seed that fails the same validation a form post faces is a
      // bug in the repo, and it should stop the build rather than reach a call.
      throw new Error(`data/gyms.json gym #${i + 1} is invalid: ${JSON.stringify(parsed.errors)}`);
    }
    return parsed.value;
  });
  if (!gyms.some((g) => g.gym_id === config.default_gym_id)) {
    throw new Error(`data/gyms.json default_gym_id "${config.default_gym_id}" is not one of its gyms`);
  }
  return { defaultGymId: config.default_gym_id, gyms };
}

const seed = loadSeed();

export const gyms: Gym[] = seed.gyms;

export const DEFAULT_GYM_ID = seed.defaultGymId;

/**
 * A seed gym by id. Used where no database is involved — the guards, the
 * scenarios — and as the fallback `lib/gymStore.ts` reads before the `gyms`
 * migration has been applied. An unknown id falls back to the default gym, which
 * is only ever reached by those offline callers; the call route resolves gyms
 * through the store and refuses an unknown id instead.
 */
export function getGym(gymId?: string | null): Gym {
  const wanted = gymId ?? DEFAULT_GYM_ID;
  return gyms.find((g) => g.gym_id === wanted) ?? (gyms.find((g) => g.gym_id === DEFAULT_GYM_ID) as Gym);
}
