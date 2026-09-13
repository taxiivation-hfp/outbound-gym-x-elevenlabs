# Build log

How Retention Router was built: every plan that was handed to the build and every report that came back from it, in the order they happened. None of it describes the product as it is now. For that, read the root [`README.md`](../../README.md). Outstanding handover items live in [`REVIEW_NOTES.md`](../../REVIEW_NOTES.md).

Each plan was written before its work, and each report after, by whoever did the work. The reports say what ran, what didn't, and what they got wrong. Failed runs are left in on purpose.

## In order

| # | Plan | Report | What it covers |
|---|---|---|---|
| 0 | [`charlie_spec.md`](charlie_spec.md), [`charlie_build_brief.md`](charlie_build_brief.md) | — | The first spec and build brief for the three voice agents (renewal, reengagement, winback). |
| 1 | — | [`FEATURES_AND_DECISIONS.md`](FEATURES_AND_DECISIONS.md) | The first build: the pipeline, router, dashboard and call routes, with the reason for each decision. |
| 2 | [`CONFLICTS.md`](CONFLICTS.md), then [`MERGE_PLAN.md`](MERGE_PLAN.md) | [`REVIEW_NOTES.md`](../../REVIEW_NOTES.md) (kept at the root) | Where the agent brief and the framework disagreed, each conflict decided, and the merge built overnight. |
| 3 | [`ONBOARDING_PLAN.md`](ONBOARDING_PLAN.md) | [`ONBOARDING_REPORT.md`](ONBOARDING_REPORT.md) | Gym setup as typed config, document extraction with provenance, CSV member import, and the guards that pin them (53). |
| 4 | [`PASS_ONE.md`](PASS_ONE.md) | [`PASS_ONE_REPORT.md`](PASS_ONE_REPORT.md) | Business-side features: gym health, offer schedules, the "something else" offer, editing a gym, and cancellation requests as data (73 guards). |
| 5 | [`PASS_TWO.md`](PASS_TWO.md) | [`PASS_TWO_REPORT.md`](PASS_TWO_REPORT.md) | The fourth agent (cancellation), the freeze, and the narrow auto-renew exception, with two live eval runs (80 guards; 23/31, then 28/31). |
| 6 | [`PASS_THREE.md`](PASS_THREE.md) | [`PASS_THREE_REPORT.md`](PASS_THREE_REPORT.md) | The five screens rebuilt from the approved mockups, every figure wired to `lib/`, and this reorganisation of the repo. |
| — | [`retention-router-checklist.md`](retention-router-checklist.md) | — | The pre-submission checklist kept during the hackathon. |

## Related

- [`../design/`](../design/): the approved HTML mockups the screens were built from (`mockups/`), plus the design context and product brief used while designing them (`DESIGN.md` describes the earlier dark-only look, which the mockups replaced).
- [`../architecture.svg`](../architecture.svg): the data-flow diagram the README embeds.
- [`../../evals/README.md`](../../evals/README.md): how evaluation works; the committed runs are in `evals/results/`.
