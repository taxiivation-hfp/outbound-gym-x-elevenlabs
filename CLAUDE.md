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

npm run evals             # 80 guards + 31 simulated ElevenLabs calls
npm run evals:guards      # guards only — no network, no model, instant
npm run evals -- --only <scenario-name>   # single scenario/guard by name
npm run evals:extraction  # adversarial price list through the real extraction model (needs ANTHROPIC_API_KEY)

npm run agents:sync       # push agents/prompts + scripts/agentConfig.mjs to ElevenLabs
npm run agents:diff       # compares each agent against what ElevenLabs holds; writes nothing
npx tsx scripts/snapshot-scenario-payloads.ts   # re-pin the scenario payloads after a deliberate change (a guard compares them)

npm run data:build        # regenerate the synthetic dataset:
                          #   pipeline/generate_gym_data.py -> pipeline/build_scores.py
                          #   -> scripts/copy-pipeline-output.mjs (into data/)
npm run data:verify-port  # lib/memberData.ts reproduces build_scores.py for all 500 members
npm run db:verify         # apply every onboarding migration to in-process Postgres and check it
npm run gyms:seed-check   # the gyms migration's seed block still matches data/gyms.json
npm run gyms:seed-sql     # regenerate that seed block after editing data/gyms.json
```

There is no `npm test`; `evals:guards` is the fast deterministic check to run
after touching `lib/callType.ts`, `lib/eligibility.ts`, `lib/callHistory.ts`,
`lib/compileVariables.ts`, anything gym-config (`lib/gymConfig.ts`,
`lib/incentives.ts`, `lib/validateIncentives.ts`, `lib/textSafety.ts`,
`lib/extraction/sanitize.ts`) or member data (`lib/memberData.ts`,
`lib/memberImport.ts`, `lib/csv.ts`). Full `npm run evals` costs real
ElevenLabs API calls.

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
- `callType.ts` — the router. Decides renewal/reengagement/winback/cancellation/
  nothing for a member, and returns a human-readable reason for every branch,
  including refusals. The `auto_renew == true` → never-call rule is checked
  first, before anything else, so nothing downstream can override it. Its one
  exception lives *inside* that branch: a member with `cancellation_requested`
  set routes to `cancellation` and to nothing else (a flagged fixed-term member
  gets the same call instead of a renewal pitch; once lapsed, nothing).
- `eligibility.ts` — adds what only the database (call history) knows: do-not-
  contact (permanent, holds across every call type), a 3-call cap, and a
  3-month cooldown after a call that changed nothing. The cancellation call has
  its own gates here: it needs the gym to have a freeze or a cheaper tier
  (`nothing_to_offer` otherwise — the only gate that takes the gym, passed as
  the fourth argument), it happens once (`cancellationConversations`), and
  `evaluateOffers` explicitly exempts it from the offer schedule and the habit
  guard.
- `callHistory.ts` — summarizes Supabase call records into what `eligibility.ts`
  and `compileVariables.ts` need (attempt count, last outcome, prior reasons).
- `compileVariables.ts` — turns raw facts + call history into the finished
  plain-English sentences the ElevenLabs agent reads aloud (e.g. `expiry_line`,
  `incentives`, `context`). **Prompts contain no conditionals** — all
  branching happens here, once, so a variable rename touches one file. Three
  variables (`time_left`, `attempt_number`, `context`) can only be computed at
  call time, not offline, which is why this isn't part of the pipeline.
- `dialSafety.ts` — structural guard, decided per member source: a synthetic
  dataset member is only ever dialled via `CALL_OVERRIDE_NUMBER`; an uploaded
  member needs the override or `ALLOW_UNVERIFIED_NUMBERS=true`. A misconfigured
  deploy can't ring strangers from synthetic data, and switching back to the
  dataset can't leave the opt-in dialling them. Enforced in `/api/call` and
  `send_text`, not just documented. `onboardingWrites.ts` is the same shape for
  onboarding: saving a gym and importing members are off unless
  `ONBOARDING_WRITES=enabled`.
- `economics.ts` — cost/break-even math shown on the dashboard.
- `intelligence.ts`, `queueView.ts`, `sortMembers.ts`, `labels.ts` — dashboard-
  facing view models built from the same primitives above.
- Gym config is **typed data, not prose**. `gymConfig.ts` defines the fields
  (facts, the offers, the cheaper tier, the freeze — `freeze_max_weeks` and
  `freeze_weekly_fee`, both or neither, where a fee of 0 is a free freeze and
  null is no freeze) and parses/validates them (`textSafety.ts` holds the
  free-text rules); `incentives.ts` compiles the `incentives` block from a
  fixed sentence registry, one block per call type; `validateIncentives.ts`
  independently re-derives what a block may say from the config and rejects
  anything else. `compileVariables` runs both on
  every compile and throws `GymConfigError` / `IncentivesValidationError` before
  a payload exists. `gyms.ts` is the seed (`data/gyms.json`); `gymStore.ts`
  reads the `gyms` table, falling back to the seed only when the table doesn't
  exist yet or Supabase isn't configured (a database error is a 503, never the
  seed). One prompt still serves every gym; switching gym in the dashboard
  changes what an agent may offer without touching a prompt.
- Onboarding (`/onboarding`, `lib/onboardingDraft.ts`, `lib/extraction/`) — a
  document is read (`documentText.ts`), a model fills typed fields
  (`extract.ts`, `claude-haiku-4-5`), and `sanitize.ts` keeps a value only when a
  verbatim quote from the document supports it. A person reviews every value
  before `POST /api/gyms` saves it.
- Member data — `memberSource.ts` picks the synthetic dataset (default) or one
  gym's uploaded members (`MEMBER_SOURCE=supabase`, `MEMBER_SOURCE_GYM_ID`).
  Uploaded data is stored as members (upsert), contracts (one row per term,
  insert-only) and check-ins (insert-only) by `memberStore.ts`, imported by
  `memberImport.ts`/`csv.ts`, and derived into the router's `Member` shape by
  `memberData.ts` (a port of `build_scores.py`) on every read. An uploaded
  member can only be contacted as their own gym (`gymForMember`).
- `queueRecompute.ts` — the nightly job behind `/api/cron/recompute`
  (`vercel.json`, `CRON_SECRET`). It records a snapshot and refuses to measure
  uploaded members against the frozen clock. Nothing reads it to decide a call;
  `/api/call` re-reads the member and re-checks eligibility at dial time.

Server components in `app/` and the API routes in `app/api/` both call these
same `lib/` functions directly — the dashboard and the endpoint cannot disagree
about who is due a call.

**Screens (`app/`, `components/`).** Five screens built from the approved
mockups in `docs/design/mockups/`: the call queue (`/`, `components/calls/`),
the overview (`/intelligence`, `components/intelligence/`), configuration
(`/onboarding`, `components/onboarding/`), evals (`/evals`, `components/evals/`)
and about (`/about`, `components/about/`), plus `/members`. Every screen sits in
`components/shell/AppShell.tsx` and uses the theme tokens in `app/globals.css`
(light and dark; name a role like `bg-surface` or `text-dim`, never a hex).
A panel shows only what `lib/` or a committed file computes — presentation
helpers live beside the component, never as a changed `lib/` function. Build
history (every plan and report) is in `docs/build-log/`.

**3. Agents (`agents/prompts/`, `scripts/`).** Four separate ElevenLabs agents
(renewal, reengagement, winback, cancellation) rather than one prompt with a
`call_type` branch — kept narrow deliberately, see the README section "Four
narrow agents, not one with a `call_type` branch" for why. Personality/Tone/
Guardrails/Tools are shared and stored **once** in `agents/prompts/shared/`,
assembled per-agent at sync time by `scripts/sync-agents.mjs`, which is the
only thing allowed to write agent config — anything edited directly in the
ElevenLabs dashboard is overwritten on the next sync, on purpose.
`scripts/agentConfig.mjs` is the source of truth for prompts, model settings,
the eleven data-collection fields, and the three evaluation criteria. When
editing a shared guardrail, edit the file in `agents/prompts/shared/`, never a
per-agent copy — `sync-agents.mjs` fails loudly if per-agent drift appears.
`agents:diff` fetches each existing agent and compares every value the payload
sets, so "unchanged" means a sync would be a no-op for that agent.

**4. Back again (`app/api/webhook`).** Verifies the ElevenLabs post-call HMAC
signature, writes the eleven extracted fields + three evaluation criteria +
raw analysis to Supabase (`call_records`), and marks a dial that never
connected as failed instead of leaving it "initiated" forever.

## Evaluation (`evals/`)

Two suites in one runner (`evals/run.ts`), full rationale in `evals/README.md`:
- **Guards** — deterministic assertions directly over the `lib/` functions
  above. No network, no model. `guards.ts` holds the original 20 (19 routing, plus one that pins
  the transcript assertion patterns) and
  `runGuards`, which also runs `configGuards.ts` (21: gym config, the validator,
  extraction sanitising, the adversarial document in `evals/documents/`),
  `memberGuards.ts` (12: contracts-per-term, CSV import, dial-time recheck, the
  nightly recompute), the pass-one files (`healthGuards.tsx`, `offerGuards.ts`,
  `otherOfferGuards.ts`, `gymEditGuards.ts`) and `cancellationGuards.ts` (10:
  the narrow flip, the four gym combinations, the cap of one, the schedule and
  habit-guard exemption, the block terms, the freeze parser, the payload pin
  against `evals/payloads/scenarios.json`, and the cancellation patterns).
  Run these after any router/eligibility/config change.
- **Scenarios** (`scenarios.ts`) — 31 simulated conversations against the real
  ElevenLabs agents (15 for the first three agents, 16 for the cancellation
  agent). Each scenario builds a fixture, routes it with the real
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
- **No model writes prompt text.** Extraction fills typed fields; the compiler
  writes every sentence from `incentives.ts`'s registry, and the validator
  checks it. Never pass extracted or user-typed prose into an incentives
  sentence, and never add a free-text gym field that reaches a prompt without
  `textSafety.ts` rules and a guard.
- **Blank stays blank.** A field nobody answered is `null` at every layer until
  `compileVariables` turns it into the "you don't have that" sentence. Don't
  default it in the form, the parser, the store or the compiler.
- **Shared prompt sections are edited once.** Never duplicate a
  Personality/Tone/Guardrails/Tools edit into a single agent's prompt file.
- **The auto-renew exclusion is load-bearing and tested.** Any change touching
  `callType.ts` should keep the auto-renew branch first and keep its guard
  assertions passing. The cancellation exception belongs *inside* that branch
  as a narrow rule, never before it as a competing one; `cancellation-flip-is-
  narrow` pins that a flagged member is callable on `cancellation` and nothing
  else, and that every other auto-renewer is refused exactly as before.
- **The cancellation agent never obstructs the cancellation.** At most two
  offers, the second only when the first was found unsuitable rather than
  refused; "just cancel it" ends every offer. Don't relax a cancellation
  scenario's assertion to make a live run pass.
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
