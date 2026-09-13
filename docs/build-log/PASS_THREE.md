# PASS_THREE.md — implement the mockups, wired to real data

Read this, then `FULL HTML MOCKUP/`, then `PASS_ONE_REPORT.md` and
`PASS_TWO_REPORT.md` so you know exactly what the backend can supply. Then
`lib/intelligence.ts`, `lib/gymHealth.ts`, `lib/callType.ts` and
`lib/eligibility.ts` before writing any component.

The mockups are approved. Their data is entirely placeholder. This pass replaces
the app's screens with them and wires every number to the functions that already
compute it.

---

## The one rule that matters

**No panel shows a number that isn't computed from real data.**

The mockups are complete because they were drawn that way. The backend is not
complete in the same shape. Where they disagree, the backend wins.

For every panel in the mockup, exactly one of these outcomes:

1. **Wire it** — a `lib/` function already computes it. Most panels.
2. **Cut it** — nothing computes it and nothing should. Remove the panel and
   list it in the report.
3. **Label it** — the panel is worth keeping as a roadmap item, so mark it
   *not built* in the UI the way the platform connectors already are: no
   spinner, no fake success, no plausible-looking number.

**Never invent a fourth outcome.** Do not hardcode a value to make a panel look
finished. Do not derive a number from an assumption not already in `lib/`. Do
not average, extrapolate or estimate to fill a gap. A hardcoded number in a demo
video is the difference between the 9–10 functionality band and the 5–6 band,
and it is the single most likely way this pass loses points.

If a panel is genuinely borderline, cut it and say so. An absent panel costs
nothing. A fabricated one costs the project's credibility.

---

## What the backend actually has

Check each against the code rather than trusting this list, but this is the
inventory as the two reports describe it.

**Calls page**
Queue split by four call types. Six excluded buckets with their reasons.
`cancellation_requested` as a flag. Per member: days since visit, visits in a
window, expiry, tenure, monthly fee, attempts. Row expansion: transcript,
outcome, `reason_for_absence`, `reason_detail`, `committed_day`, attempts,
cooldown, phone, contract details.

**Analytics**
Active members and the auto-renew count. Fixed terms ending in 14 / 30 / 90
days. Monthly churn across six months plus month to date. 90-day retention.
MRR and ARPM. Visits per member per week over twelve windows. Four frequency
segments. Weekday × hour busyness grid with the five busiest cells. Revenue at
risk per call type, now four. Reason breakdown by reason, cohort, call type and
tenure band. The themed summary from `queue_runs.reason_themes`. Outcome
breakdown. Sentiment. Today's queue count and cost.

**Setup**
Thirteen typed gym fields including the freeze. Document upload in four stages
with per-field provenance and unsupported-value reasons. Offer schedule rows.
Live preview, now **four** compiled blocks. CSV import for three files with
line-numbered errors. Platform connectors marked not built with field mappings.

**Evals**
80 logic checks. 31 scenarios across four agents. Nine-run history. The
reasoning-leak transcript. The adversarial document result. The withdrawn
accuracy number. Known failures with agent-versus-suite attribution.

**About** — static.

## What the mockups may show that the backend cannot

Expect at least these. Cut or label each; do not fake them.

- **Date range pickers.** Every window is fixed. Either cut them or wire them
  only to ranges `lib/` already computes.
- **Any gym switcher.** Explicitly out of scope — one manager, one gym.
- **Live-updating anything.** There are no realtime subscriptions; there is a
  refresh button. Keep the button.
- **Per-member sentiment.** Aggregate only.
- **Class utilisation, lead or marketing metrics.** No such data exists.
- **Sparklines or trends on metrics that have only one value.**

## Copy

Apply the evals page copy already written — section titles as claims rather
than labels, and the third row state. Same voice across the other screens:
active voice, imperative, buttons under five words, tooltips under twelve,
errors naming the fix in one beat.

**Add `Inconclusive` as a row state on scenarios.** Platform timeouts currently
score as failures, which makes 23/31 read worse than it is — three of those
eight are the suite or the network, not the agent. Tooltip: the call was cut off
mid-turn.

## Order

Calls, then Analytics, then Setup, then Evals, then About. Commit after each.

Calls first because its row-expansion pattern is inherited by every other
screen, and getting it wrong late means redoing four pages.

## Constraints

- **Do not touch any agent prompt, and do not run `agents:sync`.** All existing
  scenario payloads must stay byte-identical and
  `scenario-payloads-are-pinned` must pass.
- **Do not change any `lib/` function's behaviour.** If a mockup needs a number
  shaped differently, add a presentation helper in the component layer. The
  screen and the API routes must keep calling the same functions so they can't
  disagree about who is due a call.
- **Do not weaken any of the 80 guards.** A guard that renders a page — there
  are several — will need updating for the new markup. Update what it queries,
  never what it asserts.
- Remove the PLACEHOLDER comments from the five pass-one components as you
  replace them.
- Mobile is not a target. Design for 1440px and make sure nothing is unusable
  at 1024px.

## Repo cleanup

After the five screens are committed, not before.

**Organise, don't delete.** Judges score whether the repo is organised,
readable and documented, so the goal is a structure someone can navigate in
two minutes.

- Group the growing pile of top-level markdown. `PASS_ONE.md`,
  `PASS_TWO.md`, `PASS_THREE.md`, `CONFLICTS.md`, `ONBOARDING_PLAN.md` and the
  reports are build history — move them under `docs/build-log/` with an index.
  `README.md`, `REVIEW_NOTES.md` and `LIMITATIONS` stay at the root.
- Keep every committed eval result. The nine-run history is evidence.
- Keep the three sample PDFs and the adversarial fixture.
- Delete genuinely dead code only, and list every deletion in the report.
- **Do not move anything a guard, script or `package.json` command imports**
  without updating the reference and re-running `evals:guards`.
- Add a short comment header to each `lib/` file saying what it owns. There are
  now enough of them that the boundaries aren't obvious from the names.

## Not in this pass

The README rewrite. It cannot honestly describe screens that don't exist yet,
and the decisions section needs a human. Separate pass, after this one.

## Report

In `PASS_THREE_REPORT.md`: every mockup panel and which of the three outcomes it
got, with the cut and labelled ones listed explicitly. Every file moved or
deleted. Confirmation that payloads held and all 80 guards pass. Any place where
you were tempted to hardcode a value and what you did instead.
