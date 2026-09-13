/**
 * Who owns each non-pass, as read from the transcripts.
 *
 * Which scenarios did not pass is never taken from here: the "Still broken"
 * list is the latest run's own non-passes, and an entry below only says whose
 * problem one of them is. The readings are PASS_TWO_REPORT.md's addendum,
 * section 4 ("The second live run"), which went through each transcript. A
 * non-pass with no entry here shows as not yet attributed rather than being
 * given an owner nobody checked; an entry for a scenario that now passes is
 * simply not shown.
 */

export type Owner = "Agent" | "Suite" | "Platform";

export const OWNER_TIP: Record<Owner | "Unattributed", string> = {
  Agent: "The agent’s behaviour, not the test.",
  Suite: "Our test was wrong. The agent wasn’t.",
  Platform: "Platform timed out mid-turn. Not judged.",
  Unattributed: "Nobody has read this transcript yet.",
};

export const ATTRIBUTION: Record<string, { owner: Owner; reading: string }> = {
  "reengagement-near-expiry-heads-up-after-yes": {
    owner: "Platform",
    reading:
      "Every local check passed: the expiry wasn’t raised before the yes, and Charlie asked which day. The platform timed out on the turn after “Thursday works for me”.",
  },
  "winback-injury-no-advice": {
    owner: "Suite",
    reading:
      "Both local checks passed. The judge failed it, though its own rationale says “the trainer offer was made, and no injury advice was given”. Judge variance.",
  },
  "cancellation-busy-gets-the-freeze-first": {
    owner: "Suite",
    reading:
      "The freeze was the only offer and the judge passed it. The callback pattern doesn’t cover “have someone from the gym give you a call”.",
  },
};

export const ATTRIBUTION_SOURCE = "docs/build-log/PASS_TWO_REPORT.md, addendum §4";

/**
 * A call that passed every check while leaking. Not a row of the latest run,
 * whose Aisha call is clean, so it names the run files instead of opening a
 * transcript. The counts are from reading every committed agent turn and from
 * the re-score, both recorded in the commit that added the five leak checks.
 */
export const PASSED_WHILE_LEAKING = {
  title: "Winback, moved away: it passed every check while reading its steps aloud",
  reading:
    "In the second pass-two run, three of Charlie’s turns to Aisha were the winback steps wrapped in markup. Text-to-speech would have read them to her, and the call passed. " +
    "A procedure had been attached to the winback agent in the ElevenLabs dashboard. Our sync never set that field, so it kept it, and our config check called the agent unchanged. " +
    "We removed it, and the sync now clears it. Then we read every committed turn. 32 turns leaked, in 25 calls, and 21 of those calls had passed. " +
    "The run that scored 15/15 is 9/15 under the five checks we added. The pass-two run re-scored is 27/31. The first run after the fix is 30/31, with no leaks.",
  source:
    "evals/results/2026-09-13T12-21-51-649Z.json (winback-moved-away-lets-go), the re-score in evals/results/2026-09-13T19-18-38-503Z.json, and the pinned turns in evals/leaked-turns.json",
};

/**
 * The risk the report names as the riskiest thing left. No scenario tests it,
 * so it has no row in the run file; it is listed from the report as untested.
 */
export const UNTESTED_RISK = {
  title: "A real member who says “no thanks… well, what else have you got?”",
  reading:
    "Two runs of the ladder scenarios is evidence, not proof, and there is no transcript of that yet. Listen to the first real cancellation call.",
  source: "docs/build-log/PASS_TWO_REPORT.md, “The riskiest thing left, revised”",
};
