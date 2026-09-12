import gymsData from "@/data/gyms.json";
import type { CallType } from "@/lib/callType";

/**
 * Per-gym facts and per-gym-per-call-type incentive blocks.
 *
 * Everything gym-specific reaches the call as a dynamic variable, so one prompt
 * per call type serves every gym with no per-gym forks and no branching inside
 * the prompt. Changing a gym's rules is a data edit, not a prompt edit.
 *
 * There are two gyms in the file rather than one because "one agent, config per
 * gym" is the scalability claim, and switching between them live is the only way
 * to show it instead of asserting it. They are deliberately opposites:
 * Southbank has a discount, a guest pass, a PT session, two sister sites and
 * online training; Kensington has none of that and one room. The second gym is
 * what exercises the hardest guardrail in the brief — "if the incentives
 * section says you have nothing, you have nothing".
 *
 * Long term this file is written by the onboarding questionnaire. The incentive
 * blocks are stored as the finished plain-English text rather than generated
 * from flags, because the text is what the gym signs off on and what an auditor
 * needs to read. Every block ends with a sentence that closes the door on
 * everything else; without it the agent fills the gap with something the gym
 * never agreed to.
 */
export interface GymIncentives {
  renewal: string;
  reengagement: string;
  winback: string;
}

export interface Gym {
  gym_id: string;
  gym_name: string;
  opening_hours: string;
  quiet_hours: string;
  /** "none" when single-site — the winback prompt branches on that literal. */
  other_locations: string;
  has_online: "yes" | "no";
  books_classes: "yes" | "no";
  incentives: GymIncentives;
}

const config = gymsData as { default_gym_id: string; gyms: Gym[] };

export const gyms: Gym[] = config.gyms;

export const DEFAULT_GYM_ID = config.default_gym_id;

export function getGym(gymId?: string | null): Gym {
  const wanted = gymId ?? DEFAULT_GYM_ID;
  const found = gyms.find((g) => g.gym_id === wanted);
  if (found) return found;
  // An unknown gym_id is a client bug, not a reason to fail a call — fall back
  // to the default rather than dialling with empty gym facts.
  return gyms.find((g) => g.gym_id === DEFAULT_GYM_ID) ?? gyms[0];
}

export function incentivesFor(gym: Gym, callType: CallType): string {
  return gym.incentives[callType];
}
