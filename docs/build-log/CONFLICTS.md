# CONFLICTS.md — Charlie docs vs the framework doc

Scope of this pass: read `FEATURES_AND_DECISIONS.md` (framework),
`charlie_build_brief.md` (brief) and `charlie_spec.md` (spec) in full, then
checked every claim against what is actually in the repo: the Supabase
migration, `lib/types.ts`, the three API routes, `pipeline/generate_gym_data.py`,
`pipeline/build_scores.py`, the raw CSVs and `data/members_scored.json`. Nothing
was edited except this file. No agents were created or pushed.

Notation: `F:12` = FEATURES_AND_DECISIONS.md line 12, `B:12` = brief line 12,
`S:12` = spec line 12.

**Counts:** 16 conflicts · 12 gaps · 15 open questions.

Weighting used, as instructed: Charlie wins on behaviour (call types, what he
says, guardrails, triggers, who gets called); the framework wins on plumbing
(schema, naming, module layout, queue mechanics). Where I think the framework
should win, or where Charlie's own docs disagree with each other, it is said
explicitly.

One framing note before the list. The two sides were built around different
mental models and most of the conflicts flow from that:

- **Framework:** one AI call type, fired manually from the dashboard, for one
  cohort (`winback` = contract expired *or* expiring). Everyone else is either
  staff-handled or deliberately not contacted. Eligibility is enforced
  server-side by a static JSON file.
- **Charlie:** three AI call types on dated triggers, for every *fixed-term*
  member at the right moment in their lifecycle. The only hard exclusion is
  auto-renewers. Eligibility needs live call history.

---

## 1. Conflicts — both docs specify something, differently

### C1. Number of call types, and their names

**Framework:** one AI call type.
> `winback` — `{"contact": True, "channel": "ai_call", "action": "outbound reactivation call"}` (`build_scores.py:128`)
> "This is what actually enforces 'only winback members get called' as a real constraint: a direct POST for any non-`ai_call` member_id gets a 403" (F:120-122)
> "`ELEVENLABS_AGENT_ID`" — a single agent id in `.env.local` and `app/api/call/route.ts:52`.

The other two contact cohorts are staff actions, not calls: `new_joiner` →
"in-person welcome conversation", `sliding` → "floor conversation on next visit"
(`build_scores.py:125-126`).

**Charlie:** three AI call types, three agents.
> "**Three agents, not one.** `charlie-renewal`, `charlie-reengagement`, `charlie-winback`. Each prompt covers exactly one call type with no `if call_type` logic anywhere." (B:34-36)
> Spec table names them `renewal`, `reengagement`, `winback` (S:10-12).

Charlie's two docs disagree with each other on the agent names (bare vs
`charlie-` prefix). The brief is the build document, so `charlie-*` for the
ElevenLabs agent names and the bare word for the `call_type` value.

**Type:** behaviour (which calls exist) with a plumbing tail (agent ids,
`channel`, dashboard labels).

**What breaks:**
- Pick framework: the renewal and reengagement agents never get dialled. The
  whole "fixed-term lifecycle" idea in the Charlie docs collapses to one
  post-expiry call.
- Pick Charlie: `ELEVENLABS_AGENT_ID` becomes three ids; `/api/call` must pick
  an agent per member; `Member.channel === "ai_call"` is no longer enough to
  choose a prompt; `Dashboard.tsx` labels ("Winback Call Transcripts",
  `callQueueCount`) and the framework doc's stated invariant "only winback
  members get called" are wrong.

**Recommendation:** Charlie. Keep the framework's staff channel for
`new_joiner` and `sliding` — Charlie never contradicts it, he just doesn't
cover it. Plumbing: keep `channel: "ai_call"` as the framework has it and add a
`call_type: "renewal" | "reengagement" | "winback" | null` field beside it,
rather than overloading `channel`. Three env vars
(`ELEVENLABS_AGENT_ID_RENEWAL` etc.), route picks by `call_type`.

---

### C2. Who gets called: `sleeping_dog` is "do not contact" vs reengagement

**Framework:** every active member dormant 60+ days is a sleeping dog and is
never contacted, regardless of contract type.
> "`sleeping_dog` — active, dormant ≥60 days" (F:19)
> "`sleeping_dog`: {"contact": False, "channel": None, "action": "do not contact"}" (`build_scores.py:127`)
> "hasn't visited in … but is still an active, paying member. Contacting them risks reminding them to cancel — do not contact." (`build_scores.py:169-171`)
> "it sits ahead of `steady` despite being a genuine no-action cohort, because 'who we correctly did *not* call' is part of the product's pitch" (F:83-85)

**Charlie:** a fixed-term member who has stopped coming gets a reengagement
call. Only auto-renewers are excluded.
> "`reengagement` | Inactive, membership still live | 4 weeks absent, **or** 2 weeks before expiry | Get them back in the door." (S:11)
> "It never calls auto-renewing members, at any point in their term, however absent they are — a call to an auto-renewer reminds them to cancel." (B:18-19)

**Type:** behaviour.

**What breaks:**
- Pick framework: 58 members the framework marks "do not contact" include
  fixed-term members Charlie exists to call. Reengagement has almost no
  audience (see numbers under C5).
- Pick Charlie: the "who we correctly did not call" pitch narrows from
  "everyone dormant on an active contract" to "dormant *auto-renewers*". That
  is actually the sharper version of the pitch and matches the README
  ("members on auto-renew who stopped showing up … No"), but it needs a
  membership-type field the data doesn't have (Gap G1).

**Recommendation:** Charlie. The framework's sleeping-dog logic is the right
idea keyed on the wrong signal (dormancy instead of contract type) because the
generator never produced an auto-renew flag. Keep the framework's server-side
403 pattern (F:118-124) — it is the right enforcement mechanism — but change
what it enforces: `auto_renew == false && !do_not_contact && call_type != null`.

---

### C3. Can an auto-renewing member ever be called?

**Framework:** in principle yes, by accident. The `winback` cohort is
"contract expired/expiring" (F:18) with no auto-renew check, and `expiring`
members are still live:
> `expiry_offset = random.randint(-60, 5)  # negative = already expired` … `status = "expired" if expiry_offset < 0 else "expiring"` (`generate_gym_data.py:172-174`)

Every `month-to-month` contract in the data has an `expiry_date` and can land
in `expiring`. If month-to-month means auto-renew (Open O2), the framework
would call an auto-renewer five days before their rollover — the exact failure
Charlie describes.

**Charlie:** never, and it is a non-negotiable.
> "Do not build any path that calls an auto-renewing member." (B:625)

**Type:** behaviour.

**What breaks:**
- Pick framework: violates Charlie's non-negotiable, and the README's own
  product statement.
- Pick Charlie: needs the membership-type field (G1) and a hard filter in both
  the queue builder and `/api/call`.

**Recommendation:** Charlie, unambiguously. This is the one place where the
framework doc is silent on its own product's core rule.

---

### C4. The word `winback` means two different things

**Framework:** `winback` is a *cohort*: contract expired **or** expiring, and
the 100% winback accuracy figure (F:35) is measured against an answer key that
labels both as winback.

**Charlie:** `winback` is a *call type*: expired only.
> "`winback` | Expired | ~1 month, ~3 months, ~6 months after expiry" (S:12)
> "Their membership expired {{time_left}} and there is nothing for them to cancel." (B:290)

A still-live "expiring" member is, in Charlie's model, either a renewal call
(if still training) or a reengagement-near-expiry call (if absent). In the
data there is exactly one such member (winback cohort, status `expiring`,
month-to-month, absent); under Charlie he is reengagement, not winback.

**Type:** plumbing (naming), with a small behaviour edge.

**What breaks:**
- Rename the cohort: the pipeline, the answer key, the accuracy claim, the
  dashboard bucket and `sortMembers.ts` all change for one member.
- Keep the cohort name and let `call_type` differ: one member's card says
  "Winback" on the dashboard but dials the reengagement agent.

**Recommendation:** framework wins on the cohort name and definition — leave
`cohort` alone. Add `call_type` as a separate derived field (see C1) computed
from Charlie's triggers, so cohort explains the member and `call_type` picks
the agent. Accept the one-member label mismatch; it is the cheaper wrong.

---

### C5. Trigger thresholds

**Framework:** static cohort thresholds, no dates relative to expiry, no
post-expiry cadence.
> "`sleeping_dog` — active, dormant ≥60 days" (F:19)
> "`sliding` — active, meaningful recent drop (≥1.5x/week historical habit, ≥2 visits in the prior window, ≥50% drop, not fully dormant)" (F:20-21)
> winback = expiry anywhere in the −60..+5 day window (`generate_gym_data.py:172`)

**Charlie:** dated triggers.
> renewal "2 weeks before expiry"; reengagement "4 weeks absent, **or** 2 weeks before expiry"; winback "~1 month, ~3 months, ~6 months after expiry" (S:10-12)

Applying Charlie's triggers to the current synthetic data (auto-renew not
filtered because the field doesn't exist):

| Charlie trigger | Members | Framework treats them as |
|---|---|---|
| renewal (live, ≤14 d to expiry, visited in last 28 d) | **0** | — |
| reengagement, ≥28 d absent | 93 | sleeping_dog 58 (do not contact), steady 29 (no action), sliding 5 (staff), winback 1 |
| reengagement, ≤14 d to expiry while absent | 1 | winback |
| winback, expired | 19 | winback |
| winback ~1-month window (20–45 d) | 11 | winback |
| winback ~3-month / ~6-month windows | **0 / 0** | — (max expiry age in data is 55 d) |

**Type:** behaviour.

**What breaks:**
- Pick framework: no renewal calls, no reengagement calls, no re-call cadence.
- Pick Charlie: 29 `steady` members get a reengagement call. The framework's
  `sliding` rule deliberately requires an established habit (`old_rate ≥ 1.5`)
  so that a naturally sporadic attender who goes quiet for a month by chance is
  not treated as a drop-off (F:36-42 explains exactly this noise). Charlie's
  flat "4 weeks absent" has no such guard.

**Recommendation:** Charlie's triggers and numbers, since they are the
behaviour spec — but I'd ask you to consider borrowing the framework's habit
guard for the absence trigger (e.g. only fire "4 weeks absent" when
`old_rate ≥ 1.0` or `visit_count_90d ≥ N`). Otherwise the reengagement agent
spends most of its calls on people who were never regulars. Your call; I've
not assumed it.

---

### C6. How the call queue is built

**Framework:** a priority-sorted list, top 5, human presses "Call Now".
> "primary sort is cohort urgency (`winback → sliding → new_joiner → sleeping_dog → steady`), secondary sort is `days_since_last_visit` descending" (F:76-79)
> "**Dashboard Action Queue** shows only the top 5 by this sort" (F:87)
> `ActionQueueTable.tsx:30` POSTs `/api/call` on click. No scheduler, no cron, no re-call logic. `/api/call-records` returns "One row per member — the most recent" (`call-records/route.ts:28`).

**Charlie:** trigger-driven, gated by call history.
> "Not passed to the prompt but needed by the router: … `last_call_date`, `last_call_outcome`." (S:314-316)
> "If it doesn't, back off on an escalating cooldown so one member doesn't get eight near-identical calls in a year. Router logic, no prompt change. Numbers not picked yet." (S:398-400)

**Type:** plumbing (queue mechanics) sitting on top of a behaviour decision
(who is due).

**What breaks:**
- Pick framework: queue order is cohort urgency, which has nothing to do with
  "is this member due for a call today". A winback member already called
  yesterday still sits at the top.
- Pick Charlie literally: needs a scheduler, call-history reads, and cooldown
  numbers that Charlie's own docs say aren't chosen.

**Recommendation:** framework on mechanics, Charlie on inclusion. Keep the
manual "Call Now" button and the top-N table (right for a demo, and it keeps a
human in the loop). Replace the *ordering/inclusion* rule: a member is in the
queue when a Charlie trigger is due *and* call history doesn't block it
(`last_call_outcome`, `do_not_contact`, attempt count). Automation is Open O1.

---

### C7. Which agent gets dialled: the existing live agent vs three new ones

**Framework:** the route was verified against the *existing* ElevenLabs agent
and its prompt.
> "Dynamic variables sent to ElevenLabs (`gym_name`, `member_name`, `expiry_date`, `last_visit`, `old_rate`, `tenure`, `offer`) were confirmed against the *live* agent's actual prompt … all 7 placeholders accounted for." (F:126-129)

**Charlie:** build three agents from scratch, paste the prompts literally.
> "You are building three ElevenLabs outbound voice agents from scratch." (B:3)
> "Paste these literally. The `{{variable}}` markers are ElevenLabs dynamic variables and must remain as written." (B:61-62)

**Type:** behaviour (the prompt *is* the behaviour), plumbing tail (agent
ids, settings).

**What breaks:**
- Pick framework: none of Charlie's prompts, guardrails, data collection or
  settings exist; the 7-variable payload is sent to a prompt with 16 variables.
- Pick Charlie: the existing agent is retired (or kept as a fourth, unused
  id); the "verified against the live prompt" work in F:126-129 no longer
  applies and must be redone against three new prompts.

**Recommendation:** Charlie. The existing agent was a test harness with a
hardcoded example member (`eleven_labs_call.py:42-50`); nothing depends on its
prompt.

---

### C8. The dynamic-variable set at the ElevenLabs boundary

**Framework** sends 7 (`app/api/call/route.ts:58-66`):
`gym_name, member_name, expiry_date, last_visit, old_rate, tenure, offer`.

**Charlie** prompts reference 16 (B:461-494):
`member_name, member_id, tenure, last_visit, time_left, context, attempt_number, renewal_price, expiry_line, gym_name, opening_hours, quiet_hours, other_locations, has_online, books_classes, incentives`.

| | |
|---|---|
| In both, same meaning | `gym_name`, `member_name` (but see C9), `tenure`, `last_visit` |
| Framework only | `expiry_date` → becomes `time_left` + the date inside `context`; `old_rate` → becomes a clause inside `context`; `offer` → replaced by `incentives` (C10) |
| Charlie only | `member_id`, `time_left`, `context`, `attempt_number`, `renewal_price`, `expiry_line`, `opening_hours`, `quiet_hours`, `other_locations`, `has_online`, `books_classes`, `incentives` |

Charlie-internal wrinkle: the spec says `member_id` is "Not passed to the
prompt but needed by the router" (S:314), the brief passes it as a dynamic
variable with default `unknown` (B:470) because the `send_text` tool reads it
(B:417). Brief wins; it is needed for the tool.

**Type:** plumbing, but forced by the prompt: ElevenLabs variable names must
match the `{{placeholders}}` exactly or the call goes silent
(`eleven_labs_call.py:40-41`).

**What breaks:** either side's names sent to the other side's prompt → silent
first message / unresolved variables.

**Recommendation:** Charlie's names at the ElevenLabs boundary, no exceptions
— that boundary belongs to the prompt. The framework's names stay everywhere
*inside* the app (see C16). The route already does formatting at the boundary
(`formatTenure`, `formatOldRate`), so this is an extension of the existing
pattern, not a new one.

---

### C9. `member_name`: full name vs first name

**Framework:** `member_name: member.name` (`route.ts:60`), where `name` is the
Faker full name. 19 of 500 carry titles or suffixes ("Dr. Jordan Hill PhD").

**Charlie:**
> "`member_name` | `Sarah` | First name only." (S:305)
> First message: "Hi, is that {{member_name}}? It's Charlie from {{gym_name}}." (B:68)

**Type:** behaviour (it is literally the first thing Charlie says).

**What breaks:** framework → "Hi, is that Dr. Jordan Hill PhD?". Charlie →
a `first_name` derivation is needed, and Faker's titles/suffixes have to be
stripped or the first token is "Dr.".

**Recommendation:** Charlie. Derive first name in the route; strip
title/suffix tokens. Keep full `name` in the data for the dashboard.

---

### C10. The offer / discount / cheaper-tier structure

**Framework:** one per-member `offer` string, chosen by `member_id mod 3`
from a fixed list, required for eligibility.
> `OFFERS = ["a free PT session and a two-week trial", "a two-week trial and a class pass", "a free recovery-focused PT session"]` … `idx = int(member_id[1:]) % len(OFFERS)` (`build_scores.py:204-214`)
> `if (member.channel !== "ai_call" || !member.last_visit || !member.expiry || !member.offer) … 403` (`route.ts:44`)

**Charlie:** `incentives` is per gym **and** per agent, is a full paragraph
with delivery instructions and a mandatory door-closing sentence, and its
content is different:
> Renewal: "20% off their renewal. Text it as a link … No other discount exists, no cheaper plan exists, and you cannot ask a manager for more." (B:529-532)
> Reengagement: "a guest pass so they can bring a mate in. Lead with it … Text it as a link." (B:544-546)
> Winback: "a free PT session. It needs booking, so don't text it … the off-peak membership at $39 a month. Those two things are everything you have." (B:557-560)
> "Every incentives block you generate must end with a door-closing sentence." (B:566-567)

**Type:** behaviour (what Charlie may put on the table) with plumbing
consequences (where the text lives, route eligibility).

**What breaks:**
- Pick framework: "two-week trial" and "class pass" are things Charlie's
  guardrail forbids him to invent, but they'd be handed to him as `{{offer}}`
  with no delivery rule and no door-closer. The rotation by `member_id mod 3`
  is not a business rule; it was a demo filler.
- Pick Charlie: no gym-level source for the incentive text exists (G4); the
  `!member.offer` check in the route must go; `offer` leaves `Member`.

**Recommendation:** Charlie. Drop `offer`/`OFFERS` entirely rather than
mapping them — they don't correspond to anything Charlie can say. Incentive
text becomes gym config (G4), selected by `call_type`.

---

### C11. `expiry_date` (a date) vs `time_left` (a relative phrase)

**Framework:** sends `expiry_date` as a formatted calendar date with no year,
computed only for winback members.
> `record["expiry"] = format_expiry(row["expiry_date"])` → `"%-d %B"` e.g. "14 March" (`build_scores.py:200-201, 247`)
> `expiry_date: member.expiry` (`route.ts:61`)

**Charlie:** wants a relative phrase, and the calendar date only inside
`context`.
> "`time_left` | `twelve days` / `expired three weeks ago`" (S:308)
> `context` example: "Their membership is live until 14 March but won't auto-renew." (B:474)

**Type:** plumbing (representation), with behaviour weight because Charlie
reads `time_left` aloud ("it ends in {{time_left}}", B:80-81, B:111).

**What breaks:** framework → "it ends in 14 March". Charlie → `time_left`
cannot be derived from the formatted, year-less `expiry` string in
`members_scored.json`; it needs the raw ISO date (G2).

**Recommendation:** Charlie for the prompt variables. Plumbing: the pipeline
should emit the raw ISO `expiry_date` for every member and let the route
format both `time_left` and the date inside `context` at call time.

---

### C12. Who compiles `context`, `expiry_line` and `incentives`

**Charlie:** Python, offline.
> "the difference is carried by `{{expiry_line}}`, which Python compiles." (S:16)
> "These are built in Python from the onboarding form and the member record." (B:504)

**Framework:** the TypeScript route builds every dynamic variable at call
time from the static JSON; the only Python is the offline scoring pipeline with
a frozen clock.
> `TODAY = datetime(2026, 9, 12)` (`build_scores.py:21`)
> `formatTenure`, `formatOldRate`, `dynamicVariables = {...}` in `route.ts:11-66`

Charlie-internal wrinkle: the spec calls them "The three compiled variables"
(S:333, includes `context`); the brief's Step 8 is "The two compiled
variables" (B:502) and drops `context`, though it is still in the Step 7 table.

**Type:** plumbing (module layout).

**What breaks:**
- Pick Charlie (Python, offline): `attempt_number`, `time_left`, `expiry_line`
  and the "they've not been in for N weeks" clause all depend on *today* and on
  Supabase call history. The offline pipeline has a hardcoded date and never
  reads Supabase, so the values go stale the moment the JSON is written.
- Pick framework (TS, call time): the Python pipeline has to stop emitting
  pre-formatted strings for winback only and instead emit raw facts for
  everyone.

**Recommendation:** framework wins. Python emits raw per-member facts (ISO
`expiry_date`, `auto_renew`, `days_since_visit`, `old_rate`, `tenure_days`,
`monthly_fee`, `visit_count_90d`); a `lib/compileVariables.ts` builds the three
compiled strings plus `time_left`/`attempt_number` at call time. `incentives`
is static per gym and could be precompiled anywhere, but keeping all three
compilers in one TS module is simpler than splitting them across languages.
Note for whoever writes it: the month-or-less `expiry_line` block contains a
literal `{{time_left}}` (B:519-520); ElevenLabs will not expand a placeholder
that arrives *inside* a variable's value, so the compiler must substitute it
itself (Open O8).

---

### C13. `reason_for_leaving` vs `reason_for_absence`

**Framework:** column and webhook key are `reason_for_leaving`, and the doc
says the webhook key is a guess.
> `reason_for_leaving text` (migration line 15); `extractDataCollectionField(dataCollectionResults, "reason_for_leaving")` (`webhook/route.ts:86`)
> "a reasonable inference from the `call_records` column names (Dan's schema already used those exact names), but **unverified** — no access to the live agent's actual data-collection field configuration." (F:149-152)

**Charlie:** the field is `reason_for_absence`, and the brief says the names
are exact.
> "Use these exact field names and descriptions." (B:430-431)
> "`reason_for_absence` is the one that earns money." (S:281)

**Type:** plumbing (field/column naming).

**What breaks:** framework name on the agent → semantically wrong for renewal
and reengagement members, who have not left. Charlie name in the webhook with
the current column → either a rename migration or a mapping line.

**Recommendation:** Charlie's name, and I'd normally give naming to the
framework. Two reasons: the framework doc itself flags the name as an
unverified inference rather than a decision, and a migration is unavoidable
anyway because nine other data-collection fields have no column (G7). Rename
the column in that same migration. If the live table can't be altered before
the demo, the fallback is a one-line map in the webhook
(`reason_for_absence` → `reason_for_leaving`), not renaming the agent field.

---

### C14. `outcome` enum values, and `status` vs `outcome` overlap

**Framework:**
> `export type CallOutcome = "rebooked" | "callback" | "not_interested" | null;` (`lib/types.ts:29`)
> `export type CallStatus = "not_started" | "initiated" | "completed" | "failed";` (`lib/types.ts:28`)
> `TranscriptPanel.tsx:8-20` renders labels/styles only for those three values.

**Charlie:**
> "`outcome` | enum | One of: renewed, link_sent, booked, will_return, callback_requested, not_interested, do_not_contact, bad_time, wrong_number, no_answer." (B:436)

Only `not_interested` survives in both. Charlie's `no_answer` and
`wrong_number` overlap with the framework's `status: "failed"`.

**Type:** plumbing on the surface, behaviour underneath — the agent's
extraction prompt produces these values, so the enum *is* Charlie's.

**What breaks:** framework enum → the agent extracts values the dashboard's
`Record<NonNullable<CallOutcome>, string>` lookups don't know; TypeScript
rejects it or the badge renders `undefined`. Charlie enum → `types.ts`,
`TranscriptPanel.tsx` label/style maps need all ten.

**Recommendation:** Charlie's ten values for `outcome`. Keep the framework's
`status` column and lifecycle as-is (it is the plumbing state machine:
initiated → completed/failed) and treat `outcome` as the post-call analysis
result. Rule of thumb: `status=failed` means ElevenLabs never delivered a
transcript; `outcome=no_answer` means it did and the analysis said nobody
picked up. Both can exist. (Open O4 covers what actually fires on no-answer.)

---

### C15. Where per-gym facts come from

**Framework:** one env var.
> "`gym_name` isn't in the member data at all … so it's read from a `GYM_NAME` env var per the team's choice." (F:130-131)

**Charlie:** seven per-gym variables from an onboarding questionnaire.
> "### Per gym (from the onboarding questionnaire, set once)" (S:318) — `gym_name, opening_hours, quiet_hours, other_locations, has_online, books_classes, incentives`
> "`quiet_hours` matters more than it looks. The winback track tells Charlie to mention quiet times, and without this variable he'd be inventing them." (S:330-331)

**Type:** plumbing (config source).

**What breaks:** env vars → three multi-sentence incentive paragraphs in
`.env.local`, no structure, no per-gym rows. Questionnaire → a form nobody has
built.

**Recommendation:** neither literally. Follow the framework's own pattern for
member data: a checked-in `data/gym.json` (or one Supabase `gyms` row) holding
the flat answers, read server-side. `GYM_NAME` env var goes away. A form can
write that file later.

---

### C16. Column and variable naming, both directions

Every name that differs between the pipeline/JSON/DB and the Charlie docs.
Plumbing throughout.

| Framework (CSV / JSON / DB / TS) | Charlie | Same thing? |
|---|---|---|
| `name` (full) | `member_name` (first only) | no — see C9 |
| `signals.days_since_visit` (JSON) / `days_since_last_visit` (pipeline) | `last_visit` ("five weeks ago") | derived |
| `signals.tenure_days` | `tenure` ("eight months") | derived |
| `expiry` ("14 March", winback only) | `expiry_date` (router) / `time_left` (prompt) | no — see C11, G2 |
| `signals.old_rate` (float/week) | clause inside `context` | derived |
| `offer` | `incentives` | no — see C10 |
| `contract_type` (`month-to-month` / `6-month` / `12-month`) | `membership_type` (fixed-term vs auto-renew) | no — G1, O2 |
| `monthly_fee` (contracts.csv only) | `renewal_price` ("$59 a month") | partly — G3 |
| `visits_last_4wk`, `visits_prior_4wk` | `visit_count_90d` | no — G10 |
| `reason_for_leaving` | `reason_for_absence` | see C13 |
| `CallOutcome` 3 values | `outcome` 10 values | see C14 |
| `channel: "ai_call"` | agent name | add `call_type` — C1 |
| `GYM_NAME` env | `gym_name` | see C15 |

**Recommendation:** framework names stay inside the app (pipeline, JSON,
Supabase, TS types); Charlie names are used exactly once, at the boundary
where the route builds `dynamic_variables` and where the webhook reads
`data_collection_results`. One translation layer, in one file.

---

## 2. Gaps — Charlie needs something the framework doesn't have

Checked per variable against `generate_gym_data.py`, `build_scores.py`, the
CSVs, `members_scored.json`, the migration and the routes.

### G1. No auto-renew / membership-type field anywhere

Charlie's router needs `membership_type` "to enforce fixed-term only" (S:315).
The generator writes `contract_type` with values `month-to-month`, `6-month`,
`12-month` (`generate_gym_data.py:48`) and gives *every* contract an
`expiry_date`, including month-to-month. Nothing in the CSVs, the pipeline or
`members_scored.json` says whether a contract rolls over. `build_scores.py`
drops `contract_type` from the output entirely. This is the single most
important missing field: without it C2 and C3 cannot be implemented at all.
Whether `month-to-month` *means* auto-renew is Open O2.

### G2. Raw expiry date is not in `members_scored.json`

`expiry` is a formatted, year-less string ("14 March") and only present for
the 20 winback members (`build_scores.py:245-248`). `time_left`, the
renewal/reengagement-near-expiry triggers, `expiry_line` and the date inside
`context` all need the ISO date for *every* live member. It exists in
`contracts.csv` and is dropped on output.

### G3. `renewal_price` has no source in the scored data

`monthly_fee` (59/69/79/89/99) is in `contracts.csv` and dropped by
`build_scores.py`. Even if carried through, it is the *current* fee; Charlie
requires "what **this member** will actually pay, not their tier's list
price. If the gym has raised prices since they joined, this is the new
number" (B:480-482). Nothing models a post-rise price. For the demo,
`monthly_fee` formatted as "$59 a month" is the only candidate.

### G4. No per-gym data at all beyond `GYM_NAME`

`opening_hours`, `quiet_hours`, `other_locations`, `has_online`,
`books_classes`, and the three `incentives` texts (plus the flat inputs that
generate them: renewal discount %, guest-pass yes/no, PT-session yes/no,
cheaper-tier name and price) have no source. Members carry no `gym_id`, so the
app is single-gym by construction; Charlie's "one prompt serves every gym"
implies multi-gym but never asks for a gym key on the member either.

### G5. No attempt tracking, no `reached_member`, no call history reads

Charlie: "`attempt_number` | Which conversation this is, not which dial. A
no-answer does not increment it." (S:310). The router also needs
`last_call_date` and `last_call_outcome` (S:316). `call_records` has one row
per dial (`route.ts:97-107`) with no `reached_member`, no `call_type`, no
`attempt_number`. The webhook only acts on `post_call_transcription` and
explicitly ignores `call_initiation_failure` (`webhook/route.ts:71-75`), so a
no-answer row stays `initiated` forever and can't be told apart from a call in
progress. `/api/call` never reads `call_records` before dialling.
`/api/call-records` collapses to the latest row per member
(`call-records/route.ts:28-36`), which is fine for the dashboard but useless
for counting conversations. Scope of the count is Open O3.

### G6. `do_not_contact` has nowhere to live and nothing enforces it

Charlie: "'Stop calling me' ends the call immediately and permanently."
(B:149, repeated at B:255 and B:364) and the `do_not_contact` boolean (B:443). There is no members table in
Supabase — members are a static JSON file — so a permanent per-member flag has
no home, and `/api/call` doesn't check one. It has to be derived from
`call_records` (any row with `do_not_contact = true`) or stored on a new
table, and enforced in the same 403 branch as C2.

### G7. Nine of eleven data-collection fields have no column

`call_records` stores `transcript`, `outcome`, `reason_for_leaving` (migration
lines 13-15). Missing: `reached_member`, `reason_detail`, `committed_day`,
`offer_made`, `offer_accepted`, `link_sent`, `do_not_contact`,
`human_followup`, `sentiment`. Also missing: which agent / `call_type` made the
call, `attempt_number`, and the three evaluation-criteria results
(`stuck_to_one_ask`, `invented_nothing`, `no_guilt`, B:449-457). The webhook
helper stringifies everything (`String(value)`, `webhook/route.ts:55`), so the
five booleans would land as `"true"`/`"false"` text unless typed columns are
added. Cheapest complete fix: typed columns for the fields the dashboard/queue
reads, plus one `analysis jsonb` column holding the whole
`data.analysis` object so nothing is lost.

### G8. No `send_text` endpoint, no SMS path, no link builder

Charlie's `send_text` webhook tool posts `{link_type, member_id}` to "the
router's `/send-text` endpoint. It looks up the member and the gym, builds the
correct URL with any coupon already embedded, and sends the SMS." (B:410-421).
None of that exists: no `app/api/send-text`, no SMS sender (Twilio is only used
for voice via ElevenLabs; `twilio_call.py` is a voice test), no renewal/
incentive/booking URL scheme, no coupon. The brief permits a logging stub. It
also needs a public URL, the same blocker the framework already has for the
post-call webhook (F:185-191).

### G9. `first_message` override is never sent

Non-negotiable 5 (B:45-47) and verification item 14 (B:612) require the
override to work. `/api/call` sends only `dynamic_variables` inside
`conversation_initiation_client_data` (`route.ts:79`); no
`conversation_config_override.agent.first_message`. Trivial to add once we
know what it's for (Open O10).

### G10. `visit_count_90d` is not computed

The pipeline computes `visits_last_4wk` and `visits_prior_4wk` (8-week
horizon) (`build_scores.py:72-88`). A 90-day count is a two-line addition, but
it is absent and Charlie never says what the router does with it.

### G11. The synthetic data cannot exercise two of the three agents

From the counts under C5: **zero** members satisfy the renewal trigger
(`steady`/`sliding`/`sleeping_dog` expiries are all ≥31 days out; every
winback member has been absent 45+ days), and **zero** expired members are old
enough for the 3-month or 6-month winback windows (max 55 days). The generator
would need new cohorts or wider expiry windows. Not touched, per instructions
— flagging only.

### G12. Phone numbers are not dialable strings

Charlie's router needs `phone`; it exists, but Faker `en_AU` produces mixed
formats ("08-6591-8463", "2018.3667", "(07)-5877-1694", "+61.2.3843.0988").
159 of 500 are E.164. The framework already notes the numbers are synthetic
(F:175-176) and the route passes `member.phone` straight to ElevenLabs. Any
queue-driven dialling needs normalisation to `+61…` or a test-number override.

---

## 3. Open — neither doc decides

### O1. Manual or automatic firing
Charlie's triggers are dated; the framework's button is manual. Nobody says
whether a scheduler dials when a trigger is due, or whether the queue just
*shows* who is due and a human clicks. (C6 recommends manual for the demo, but
it is a decision, not a given.)

### O2. What `contract_type` maps to
Is `month-to-month` auto-renew? Are `6-month` and `12-month` fixed-term? That
mapping decides 270 of 500 members' eligibility and neither doc, nor the
generator, states it.

### O3. Scope of `attempt_number`
Per member across all call types, per call type, or per winback window (1/3/6
months)? Does it reset after a completed conversation or a "come in"? Max
value — the prompts say "If {{attempt_number}} is 2 or 3" (B:126), implying a
cap of 3, but never state one.

### O4. What a no-answer looks like end to end
Which ElevenLabs event marks it (`call_initiation_failure`, a transcript with
zero user turns, a `post_call_transcription` where analysis says
`reached_member=false`)? Does `status` become `failed`, does `outcome` become
`no_answer`, or both? Redial policy after no-answer? Voicemail is explicitly
"Not built" (S:395-396).

### O5. Reengagement cooldown numbers
"Numbers not picked yet." (S:400). The framework has no cooldown at all.

### O6. Staff channel vs AI call precedence
5 `sliding` members are ≥28 days absent. Framework says floor conversation;
Charlie says reengagement call. Do both happen, does one win, does the AI call
wait for the next visit that isn't coming?

### O7. `time_left` format per agent (Charlie-internal bug)
Renewal reads "it ends in {{time_left}}" (B:80-81) → "twelve days". Winback reads
"Their membership expired {{time_left}}" (B:290) but the example value is
"expired three weeks ago" (S:308) → "expired expired three weeks ago". Either
the winback value is "three weeks ago" or the template drops the word. Needs a
per-agent rule.

### O8. Nested `{{time_left}}` inside `expiry_line`
The month-or-less block (B:519-522) embeds a placeholder in a variable's
value. ElevenLabs substitutes dynamic variables into the prompt once; it does
not re-scan values. The compiler must inline `time_left` itself, or the block
must be reworded to "mention once when the membership ends".

### O9. `context` template per call type
Only one `context` example exists (B:474) and it is an absent member's ("not
been in for five weeks"). A renewal member is still training, and a winback
member's membership is not "live until". Three templates are needed; nobody
has written them. (Also the "half-worked call" — S:401-404 — wants call
history in `context`, deferred by Charlie.)

### O10. What the `first_message` override is *for*
Both Charlie docs demand it work (B:45-47, B:612) but never say when the
router would override the first message or with what text, given the default
already uses variables. If there is no use case, it is a one-line flag; if
there is (voicemail? attempt 2 phrasing?), it needs a spec.

### O11. `renewed` vs `link_sent`
"If they both agreed to come in and took a renewal link, use the renewal
outcome." (B:436). Which value is "the renewal outcome" — `renewed` or
`link_sent`? Charlie cannot take payment, so can `renewed` ever be produced on
a call, or is it reserved for a later CRM update?

### O12. Where gym config lives, and multi-gym
JSON file, env, or Supabase table (C15 recommends JSON for now). And whether
members ever get a `gym_id`; the current data and route are single-gym.

### O13. Deployment target and public URL
The post-call webhook (F:185-191), the `send_text` tool endpoint (G8) and any
ElevenLabs-side tool all need a reachable URL. The framework deliberately left
it undone "without the team present"; Charlie assumes it exists. Where this
deploys, and who registers the webhook and secret on three agents, is
unassigned.

### O14. The incentive matrix is incomplete
The brief gives five incentive blocks (B:525-560): two for renewal, two for
reengagement, **one** for winback (PT session *and* cheaper tier). A gym with
only one of those, or with nothing, on the winback track has no block. The
reengagement "perk" is only ever a guest pass. Someone has to define the full
set of gym answers and the block each combination produces, or decide that
the compiler generates the text from a template.

### O15. Whether the data generator changes
G11 says the current seed can't demo renewal or the later winback windows.
Whether to extend `generate_gym_data.py` (new cohorts, wider expiry windows,
an `auto_renew` column), and whether that is allowed to disturb the 90.4%
accuracy result and the answer-key discipline the framework doc is proud of,
is a team decision. I have not touched it.
