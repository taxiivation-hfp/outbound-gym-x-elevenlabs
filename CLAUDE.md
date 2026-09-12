# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

**Retention Router** — an outbound voice-agent product for gym retention. It
calls the members worth calling (renewal reminders, re-engagement, winback) and
structurally refuses to call members who are on an auto-renewing contract,
because for them a call is the only thing that could make them cancel. Full
product rationale, the economics, and the limitations are in `README.md` —
read it before making product-behavior changes; this file only covers what you
need to work in the code.

## Commands

```bash
npm run dev              # http://localhost:3000
npm run build / start    # production build / serve
npm run lint

npm run evals             # 19 routing guards + 15 simulated ElevenLabs calls
npm run evals:guards      # guards only — no network, no model, instant
npm run evals -- --only <scenario-name>   # single scenario/guard by name

npm run agents:sync       # push agents/prompts + scripts/agentConfig.mjs to ElevenLabs
npm run agents:diff       # dry-run of the above — shows what would change

npm run data:build        # regenerate the synthetic dataset:
                          #   pipeline/generate_gym_data.py -> pipeline/build_scores.py
                          #   -> scripts/copy-pipeline-output.mjs (into data/)
```

There is no `npm test`; `evals:guards` is the fast deterministic check to run
after touching `lib/callType.ts`, `lib/eligibility.ts`, `lib/callHistory.ts`, or
`lib/compileVariables.ts`. Full `npm run evals` costs real ElevenLabs API calls.

## Architecture

Three layers, each owning a different kind of decision. Data flows one
direction: pipeline → lib → agents/API → back into Supabase.

**1. Offline data generation, Python (`pipeline/`).** `generate_gym_data.py`
fakes a gym (members, contracts, check-ins) and `build_scores.py` computes
features and buckets each member into one of five cohorts. This stage emits
**raw facts only** — ISO dates, booleans, counts — never prose. Output lands in
`pipeline/output/` and is copied into `data/` (`members_scored.json`,
`gyms.json`, `dataset_meta.json`) by `scripts/copy-pipeline-output.mjs`. The
dataset's clock is frozen at build time in `dataset_meta.json`; `lib/clock.ts`
reads that instead of `Date.now()` unless `DATASET_CLOCK=live` — this is why a
stale demo needs `npm run data:build`, not a wall-clock fix.

**2. Call-time decisioning, TypeScript (`lib/`).** This is where product logic
actually lives:
- `callType.ts` — the router. Decides renewal/reengagement/winback/nothing for
  a member, and returns a human-readable reason for every branch, including
  refusals. The `auto_renew == true` → never-call rule is checked first, before
  anything else, so nothing downstream can override it.
- `eligibility.ts` — adds what only the database (call history) knows: do-not-
  contact (permanent, holds across all three call types), a 3-call cap, and a
  3-month cooldown after a call that changed nothing.
- `callHistory.ts` — summarizes Supabase call records into what `eligibility.ts`
  and `compileVariables.ts` need (attempt count, last outcome, prior reasons).
- `compileVariables.ts` — turns raw facts + call history into the finished
  plain-English sentences the ElevenLabs agent reads aloud (e.g. `expiry_line`,
  `incentives`, `context`). **Prompts contain no conditionals** — all
  branching happens here, once, so a variable rename touches one file. Three
  variables (`time_left`, `attempt_number`, `context`) can only be computed at
  call time, not offline, which is why this isn't part of the pipeline.
- `dialSafety.ts` — structural guard: refuses to dial unless `CALL_OVERRIDE_NUMBER`
  or `ALLOW_UNVERIFIED_NUMBERS=true` is set, so a misconfigured deploy can't
  ring real members from synthetic data. Enforced in `/api/call`, not just documented.
- `economics.ts` — cost/break-even math shown on the dashboard.
- `intelligence.ts`, `queueView.ts`, `sortMembers.ts`, `labels.ts` — dashboard-
  facing view models built from the same primitives above.
- `gyms.ts` — per-gym config (incentives, quiet hours) that lets one prompt
  serve multiple gyms; switching gym in the dashboard changes what an agent may
  offer without touching a prompt.

Server components in `app/` and the API routes in `app/api/` both call these
same `lib/` functions directly — the dashboard and the endpoint cannot disagree
about who is due a call.

**3. Agents (`agents/prompts/`, `scripts/`).** Three separate ElevenLabs agents
(renewal, reengagement, winback) rather than one prompt with a `call_type`
branch — kept narrow deliberately, see the README section "Three narrow agents,
not one with a `call_type` branch" for why. Personality/Tone/Guardrails/Tools
are shared and stored **once** in `agents/prompts/shared/`, assembled per-agent
at sync time by `scripts/sync-agents.mjs`, which is the only thing allowed to
write agent config — anything edited directly in the ElevenLabs dashboard is
overwritten on the next sync, on purpose. `scripts/agentConfig.mjs` is the
source of truth for prompts, model settings, the eleven data-collection fields,
and the three evaluation criteria. When editing a shared guardrail, edit the
file in `agents/prompts/shared/`, never a per-agent copy — `sync-agents.mjs`
fails loudly if per-agent drift appears.

**4. Back again (`app/api/webhook`).** Verifies the ElevenLabs post-call HMAC
signature, writes the eleven extracted fields + three evaluation criteria +
raw analysis to Supabase (`call_records`), and marks a dial that never
connected as failed instead of leaving it "initiated" forever.

## Evaluation (`evals/`)

Two suites in one runner (`evals/run.ts`), full rationale in `evals/README.md`:
- **Guards** (`guards.ts`) — deterministic assertions directly over the `lib/`
  functions above. No network, no model. Run these after any router/eligibility
  change.
- **Scenarios** (`scenarios.ts`) — 15 simulated conversations against the real
  ElevenLabs agents. Each scenario builds a fixture, routes it with the real
  `routeMember`, compiles variables with the real `compileVariables`, and
  checks both a local regex condition (for anything about ordering — regexes
  settle ordering exactly, judges don't) and one judge condition (for genuine
  judgment calls, e.g. "did it invent a fact"). Results are committed under
  `evals/results/`; `/evals` in the app renders `results/latest.json`.

The conversation score is **not deterministic** — it moved between 11/15 and
15/15 across runs that changed nothing about the agents, because both the
simulated member and the judge are models. Don't treat a single run's number as
a regression signal on its own; the guards are the stable half.

## Working conventions specific to this repo

- **No conditionals in prompts.** If you need an agent to behave differently
  based on gym config or member state, add/extend a variable in
  `compileVariables.ts` that resolves to finished prose — don't add an `if` to
  a prompt file.
- **Shared prompt sections are edited once.** Never duplicate a
  Personality/Tone/Guardrails/Tools edit into a single agent's prompt file.
- **The auto-renew exclusion is load-bearing and tested.** Any change touching
  `callType.ts` should keep the auto-renew branch first and keep its guard
  assertions passing.
- **`CALL_OVERRIDE_NUMBER` must stay respected.** The 500 synthetic phone
  numbers are Faker output belonging to nobody; don't add a code path that
  dials `member.mobile` directly without going through `dialSafety.ts`.
- **The dataset's "now" comes from `lib/clock.ts` / `data/dataset_meta.json`**,
  not `new Date()`. Use `lib/clock.ts` for anything date-relative in `lib/` or
  `app/`.
- **`twilio_call.py` and `eleven_labs_call.py` are standalone manual-test
  scripts**, not part of the Next.js app — they read credentials from env vars
  now (previously had a live token committed; see `REVIEW_NOTES.md`).
- Outstanding handover items (migrations to apply, env vars to set, repo
  visibility) are tracked in `REVIEW_NOTES.md` — check it before assuming a
  Supabase schema or deployment step is already done.
