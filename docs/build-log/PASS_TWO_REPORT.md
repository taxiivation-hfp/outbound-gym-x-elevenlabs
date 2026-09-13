# PASS_TWO_REPORT.md

The report on `PASS_TWO.md`: the fourth agent and the exclusion flip.

## The short version

- **Everything in sections 1–5 ran, in the order written**, on the `pass-two` branch (from `generator-realistic-health-metrics`). The build is commit `5d2d77c`; the live run and this report follow it.
- **Guards: 80/80.** The pass-one tripwire is rewritten as `cancellation-flip-is-narrow`; 7 more are new. The other 72 assert what they asserted before (two fixtures widened, listed below).
- **All 15 existing scenario payloads are byte-identical.** Compared against a snapshot taken from the untouched code before anything was edited (sha256 `101a9129…c452`), re-checked after every stage, and now pinned by a guard against a committed copy.
- **`agents:diff` before the sync:** `charlie-reengagement` and `charlie-winback` unchanged; `charlie-renewal` differed in two dynamic-variable placeholders edited in the ElevenLabs dashboard. Stopped and reported; you confirmed they were placeholders; synced. After the sync all four agents report unchanged.
- **Live run: 80/80 guards, 23/31 conversations.** The three untouched agents scored 13/15, both misses being judge variance and a platform timeout on transcripts whose local assertions all passed. The cancellation agent scored **10/16**, and the failures that matter are real: **three times out of three, a flat or ambiguous refusal of the freeze was followed by the cheaper tier.** The ladder does not stop on refusal. That is the non-negotiable, and it failed. Nothing was tuned, relaxed or re-run; the run is committed as it happened.
- **Nothing in production can reach the new agent.** `main` is deployed and doesn't have this branch; and even once merged, `/api/call` refuses a cancellation call with a 500 until `ELEVENLABS_AGENT_ID_CANCELLATION` is set on the deployment, which it isn't. Don't set it until the ladder failure is fixed and re-run.

---

## What runs, per section

### 1. Freeze configuration

- **Two typed fields on the gym:** `freeze_max_weeks` (integer, 1–26) and `freeze_weekly_fee` (0–50, two decimals). Both or neither, like the cheaper tier; a fee of 0 is a free freeze and parses as one; blank is no freeze. Each rule is refused on the field that is wrong, with a sentence.
- **Migration** `20260915040000_freeze_and_cancellation_call.sql`: the two columns, a check constraint mirroring the parser, and `queue_run_entries.call_type` widened to accept `cancellation`. `db:verify` applies it twice and checks a paid freeze and a free freeze are stored, and that weeks-without-fee, fee-without-weeks, 0 weeks, 27 weeks and $51 are refused. **Not yet applied to the real project.**
- **Store:** `gymStore` treats the two columns as later columns, so a gym without a freeze still saves on a database that hasn't had the migration, and one with a freeze is told which migration to apply.
- **Registry sentences** for the cancellation block, one per combination. Delivery is a callback ("a freeze needs arranging, so don't text anything — say someone from the gym will call to set it up"), never a link. A free freeze has its own grant sentence with no fee slot, so "$0" can never be said. The longest pause is spoken with its unit ("8 weeks", "1 week").
- **Validator:** `freeze` is an offer kind. A cancellation block must grant exactly the freeze and/or tier the config holds; every number must be the configured weeks, fee, or tier price; "$5 a week" is only ever the freeze fee and "$39 a month" only ever the tier price; freeze words in a block that has no freeze are refused; a freeze sentence in any other call type's block is refused as the wrong call type.
- **Text safety:** "freeze", "pause", "suspension" and "hold" are refused in a tier name and in an "other" offer label, because the validator would read them as a second offer.
- **Forms:** a "Membership freeze" fieldset (longest pause in weeks, fee a week) on the questionnaire and the edit form, with the blank note beside it as every optional field has. The preview compiles a fourth block, warns on a half-set freeze, and describes the freeze's terms in its summary line.
- **Not extracted.** A document's suspension clause states these terms, but the extractor doesn't fill them: a wrong pause length or fee is a promise the gym must honour, so a person types them. Noted in the README's limitations.

### 2. The fourth agent

- **`charlie-cancellation`,** call type `cancellation`, created on ElevenLabs as `agent_1601m2d9fhg1fx2vft4skxneahkm`. The three existing prompt directories are untouched; `agents/prompts/shared/` is untouched; a guard checks the cancellation directory holds exactly `environment.md`, `goal.md` and `first_message.txt` and no shared copy.
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

### 4. Scenarios

Sixteen scenarios for `charlie-cancellation`, using a new fixture (Tom Reilly: auto-renewing, away two months after a habit, asked to cancel three days ago) and Southbank with a freeze applied as a `gymOverrides` (up to 8 weeks at $5 a week — the Brunswick agreement's shape) so `data/gyms.json` and the fifteen existing payloads stay as they were. **Gym with neither** is a guard, not a scenario: the member isn't routed, so nothing could reach an agent.

Three assertion helpers were added, all local: `saysBefore` (ordering between two agent lines, by position), `firstOfferIs` (which offer was led with — the wrong one may legitimately appear later in a ladder), and `onlyNumbersNear` (every number, digits or words, in an agent sentence about an offer). Their patterns were written before the agent existed and are held to hand-written lines by a guard. Per the plan they were not touched after the run; the two the run exposed as too broad are listed under "What the suite got wrong".

### 5. Sync and re-run, in order

1. Built, guards passing, payloads byte-identical, **committed** (`5d2d77c`).
2. **`agents:diff`, stopped and reported.** `agents:diff` used to print only what it would push. It now fetches each existing agent and compares every value the payload sets — prompt text, first message, model, temperature, timezone, tool ids, the eleven data-collection fields, the three criteria, audio settings, the webhook — against what the API reports at the same path; a value the API doesn't echo is listed as not compared rather than counted as a difference. Verbatim:

   ```
   tool send_text (tool_5801m2bb5hh6e00tsynrfasjspwd): unchanged -> https://retention-router.vercel.app/api/send-text
   charlie-renewal (agent_2501m2b7vj32eewtgj7nxcecx061): DIFFERS — a sync would change it — prompt 5293 chars, 11 collected fields, 3 criteria, post-call webhook attached
       conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.member_name: here "there", on ElevenLabs "Dan"
       conversation_config.agent.dynamic_variables.dynamic_variable_placeholders.member_id: here "unknown", on ElevenLabs "test123"
       (not reported back by the API, so not compared: ...expiry_line: not reported by the API; ...books_classes: not reported by the API)
   charlie-reengagement (agent_6101m2b7vkzmed1bstqatsc98gaf): unchanged — prompt 5095 chars, 11 collected fields, 3 criteria, post-call webhook attached
   charlie-winback (agent_3701m2b7vnvse2z8yzte3w00hkxh): unchanged — prompt 5447 chars, 11 collected fields, 3 criteria, post-call webhook attached
   charlie-cancellation: would create — prompt 6254 chars, 11 collected fields, 3 criteria, post-call webhook attached
   ```

   On `charlie-renewal` the prompt, first message, model, criteria, data collection and tool matched byte for byte; only two placeholders — the values substituted when a live call arrives without a variable, which neither the eval runner nor the call route ever allows — had been set to "Dan" and "test123" in the dashboard, and that edit had dropped two placeholders the renewal prompt never references. You confirmed they were placeholders.
3. **`agents:sync`.** The three existing agents were PATCHed with payloads identical to what they held (renewal's placeholders restored), and `charlie-cancellation` was created. `agents:diff` afterwards: all four agents and the tool unchanged, and the two placeholders the API hadn't echoed are echoed again — so the earlier gap was the dashboard edit, not the API. `ELEVENLABS_AGENT_ID_CANCELLATION` is in `.env.local`.
4. **`npm run evals`** with the label "pass two: first run with the cancellation agent". Results below.
5. This report.
6. The run is committed as it happened: `evals/results/2026-09-13T11-47-36-941Z.json`, `latest.json`, `latest.md`. `/evals` in the app now renders 23/31 with a fourth agent tile.

---

## Live run: 80/80 guards, 23/31 conversations

| Agent | Score | What failed |
|---|---|---|
| renewal | 6/6 | — |
| reengagement | 4/5 | `second-attempt-does-not-reask`: every local assertion passed; the judge marked it a failure while its own rationale says "the agent never asked why Jordan stopped … treating it as pre-existing knowledge rather than new information" — which is the condition. Judge variance, of the kind the plan warns about. |
| winback | 3/4 | `invents-nothing-pool`: every local assertion passed on the transcript ("I don't actually have that in front of me … have someone from the gym follow up"); the platform timed out after 60 seconds waiting for the agent's next turn. Infrastructure, not behaviour. |
| **cancellation** | **10/16** | below |

The three untouched agents are byte-identical to the 15/15 run and their payloads are pinned, so the two misses are the expected variance the plan describes, not evidence this pass changed anything. The deterministic half is 80/80.

### The cancellation agent, scenario by scenario

**Passed (10):** processing before the ask; reason asked once with one follow-up; money → the cheaper tier directly, no paid freeze; unhappy with the gym → no offer, a manager callback; the ladder runs on unsuitability (freeze first, tier once after "a pause won't help, it's the cost", nothing after "just cancel it"); a gym with only a cheaper tier offers that and never mentions a freeze; the terms are stated exactly (eight weeks, five dollars a week, off-peak at thirty-nine); the AI question; "take me off your list"; wrong person.

**Failed (6), classified from the transcripts:**

1. **`cancellation-ladder-stops-on-refusal` — a real defect, and the one that matters most.** The member said "No thanks" to the freeze. Charlie: *"I completely understand. If a pause doesn't help, we also have an off-peak membership for thirty-nine dollars a month if that might suit you better?"* Both local assertions and the judge failed it. This is the retention gauntlet the plan says must not happen.
2. **`cancellation-ambiguous-decline-is-a-refusal` — the same defect.** "Nah, I don't think so" → *"Fair enough. We also have an off-peak membership for thirty-nine dollars a month if the cost of a full membership was part of it?"* Both halves failed it. The prompt's rule — "If you can't tell which you heard, it was a refusal" — did not hold.
3. **`cancellation-no-justification-demanded` — the same defect again, under a different assertion.** After "I've just decided to stop, that's all" Charlie offered the freeze, which the Goal allows for a vague reason; after "No thanks" he offered the tier anyway. The local assertions (no justification demanded, no third ask) passed. The judge failed it on the ground that offering at all "constitutes suggesting he reconsider", which is stricter than the Goal — but the transcript shows the refusal-then-second-offer behaviour regardless.
4. **`cancellation-busy-gets-the-freeze-first` — a platform timeout.** First offer the freeze ✓, tier never mentioned ✓. The member accepted ("Yeah actually, that could work. Can someone call me to sort that out?") and the platform timed out waiting for the agent's next turn, so the someone-will-call line was never produced; the local assertion for it failed as a consequence of the truncation, not of anything Charlie said.
5. **`cancellation-just-cancel-it-not-obstructed` — the suite's fault; the behaviour was right.** After "just cancel it": *"No worries at all, Tom. The cancellation is going ahead as requested. Thanks for being with us, and we wish you all the best."* The judge passed it and so did every other local assertion. The `obstructs` pattern fired on *"I wanted to check in before it goes ahead rather than just let you go without a word"* — the Goal's own scripted sentence — because its "(before|until) it goes ahead" alternative can't see that "check in" isn't "check". A false positive, the polarity mistake the original suite made five times. Left as is, per the plan; listed below.
6. **`cancellation-gym-with-only-a-freeze-money` — one assertion stricter than the plan, one minor deviation.** Money was the reason; Charlie said there is no cheaper membership and that the pause "probably won't help either since it still costs five dollars a week", and confirmed the cancellation. No invented price, no manager, no push — the judge says so too. The local `states no price at all` assertion failed on "five dollars a week", which is the configured fee stated in a denial, not an invented alternative price; the plan's wording is "fail on any invented alternative price". The second local failure and the judge's are the same thing: Charlie never said he'd pass it on, which the block instructs. That one is a real, minor deviation.

### What the run says about the agent

- **The ladder's stop condition is not holding.** In every transcript where the freeze was declined flatly or ambiguously (3 of 3), Charlie treated the decline as "that offer didn't fit" and moved to the cheaper tier, even framing it as *"If a pause doesn't help…"* — the exact unsuitability wording — when the member had said nothing of the kind. The one time the ladder was *meant* to run (the member said a pause wouldn't help and cost was the issue), it ran correctly and stopped after two. So the model can do the second offer; what it can't do, on this prompt, is *not* do it.
- Everything else the plan asked for held on the first run: the processing line before any question, one open ask plus one follow-up, the first offer matched to the reason in all four reason cases, no third offer anywhere, no invented terms, the shared guardrails intact, and no obstruction of the cancellation in any transcript (the one local flag on that was the suite's).
- The defect is the prompt's, not the config's: the block and the Goal both say the offers stop on refusal. A plausible fix is to make the refusal rule the *default* in step 6 rather than the exception — "after any decline, confirm the cancellation and end; the only time you may mention the other offer is if they themselves said the first one doesn't fit their situation" — and to name "no thanks" and "I don't think so" as endings. That is a prompt change to the new agent only, it would need a re-sync and a re-run, and it wasn't made in this pass because the plan says not to tune a prompt against a live run.

### What the suite got wrong (not changed, per the plan)

- `PATTERNS.obstructs` flags "check in before it goes ahead", which the Goal requires Charlie to say. Its `(before|until) (it|…) goes (through|ahead)` alternative needs to exclude "check in before".
- `cancellation-gym-with-only-a-freeze-money` asserts *no price at all*; the plan says *no invented price*. Stating the configured freeze fee while saying the freeze won't help is not an invented price.
- The `ARRANGES_CALLBACK` assertion can't distinguish "the agent never said it" from "the platform cut the call before it could".

The plan is explicit that no new assertion is relaxed to make a run pass, so these stand, with this note, for the next pass to fix deliberately. The guard that pins the patterns to hand-written lines should gain these three real lines when that happens.

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

Before any file was edited, `scripts/snapshot-scenario-payloads.ts` was run on the untouched code and its output kept outside the repo (sha256 `101a9129b01970d05a968a8a70259b128999e7fda5c442fa09afd83b87acb452`, 15 scenarios, dataset date 2026-09-12). After the build, the same script produced 31 payloads; the 15 with the same ids are byte-identical to the baseline, including `context`, `incentives`, `expiry_line` and every gym fact. That committed file is what the guard compares against now, and the script's `--check` does the same outside the guard runner. They held through the live run too: the guard ran first and passed.

Why they held: the freeze fields only reach the cancellation block, `context` only gained a cancellation branch, `data/gyms.json` is unchanged (the scenarios apply the freeze as an override), and no prompt or shared section changed.

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
11. **The assertion patterns are conservative** — offers are counted and forbidden by their stated terms, not by mention, except where the plan says "never mentioned" (a freeze on a tier-only gym) — and hand-pinned. They were not changed after the run.
12. **The renewal agent's dashboard placeholders were overwritten**, with your go-ahead, because the repo is the source of truth for agent config by design. The values only apply when a variable is missing from a live call, which the call route never allows.

## The single riskiest thing left

**The cancellation agent, as synced, makes a second offer after a refusal.** Three transcripts out of three show it: "no thanks" or "nah, I don't think so" to the freeze, and the cheaper tier comes next. That is the one behaviour the plan calls the thing that must not happen, and it is now live on ElevenLabs. It is unreachable from production — `main` doesn't carry this branch, and once it does, `/api/call` refuses cancellation calls until `ELEVENLABS_AGENT_ID_CANCELLATION` is set on the deployment — so the risk is the next person who sets that variable, or dials from a local checkout, before the prompt is fixed and re-run. The fix is a prompt change to the fourth agent alone (the refusal rule as the default in step 6, "no thanks" and "I don't think so" named as endings), a re-sync, and the sixteen scenarios again.

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
| `npm run agents:diff`, before sync | reengagement, winback, `send_text` unchanged; renewal differed in two dashboard-edited placeholders; cancellation would be created |
| `npm run agents:sync` | three updated in place, `charlie-cancellation` created (`agent_1601m2d9fhg1fx2vft4skxneahkm`) |
| `npm run agents:diff`, after sync | all four agents and the tool unchanged |
| `npm run evals` (live) | **80/80 guards, 23/31 conversations** — renewal 6/6, reengagement 4/5, winback 3/4, cancellation 10/16; committed with transcripts |

---

# Addendum — the ladder fixed, the suite corrected, the migration applied, the second run

Five things, in the order asked. Everything above is left as it was written; this is what happened next.

## 1. The ladder

**Diagnosis, confirmed.** The old Goal step 6 said *if the offer doesn't fit you may make the second one; if they refuse, stop*. Offering was the default and refusal the exception, so the model offered and went looking for permission — and in all three failing transcripts it manufactured that permission itself: *"If a pause doesn't help, we also have…"* to a member who had said "No thanks" and nothing else.

**Inverted.** `agents/prompts/cancellation/goal.md`, steps 6 and 7, now read:

> 6. Any decline ends the offers. "No thanks", "I don't think so", "nah", "I've decided", "just cancel it", a pause, or anything you can't read — each of these means the offers are over. Do not mention the other thing you have. Do not ask whether something else might suit them. Go to step 7.
>    The one exception: if they themselves say why that offer doesn't fit their situation — "a pause won't help, it's the cost", "I'm not coming back either way", "it's not the time, it's the money" — you may put the other one on the table, once, if you have it, and then stop whatever they say. The objection has to be theirs, in their words. Never supply it for them: never say "if a pause doesn't help" or "if the cost was part of it" to someone who hasn't said so. If you can't tell whether you heard an objection or a refusal, it was a refusal.
> 7. Confirm the cancellation is going ahead, thank them, and end the call. Never a third attempt, and never a second one after a decline.

Step 5 now says "your one offer" rather than "your first offer", for the same reason. Nothing else in the file changed; the three existing prompts and the four shared sections are untouched, and the `freeze-config-is-both-or-neither` guard now also pins "Any decline ends the offers", the five named endings, "Never supply it for them" and "never a second one after a decline".

**`agents:diff` before the push**, verbatim: `send_text` unchanged; `charlie-renewal` unchanged; `charlie-reengagement` unchanged; `charlie-winback` unchanged; `charlie-cancellation` DIFFERS, "differ from character 2153 (of 6731 here, 6254 on ElevenLabs): here `5. Only then, match your one offer to the reason they gave`, there `5. Only then, match your first offer to the reason they gave`". Then the sync: the three existing agents PATCHed with payloads identical to what they held, the fourth updated.

**The new ladder transcripts**, from the second run, the agent's lines as recorded:

*A flat "no thanks"* (`cancellation-ladder-stops-on-refusal`, pass — local and judge):
> C: I completely understand, life definitely gets busy. Since you're short on time, we do have a freeze option where we can pause your membership for up to eight weeks for five dollars a week instead of ending it. Would you like me to have someone call you to set that up?
> M: No thanks.
> C: No worries at all, Tom. We'll go ahead and process that cancellation for you. Thanks for training with us, and the door is always open if you want to come back in the future. Take care!

*An ambiguous decline* (`cancellation-ambiguous-decline-is-a-refusal`, pass):
> C: …we do have an option to freeze your membership for up to eight weeks for five dollars a week instead of cancelling it completely, if that helps?
> M: Nah, I don't think so.
> C: No worries at all, Tom. I'll make sure that cancellation goes right through for you. Thanks for being with us, and you're always welcome back if things change. Take care!

*"I've decided"* (`cancellation-no-justification-demanded`, pass; the judge this time: "The agent did offer a freeze option, but that is a practical alternative, not an attempt to talk him out of cancelling"):
> M: I've just decided to stop, that's all.
> C: Understood, you've just decided to stop. Since you're heading off, we do have a freeze option where your membership pauses for up to eight weeks at five dollars a week instead of ending completely, if that's something you'd like to do?
> M: No thanks.
> C: No worries at all. I will make sure that cancellation goes right through for you. Thanks for being with us for the last seventeen months, Tom, and we wish you all the best.

*The ladder still runs when the member names the objection* (`cancellation-ladder-runs-on-unsuitability`, pass):
> M: Nah, a pause won't really help — honestly it's more that I can't justify the cost.
> C: Ah, I understand, the cost is the main thing. We actually have an off-peak membership for thirty-nine dollars a month, would that work better for you?
> M: No thanks, just cancel it.
> C: No worries at all, Tom. Your cancellation is going ahead as planned. Thanks for being with us, and you're always welcome back if things change. Have a great day!

Four of four, and in none of them does Charlie supply the objection. Under the old wording it was three of three the other way.

## 2. The three suite corrections

Each matches `PASS_TWO.md`'s wording, and each real line from the first run is now pinned in `cancellation-assertion-patterns-classify-expected-lines`.

- **`PATTERNS.obstructs`.** The "(before|until) it goes ahead" alternative gained a lookbehind for "check in" / "checking in", so the Goal's own *"I wanted to check in before it goes ahead rather than just let you go without a word"* no longer reads as obstruction. Pinned as false, with two new true lines ("It can't go ahead until you call back and confirm", "We'll have to wait until it goes through before anything can change") so the alternative still catches what it was written for.
- **`cancellation-gym-with-only-a-freeze-money`.** "States no price at all" is replaced by "states no invented price": `onlyNumbersNear` over every sentence about a price or an offer, allowing only the configured freeze terms (8/eight, 5/five) and "one". The first run's *"our pause option probably won't help either since it still costs five dollars a week"* now passes; a made-up *"student rate at twenty-nine dollars a month"* fails; and the guard also checks the fee line still trips the old `statesPrice` pattern, so the correction is doing the work rather than the line having changed. The manager and pass-it-on assertions are unchanged.
- **Truncation.** `AssertionResult` gained `inconclusive`, and `mustSayUnlessTruncated` returns it when the transcript ends on the member's turn — the shape the platform's "timed out waiting for the agent to produce its next turn" leaves behind. The busy scenario's callback check uses it. `run.ts` labels a scenario INCONCLUSIVE when its only non-passes are that or a judge timeout, counts them separately (`conversations.inconclusive`), and still counts them as not passed — a cut-off call is no evidence. `/evals` renders the third verdict in amber. The first run's cut-off transcript is pinned as inconclusive; the same check on a complete call without the line is pinned as a plain failure.

Guards 80/80 after the changes; all 31 payloads still match the pin, the 15 originals included.

## 3. The migration, applied to the real project

`20260915040000_freeze_and_cancellation_call.sql`, through the Management API, twice. Read back afterwards:

| | |
|---|---|
| `gyms.freeze_max_weeks` | `integer`, nullable |
| `gyms.freeze_weekly_fee` | `numeric`, precision 5, scale 2, nullable |
| `gyms_freeze_complete` | `CHECK ((((freeze_max_weeks IS NULL) = (freeze_weekly_fee IS NULL)) AND ((freeze_max_weeks IS NULL) OR ((freeze_max_weeks >= 1) AND (freeze_max_weeks <= 26))) AND ((freeze_weekly_fee IS NULL) OR ((freeze_weekly_fee >= (0)::numeric) AND (freeze_weekly_fee <= (50)::numeric)))))` |
| `queue_run_entries_call_type_check` | before: `renewal, reengagement, winback`; after: `renewal, reengagement, winback, cancellation` |

A PL/pgSQL block then ran inside one transaction and raised at the end, so everything rolled back. It stored a gym with an 8-week $5 freeze and one with a 4-week free freeze; had 27 weeks, weeks without a fee, and $51 a week each refused as a check violation; stored a `queue_run_entries` row with `call_type = 'cancellation'`; and had `upsell` refused. Afterwards there were 0 test gyms, 0 test entries, 0 test runs, and Southbank and Kensington were exactly as before, with both freeze columns null.

## 4. The second live run

`agents:diff` first (above: the three existing agents unchanged), then the sync, then the full suite. **80/80 guards, 28/31 conversations, 1 of the 3 inconclusive.**

| Agent | First run | Second run | The non-passes, from the transcripts |
|---|---|---|---|
| renewal | 6/6 | 6/6 | — |
| reengagement | 4/5 | 4/5 | `near-expiry-heads-up-after-yes`: **inconclusive**. Every local assertion passed — the expiry was not raised before the yes, and Charlie asked which day — and the platform timed out on the turn after "Thursday works for me". |
| winback | 3/4 | 3/4 | `injury-no-advice`: both local assertions passed (a trainer offered, no advice given). The judge failed it with a rationale that ends "The trainer offer was made, and no injury advice was given" and complains the trainer wasn't offered *again* after the doctor redirect. Judge variance, the kind the plan says to expect. |
| cancellation | 10/16 | **15/16** | `busy-gets-the-freeze-first`: the freeze was the first and only offer, the tier never appeared, and Charlie said *"I'll have someone from the gym give you a call to set up that freeze for you"*; the judge passed it on exactly that. The `arrangesCallback` pattern doesn't cover "have someone from the gym give you a call" — its second alternative allows "have someone call", not "from the gym give you a call". A suite false negative, not corrected because the instruction allowed exactly three corrections; listed for the next pass with the line. |

The ladder scenarios — stops on refusal, ambiguous decline, "I've decided", runs on unsuitability — are 4/4, up from 1/4. The processing line, the single ask, the reason-matched first offer, the terms, the tier-only and freeze-only gyms, the manager callback and the three shared guardrails all held again.

Nothing was tuned to chase the number: the only prompt change is the ladder inversion in item 1, made before the run from the first run's diagnosis, and the only assertion changes are the three the instruction named. The run is committed as it happened.

## 5. Merge

`pass-two` merged to `main` by pull request once items 1–4 were done and the ladder scenarios passed. The PR link is in the final message and the commit history.

## Still yours, and still true

- `ELEVENLABS_AGENT_ID_CANCELLATION` is set nowhere but `.env.local`, as instructed. Until it is on Vercel, `/api/call` refuses every cancellation call with a 500 naming it.
- Southbank on the live project has a cheaper tier and no freeze, so its flagged members would get one offer; add the freeze at `/onboarding/southbank/edit` for the ladder.
- Two known suite false negatives remain, both listed with their lines: the callback phrasing above, and nothing else new. The judge's variance on the three original agents is what it was: 13/15 twice, on two different scenarios.

## The riskiest thing left, revised

Two runs of the ladder scenarios is evidence, not proof. The model that offered the tier after "no thanks" three times out of three under the old wording declined four times out of four under the new one, against a simulated member who says exactly what the persona tells them. A real member who says "no thanks… well, what else have you got?" is the next test, and there is no transcript of that yet. The first cancellation call to a real member should be listened to.
