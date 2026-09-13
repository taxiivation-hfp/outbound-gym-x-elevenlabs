/**
 * Owns: the display order of members — cohort priority first, then longest since last visit.
 * Not here: who is actually due a call is decided by lib/callType.ts and lib/eligibility.ts.
 */
import type { Cohort } from "@/lib/types";

// Actionability/urgency order, not alphabetical or generation order —
// winback is time-sensitive (contract already expired/expiring), sleeping_dog
// surfaces early despite being no-action since "who we correctly didn't call"
// is part of the pitch.
const cohortPriority: Record<Cohort, number> = {
  winback: 0,
  sliding: 1,
  new_joiner: 2,
  sleeping_dog: 3,
  steady: 4,
};

/** Anything carrying a cohort and a dormancy figure can be ordered by this. */
interface Rankable {
  cohort: Cohort;
  days_since_visit: number;
}

export function sortByPriority<T extends Rankable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const cohortDiff = cohortPriority[a.cohort] - cohortPriority[b.cohort];
    if (cohortDiff !== 0) return cohortDiff;
    return b.days_since_visit - a.days_since_visit;
  });
}
