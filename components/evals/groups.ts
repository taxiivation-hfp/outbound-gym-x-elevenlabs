/**
 * The logic checks, grouped by the claim each one backs.
 *
 * This file only sorts guard ids into headings. Whether a check passed, and how
 * many are in a group, is counted from the run file at render — a group lists
 * the ids below that are actually in the results, and any id in the results
 * that isn't listed here lands in "Other checks", so a new guard is never
 * hidden by a stale map. A check that backs none of these claims is left out on
 * purpose and shows there too (today: the extraction schema's size limit).
 */

export interface GuardGroupDef {
  title: string;
  ids: string[];
}

export const GUARD_GROUPS: GuardGroupDef[] = [
  {
    title: "Who gets called",
    ids: [
      "renewal-fires-for-training-member",
      "reengagement-fires-on-absence-with-habit",
      "near-expiry-absence-overrides-habit-guard",
      "winback-windows",
      "cooldown-lifts-when-the-call-worked",
      "no-answer-does-not-count-as-an-attempt",
      "clean-slate-history-is-attempt-one",
      "cancellation-flip-is-narrow",
      "cancellation-needs-something-to-offer",
    ],
  },
  {
    title: "Who doesn’t",
    ids: [
      "auto-renew-dormant-never-called",
      "auto-renew-near-rollover-never-called",
      "habit-guard-blocks-sporadic-member",
      "do-not-contact-is-permanent",
      "cooldown-after-a-call-that-changed-nothing",
      "attempt-cap",
      "cancellation-call-is-capped-at-one",
      "generated-cancellations-obey-both-exclusion-rules",
      "stale-queue-entry-refused-at-dial-time",
      "synthetic-numbers-never-dialled-real-numbers-need-opt-in",
      "uploaded-member-only-contacted-as-their-own-gym",
      "same-term-reexported-as-auto-renew-is-never-called",
      "conflicting-contract-rows-resolve-to-not-calling",
    ],
  },
  {
    title: "What the agent may offer",
    ids: [
      "gym-config-changes-the-offer",
      "seed-gyms-compile-to-signed-off-text",
      "every-config-compiles-to-a-valid-block",
      "gym-with-nothing-closes-every-door",
      "discount-without-cheaper-tier",
      "negative-discount-refused-everywhere",
      "offer-inside-cooldown-compiles-to-nothing",
      "offer-cooldowns-are-independent",
      "habit-guard-blocks-offers-regardless-of-cooldown",
      "schedule-names-only-configured-offers",
      "offer-history-spends-conservatively",
      "other-label-refused-or-compiled-naming-only-itself",
      "every-config-with-other-compiles-to-a-valid-block",
      "other-offer-is-scheduled-texted-and-never-extracted",
      "incentive-text-follows-the-compiled-offer",
      "cancellation-ignores-offer-schedule-and-habit-guard",
      "cancellation-blocks-name-only-the-configured-terms",
      "freeze-config-is-both-or-neither",
    ],
  },
  {
    title: "What it’s allowed to say",
    ids: [
      "winback-time-left-reads-correctly",
      "expiry-line-has-no-nested-placeholder",
      "every-variable-has-a-value",
      "first-name-only",
      "closed-loop-carries-the-reason-forward",
      "validator-rejects-appended-instruction",
      "validator-rejects-number-not-in-config",
      "validator-rejects-offer-not-in-config",
      "validator-requires-door-closing-sentence",
      "validator-rejects-wrong-delivery",
      "validator-rejects-self-contradicting-block",
      "validator-checks-the-other-label",
      "prior-call-text-cannot-instruct-the-next-call",
      "tier-name-cannot-smuggle-an-offer",
      "unsafe-free-text-refused",
      "empty-quiet-hours-admits-absence",
      "missing-renewal-fee-stays-unknown",
      "themed-summary-never-reaches-a-prompt",
    ],
  },
  {
    title: "A document can’t write the agent’s lines",
    ids: [
      "adversarial-document-cannot-author-the-block",
      "pdf-documents-keep-their-facts",
      "string-where-number-expected",
    ],
  },
  {
    title: "Gym setup saves only what was checked",
    ids: [
      "form-blanks-stay-blank",
      "patch-updates-and-revalidates",
      "post-still-refuses-to-overwrite",
    ],
  },
  {
    title: "Member data is read, not guessed",
    ids: [
      "renewal-is-a-new-row-not-a-stale-queue-entry",
      "days-since-visit-comes-from-the-latest-check-in",
      "blank-auto-renew-refused-not-defaulted",
      "malformed-csv-rejected-with-actionable-errors",
      "uploaded-members-refused-on-the-frozen-clock-everywhere",
      "nightly-recompute-refuses-real-data-on-the-frozen-clock",
      "cancellation-column-is-optional-in-the-import",
    ],
  },
  {
    title: "The overview agrees with the router",
    ids: [
      "health-numbers-match-a-hand-count",
      "health-segments-use-the-routers-thresholds",
      "checkin-summary-matches-the-dataset",
      "intelligence-renders-with-no-calls-and-few-reasons",
      "themed-summary-counts-are-counted-not-trusted",
    ],
  },
  {
    title: "The suite is checked too",
    ids: [
      "assertion-patterns-match-real-transcripts",
      "scenario-payloads-are-pinned",
      "cancellation-assertion-patterns-classify-expected-lines",
    ],
  },
];

export const OTHER_GROUP_TITLE = "Other checks";
