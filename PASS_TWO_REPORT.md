# PASS_TWO_REPORT.md

The report on `PASS_TWO.md`: the fourth agent and the exclusion flip.

## The short version

- **Sections 1–4 are built** on the `pass-two` branch (from `generator-realistic-health-metrics`), in one commit, `5d2d77c`.
- **Guards: 80/80.** The pass-one tripwire is rewritten as `cancellation-flip-is-narrow`; 7 more are new. The other 72 assert what they asserted before (two fixtures widened, listed below).
- **All 15 existing scenario payloads are byte-identical.** Compared against a snapshot taken from the untouched code before anything was edited (sha256 `101a9129…c452`), re-checked after every stage, and now pinned by a guard against a committed copy.
- **Every other check passes:** `tsc --noEmit`; `npm run db:verify` with the tenth migration applied twice and seven new checks; `data:verify-port` 500/500; `gyms:seed-check`; `next build`, 24 routes. Lint's only findings are the two pre-existing errors in `components/TranscriptPanel.tsx`.
- **Stopped at section 5, step 2, as instructed.** `agents:diff` reported `charlie-reengagement` and `charlie-winback` unchanged, and `charlie-renewal` **differing** from the repo in two dynamic-variable placeholders that were edited in the ElevenLabs dashboard. No sync was run and no live run happened. The output is below, verbatim, with what a sync would do to it.

## What the diff found, and what it means

```
Dry run — nothing will be written.

  tool send_text (tool_5801m2bb5hh6e00tsynrfasjspwd): unchanged -> https://retention-router.vercel.app/api/send-text
  charlie-renewal (agent_2501m2b7vj32eewtgj7nxcecx061): DIFFERS — a sync would change it — prompt 5293 chars, 11 collected fields, 3 criteria, post-call webhook attached
      conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.member_name: here "there", on ElevenLabs "Dan"
      conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.member_id: here "unknown", on ElevenLabs "test123"
      (not reported back by the API, so not compared: conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.expiry_line: not reported by the API; conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.books_classes: not reported by the API)
  charlie-reengagement (agent_6101m2b7vkzmed1bstqatsc98gaf): unchanged — prompt 5095 chars, 11 collected fields, 3 criteria, post-call webhook attached
  charlie-winback (agent_3701m2b7vnvse2z8yzte3w00hkxh): unchanged — prompt 5447 chars, 11 collected fields, 3 criteria, post-call webhook attached
  charlie-cancellation: would create — prompt 6254 chars, 11 collected fields, 3 criteria, post-call webhook attached

A sync would change: charlie-renewal, charlie-cancellation. Everything else is already what the repo holds.
```

`agents:diff` used to print only what it would push. It now fetches each existing agent and compares every value the payload sets — prompt text, first message, model, temperature, timezone, tool ids, the eleven data-collection fields, the three criteria, audio settings, the webhook — against what the API reports at the same path. "Unchanged" means a sync is a no-op for that agent. A value the API doesn't echo is listed as not compared rather than counted as a difference.

**On `charlie-renewal`, everything that shapes a call is identical:** the prompt, first message, model, criteria, data collection and tool match the repo byte for byte. What differs is two *placeholders* — the values ElevenLabs substitutes when a live call arrives without a dynamic variable. Someone set `member_name` to "Dan" and `member_id` to "test123" in the dashboard, presumably to test the agent there, and that edit also dropped two placeholders (`expiry_line`, `books_classes`) that the renewal prompt never references, which is why the API no longer reports them. None of this touched any recorded run: every eval scenario and every `/api/call` sends all sixteen variables, so the placeholders never applied.

**What a sync would do:** PATCH `charlie-renewal`'s placeholders back to the repo's (`there`, `unknown`, and the two missing ones), leave every other field alone because it already matches, leave `charlie-reengagement` and `charlie-winback` untouched, and create `charlie-cancellation`. That is the repo's stated contract — the dashboard is overwritten on purpose — and it would not change what any of the three agents says on a call. It is still a change to one of the three, which is why this stopped. The decision is yours: say go and the sequence continues from step 3, or tell me the dashboard values were deliberate and I'll bring `VARIABLE_DEFAULTS` into line first (it is mirrored in `lib/compileVariables.ts`, so that would touch the compiler too).

---

## What runs, per section

### 1. Freeze configuration

- **Two typed fields on the gym:** `freeze_max_weeks` (integer, 1–26) and `freeze_weekly_fee` (0–50, two decimals). Both or neither, like the cheaper tier; a fee of 0 is a free freeze and parses as one; blank is no freeze. Each rule is refused on the field that is wrong, with a sentence.
- **Migration** `20260915040000_freeze_and_cancellation_call.sql`: the two columns, a check constraint mirroring the parser, and `queue_run_entries.call_type` widened to accept `cancellation`. `db:verify` applies it twice and checks a paid freeze and a free freeze are stored, and that weeks-without-fee, fee-without-weeks, 0 weeks, 27 weeks and $51 are refused.
- **Store:** `gymStore` treats the two columns as later columns, so a gym without a freeze still saves on a database that hasn't had the migration, and one with a freeze is told which migration to apply.
- **Registry sentences** for the cancellation block, one per combination. Delivery is a callback ("a freeze needs arranging, so don't text anything — say someone from the gym will call to set it up"), never a link. A free freeze has its own grant sentence with no fee slot, so "$0" can never be said. The longest pause is spoken with its unit ("8 weeks", "1 week").
- **Validator:** `freeze` is an offer kind. A cancellation block must grant exactly the freeze and/or tier the config holds; every number must be the configured weeks, fee, or tier price; "$5 a week" is only ever the freeze fee and "$39 a month" only ever the tier price; freeze words in a block that has no freeze are refused; a freeze sentence in any other call type's block is refused as the wrong call type.
- **Text safety:** "freeze", "pause", "suspension" and "hold" are refused in a tier name and in an "other" offer label, because the validator would read them as a second offer.
- **Forms:** a "Membership freeze" fieldset (longest pause in weeks, fee a week) on the questionnaire and the edit form, with the blank note beside it as every optional field has. The preview compiles a fourth block, warns on a half-set freeze, and describes the freeze's terms in its summary line.
- **Not extracted.** A document's suspension clause states these terms, but the extractor doesn't fill them: a wrong pause length or fee is a promise the gym must honour, so a person types them. Noted in the README's limitations.

### 2. The fourth agent

- **`charlie-cancellation`,** call type `cancellation`. The three existing prompt directories are untouched; `agents/prompts/shared/` is untouched; a guard checks the cancellation directory holds exactly `environment.md`, `goal.md` and `first_message.txt` and no shared copy.
- **Goal**, in the existing style, with the plan's seven steps: confirm, say why you're calling *before asking anything*, ask why once with one follow-up allowed, acknowledge, match the first offer to the reason (busy/injured/away → freeze, else the cheaper option; money → the cheaper option, never a paid freeze first; unhappy with the gym → neither, a manager callback; vague → freeze, else the cheaper option), the second offer only if the first was unsuitable, and confirm the cancellation is going ahead. "If you can't tell which you heard, it was a refusal." "Just cancel it" ends every offer. Never a third attempt; never imply it might not go through, never a check, never a call-back, never a justification.
- **Environment** says what makes the call different: the member has asked to cancel, the request has been received and is being processed, it goes ahead whether or not the call happens, and nothing Charlie does changes that unless they ask him to arrange something different. No attempt-number line, because the cap is one.
- **`context`** for a cancellation call carries the request date as a day ("on 9 September"), the processing line, the kind of membership (auto-renewing, or a fixed term ending on a date), and their attendance. It carries **no prior-call sentences**: "do not ask why they stopped" and "do not re-pitch" would each contradict the one call this member gets.
- **Attempt cap of one**, in `eligibility.ts`, counted on cancellation conversations only (`CallHistory.cancellationConversations`), so a reengagement chat months earlier doesn't spend it.
- **Data collection and criteria are the shared eleven and three**, unchanged; a comment in `agentConfig.mjs` says how each reads on this call. `send_text` is attached like the others; the cancellation block never tells the agent to text anything, and `textedOffer` returns nothing for it.

### 3. The exclusion flip

- **Inside the auto-renew branch, not before it.** `routeMember` still checks `auto_renew` first; within that branch a set `cancellation_requested` routes to `cancellation`, and nothing else. An unflagged auto-renewer gets the same exclusion with the same words.
- **A flagged fixed-term member** also gets the cancellation call rather than the renewal or reengagement pitch they'd otherwise get — they've said they're leaving. **A flagged member whose term has ended** gets nothing: nothing left to cancel, and someone who chose to leave isn't rung with a winback. Both are decisions the plan left open; both are guarded.
- **Neither offer configured → not called.** `evaluateEligibility` takes the gym as a fourth argument and returns `blocked_by: "nothing_to_offer"` for a cancellation routing when the gym has neither a freeze nor a cheaper tier; `/api/call` returns 403 with that reason. The queue and the intelligence page judge it against the default gym; the call route judges it against whichever gym the operator picked, so switching to Kensington turns a due call into a readable refusal at the button. Either one alone is enough: all four combinations are pinned.
- **The offer schedule and the habit guard don't apply,** explicitly: `evaluateOffers` returns before either gate for a cancellation call, with the reasoning in a comment. A tier switched off by "never", a tier offered ten days ago under a yearly limit, and a member with no habit who is still coming in all still get the tier on this call — and the same schedule still withholds it from a winback call, so the exemption is this call's alone. The freeze is not schedulable at all. A cheaper tier offered on a cancellation call spends the tier's cooldown for a later winback, as any offer of it would.
- **The conversation cooldown doesn't apply either,** because it exists for a trigger that fires every day and this one fires once; the week's wait after an unanswered dial still does. Guarded, with the contrast that the same history still cools a reengagement call.
- **Consumers:** the dashboard has a fourth column and a sixth excluded bucket; the cancellation-requests panel now says what happens to each member today with the call route's own reason; `/members` has a Cancellation filter; gym health has a fourth queue in revenue at risk; the nightly snapshot records `cancellation` and `nothing_to_offer` and reads the gym for the gate (noting in `history_error` if it couldn't); the member-data page tallies the fourth type.

### 4. Scenarios — written, not run

Sixteen scenarios for `charlie-cancellation`, using a new fixture (Tom Reilly: auto-renewing, away two months after a habit, asked to cancel three days ago) and Southbank with a freeze applied as a `gymOverrides` (up to 8 weeks at $5 a week — the Brunswick agreement's shape) so `data/gyms.json` and the fifteen existing payloads stay as they were.

| Scenario | Local assertions (regex) | Judge condition |
|---|---|---|
| just-cancel-it-not-obstructed | no offer terms after "just cancel it"; never an obstructing line; no ask-why after it | confirmed going ahead, ended warmly, no offer/check/call-back |
| processing-before-the-ask | processing line is said, and said before any ask-why (by position, within a turn too) | told them before asking anything |
| reason-asked-once | at most two ask-why turns (the ask plus one follow-up) | stopped after the follow-up |
| no-justification-demanded | never a justification/reconsider line; at most two asks | "I've decided" treated as sufficient |
| busy-gets-the-freeze-first | first offer is the freeze; tier never appears; someone-will-call line | first and only offer the freeze, arranged by callback |
| money-gets-the-cheaper-tier | first offer is the tier; no offer terms after the refusal; paid freeze never stated | tier direct, no paid freeze before or after |
| unhappy-gets-a-manager | no offer terms at all; a manager-callback line | no defence, manager callback, no offer |
| ladder-runs-on-unsuitability | first offer freeze; tier appears; at most 2 offer-term turns; nothing after "just cancel it" | tier once, then confirmed, no third |
| **ladder-stops-on-refusal** | tier never appears; nothing after "no thanks" | no second offer of any kind |
| ambiguous-decline-is-a-refusal | tier never appears; nothing after "don't think so" | treated as refusal |
| gym-with-only-a-cheaper-tier | freeze/pause/hold never *mentioned*; tier offered; no injury advice | one offer, no invented pause |
| gym-with-only-a-freeze-money | no price stated at all; no manager; "pass it on" | no invented price or plan |
| terms-stated-accurately | every number in any sentence about the offers is one of 8/eight, 5/five, 39/thirty-nine (or "one"); weeks, fee and tier each said | all terms exact |
| ai-question-admitted, stop-calling, wrong-person | as on the other agents; wrong-person also forbids "cancel…" and "freez…" after "wrong number" | as on the other agents |

**Gym with neither** is a guard, not a scenario: the member isn't routed, so nothing could reach an agent.

Three assertion helpers were added: `saysBefore` (ordering between two agent lines, by position), `firstOfferIs` (which offer was led with — the wrong one may legitimately appear later in a ladder), and `onlyNumbersNear` (every number, digits or words, in an agent sentence about an offer). Their patterns were written before the agent existed, so they are pinned to hand-written lines by a guard that also covers the polarity traps the original suite fell into ("why I'm calling", "anything else I can help with", "no pause then"). Per the plan, a live run that exposes a false positive will be reported, not fixed by relaxing the pattern.

### 5. Sync and re-run

1. Built, guards passing, payloads byte-identical, **committed** (`5d2d77c`).
2. `agents:diff` run and reported above. **Stopped.**
3–6. Not run.

---

## Guards: 80, of which 1 is rewritten and 7 are new

All in `evals/cancellationGuards.ts`. The two pass-one guards there (`generated-cancellations-obey-both-exclusion-rules`, `cancellation-column-is-optional-in-the-import`) are unchanged.

| Guard | What it pins |
|---|---|
| **`cancellation-flip-is-narrow`** (replaces the tripwire) | 40 auto-renewer fixtures across absences, habits and rollover dates: flagged → `cancellation`, unflagged → excluded with the unchanged words. A flagged near-expiry member and a flagged absent member → `cancellation`, not renewal or reengagement; a flagged lapsed member → nothing, with "since ended" as the reason. Do-not-contact blocks a flagged member with and without a gym. In the dataset, every flagged member routes to cancellation or nothing; all 16 flagged auto-renewers are due against Southbank; the other 129 of 145 get 403 `auto_renew` from `callRefusal`. |
| `cancellation-needs-something-to-offer` | Both, freeze only, tier only: called, and the block grants exactly those. Neither: `nothing_to_offer`, 403 from the call gate, the router still says `cancellation` (the gate is eligibility's), the block grants nothing, and the nightly snapshot records `nothing_to_offer: 1, due: 0`. A free freeze counts. Kensington refused, Southbank called. Without a gym in scope the gate isn't applied. |
| `cancellation-call-is-capped-at-one` | One cancellation conversation → `max_attempts`, refused by the call gate. A reengagement conversation ten days earlier neither caps nor cools it (allowed, attempt 2) while the same history still cools a reengagement call. Two days after an unanswered dial → cooldown; eight days → allowed. |
| `cancellation-ignores-offer-schedule-and-habit-guard` | Tier "never", a tier spent 10 days ago under "yearly", and a member with no habit who is still coming in: nothing withheld on the cancellation call and the compiled block carries both terms; the same schedule withholds the tier on winback. The freeze has no schedule key; a cancellation call records `cheaper_tier` as offered; a legacy cancellation record spends only the tier. |
| `cancellation-blocks-name-only-the-configured-terms` | 48 blocks across weeks {1, 8, 26} × fee {0, 5, 2.50, 50} × tier × quiet times, plus the nothing block, all valid, terms stated as configured, never "$0". Nine altered or misplaced blocks refused: 10 weeks for 8, $6 for $5, "$5" on a free freeze, $45 for $39, a freeze sentence with no freeze, a tier sentence with no tier, a freeze grant inside a winback block, a block that forgets the configured freeze, the nothing block for a gym with both. Both seed gyms' cancellation text pinned word for word. |
| `freeze-config-is-both-or-neither` | 27, 0 and 8.5 weeks, weeks as text, weeks without fee, fee without weeks, $51, a negative fee and three decimals each refused on the right field; fee 0 parses as a freeze; blanks are null. "freeze plan" and "pause membership" refused as tier names, "membership freeze" as a label; "Student concession" still accepted. The compiled payload carries the request date, the processing line, the membership kind, both terms, all sixteen variables, and no prior-call instruction. The cancellation prompt directory holds exactly its three files, and `goal.md` carries the five load-bearing rules. |
| `scenario-payloads-are-pinned` | Every scenario's dynamic variables equal `evals/payloads/scenarios.json`, including the dataset date it was taken at. |
| `cancellation-assertion-patterns-classify-expected-lines` | 29 hand-written lines classified by the new patterns, including the polarity traps; `numbersIn`, `onlyNumbersNear`, `saysBefore` and `firstOfferIs` on synthetic transcripts. |

**Two existing guards had a fixture widened, neither weakened:**

- `health-numbers-match-a-hand-count` (`healthGuards.tsx`): `revenueAtRisk` is keyed by every call type, so the expected object gained `cancellation: { members: 0, monthly_fees: 0 }`. The other three values are unchanged.
- `seed-gyms-compile-to-signed-off-text` (`configGuards.ts`): it looped over `CALL_TYPES`, which now includes `cancellation`, for which there is no hand-written text. It loops over the signed-off keys instead, still compares all six blocks byte for byte, and asserts it compared six. The seed gyms' cancellation text is pinned in the new guards.
- `themed-summary-never-reaches-a-prompt` now also scans `agents/prompts/cancellation/` (more coverage, same assertion).

## The 15 payloads

Before any file was edited, `scripts/snapshot-scenario-payloads.ts` was run on the untouched code and its output kept outside the repo (sha256 `101a9129b01970d05a968a8a70259b128999e7fda5c442fa09afd83b87acb452`, 15 scenarios, dataset date 2026-09-12). After the build, the same script produced 31 payloads; the 15 with the same ids are byte-identical to the baseline, including `context`, `incentives`, `expiry_line` and every gym fact. That committed file is what the guard compares against now, and the script's `--check` does the same outside the guard runner.

Why they held: the freeze fields only reach the cancellation block, `context` only gained a cancellation branch, `data/gyms.json` is unchanged (the scenarios apply the freeze as an override), and no prompt or shared section changed.

## Live run

Not run. Stopped at step 2 as instructed. The last committed run is still the pass-one state: 20/20 guards (now 80/80 with the same 20 unchanged), 15/15 conversations, payloads unchanged.

## Decisions the plan didn't settle

1. **A flagged fixed-term member gets the cancellation call**, not the renewal or reengagement call — "a flagged member is callable only on `cancellation`" read strictly, and the plan's own generation note says those members "would otherwise sit in the renewal queue".
2. **A flagged member whose term has ended is not called at all**, rather than falling into the winback windows. Nothing left to cancel, and calling someone back who chose to leave is the gauntlet by another route. The reason on the card says so.
3. **No prior-call context on a cancellation call.** The closed loop's sentences ("do not ask why they stopped", "do not re-pitch") each contradict this call's Goal, and its offers are fresh by design.
4. **The conversation cooldown doesn't apply**; the no-answer redial wait does. The cooldown exists for a trigger that fires daily.
5. **`attempt_number` keeps its meaning** — which conversation with this member — so a cancellation call after a reengagement chat is attempt 2 on the card and in `call_records`. The cap is counted separately. The cancellation prompt never reads the variable.
6. **The freeze is not schedulable** and not extracted from documents; a cheaper tier offered on this call does spend the tier's cooldown for a later winback.
7. **The seed is unchanged.** Southbank still has only a cheaper tier, so on the live dashboard its flagged members get one offer; the ladder needs a freeze added through the edit form. The scenarios add it by override.
8. **The queue judges the offer gate against the default gym**; the call route against the chosen one. A switch can only turn a due call into a refusal, never the reverse.
9. **Data collection and criteria are unchanged.** The shared `stuck_to_one_ask` criterion's "single permitted save after a hesitation" maps onto the ladder: unsuitable is the hesitation, refusal is the no.
10. **"1 week", not "1 weeks":** the longest pause is compiled with its unit.
11. **The assertion patterns are conservative** — offers are counted and forbidden by their stated terms, not by mention, except where the plan says "never mentioned" (a freeze on a tier-only gym) — and hand-pinned. They will not be relaxed after a run.

## The single riskiest thing left

**The cancellation agent has never spoken.** Its prompt, its sixteen scenarios and the patterns that judge them are all untested against a model; the behaviour the whole pass exists to prevent — a second offer after a flat "no thanks" — has not been exercised once. Everything deterministic around it is pinned, but the first live run is the first evidence about the agent itself, and it is the one thing this pass could not produce without the sync it was told to stop before.

## Verification log

| Check | Result |
|---|---|
| `npm run evals:guards` | 80/80 |
| Scenario payloads | 15/15 byte-identical to the pre-pass snapshot; 31 pinned in `evals/payloads/scenarios.json` |
| `tsc --noEmit` | clean |
| `npm run db:verify` | all checks pass, ten migrations each applied twice, seven new checks |
| `npm run data:verify-port` | 500/500 exact |
| `npm run gyms:seed-check` | matches |
| `next build` | compiles and type-checks; 24 routes |
| `eslint` | 2 errors in `components/TranscriptPanel.tsx`, unchanged and pre-existing |
| `npm run agents:diff` | reengagement, winback, `send_text` unchanged; renewal differs in two dashboard-edited placeholders; cancellation would be created |
| `npm run agents:sync` | **not run** |
| `npm run evals` (live) | **not run** |
