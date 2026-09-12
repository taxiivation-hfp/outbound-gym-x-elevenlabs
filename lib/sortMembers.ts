import type { Cohort, Member } from "@/lib/types";

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

export function sortMembersByPriority(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const cohortDiff = cohortPriority[a.cohort] - cohortPriority[b.cohort];
    if (cohortDiff !== 0) return cohortDiff;
    return b.signals.days_since_visit - a.signals.days_since_visit;
  });
}
