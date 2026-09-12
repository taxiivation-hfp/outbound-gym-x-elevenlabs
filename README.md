# Retention Router

### An outbound calling voice agent for gyms who knows how to sell, how to offer deals, and how to retain or winback members.

**Orlando · Dan · Oliver · Jesslyn**

**Track 1 — Improve an Existing Business Capability**, entered alongside the **ElevenLabs Special Track**

🔴 **Live app:** `[add production URL]` · 🎥 **Demo video:** `[add link]` · 📊 [Eval results](/evals) · 📈 [Churn intelligence](/intelligence)

---

Every retention product on the market predicts who is about to leave. This one also predicts who you'd **lose by contacting**, and leaves them alone. That second half isn't a feature bolted on afterward — it's the reason the product exists.

![Architecture](docs/architecture.svg)

## For judges: where each score comes from

This README doubles as our evidence file. If you're scoring a specific line, this is where to look.

| Scoring... | Look here |
|---|---|
| Problem Significance (8) | [The customer](#the-customer) |
| Originality of Idea (10) | [Who else does this, and why we're different](#who-else-does-this-and-why-were-different) |
| Differentiation (7) | [Who else does this, and why we're different](#who-else-does-this-and-why-were-different) |
| Creativity in Solution Design (8) | [What it does](#what-it-does) · [Decisions, and why](#decisions-and-why) |
| Impact & Value Proposition (9) | [Cost and value](#cost-and-value) |
| Feasibility & Viability (8) | [What a real deployment actually needs](#what-a-real-deployment-actually-needs) |
| Functionality & Execution (10) | [Running it](#running-it) · [Architecture](#architecture) |
| Technical Difficulty (8) | [Evaluation](#evaluation) · [Decisions → Model and audio choices](#decisions-and-why) |
| Code Quality & Architecture (6) | [Decisions, and why](#decisions-and-why) · [Repo map](#repo-map) |
| Use of Data / Models (6) | [Decisirons → Model and audio choices](#decisions-and-why) · [The withdrawn accuracy number](#the-withdrawn-accuracy-number) |

## The customer

**An owner-operator with two sites and about 1,200 members.** Southbank and one other suburb. The front desk is one person on a shift. There's no retention team, no marketing hire, and no CRM beyond whatever the gym-management platform ships with. They know roughly who's stopped coming — they can see it — and they do nothing about it. Not from apathy: ringing 60 people is a day nobody has, and nobody at the desk wants to be the one who rings a member who says "actually, cancel me."

That fear is well founded, and it's what this product is built around.

### The two halves of the problem

**Half one: the calls worth making.** A fixed-term membership doesn't renew itself. The member who's still training, whose term lapses in twelve days, will simply stop having a gym and won't notice for a month. Nobody tells them. That's the cheapest retention call in the business, and almost nobody makes it.

**Half two: the calls that cost money.** A member on a rolling month-to-month contract who hasn't been in for six months is the most profitable member the gym has — full price, zero cost to serve. A churn model flags them hardest of anyone. Calling them is how they remember to cancel. Uplift research calls these *sleeping dogs*: the correct action is nothing at all.

So the router's first rule isn't about churn risk. It's:

> **`auto_renew == true` → never called. At any point in their term, however absent they are.**

In this dataset that's 148 of 500 members, and **72 of them have a renewal date inside the next fortnight** — a date-triggered dialer would ring all 72, and some would cancel on the call. Refusing those 72 calls is the product.

## Who else does this, and why we're different

Two kinds of product already exist in this space, and neither does what the exclusion rule does.

**Predictors** — Keepme Score, PredictStay, and Glofox's built-in "At Risk" report — score every member's churn probability from attendance and payment data. They tell a gym who's likely to leave. None of them ask whether contacting that member is the right move, because the question they're built to answer is "who's at risk," not "who's worth ringing."

**Executors** — Replify runs outbound retention calls, Keepme's Antares runs text, chat and email follow-up. Both carry out outreach to whoever the predictor (or the sales funnel) flags. Neither has a reason to say no to a call.

Point either category at this dataset and both would ring all 148 auto-renewing members, hardest at the 72 who are two weeks from a renewal date — because a high churn score plus an imminent renewal date is exactly what a predictor is built to flag as urgent. That's the call that costs the gym a paying member.

The second difference is what gets handed back. A churn score is a number a front-desk manager can't argue with. This router hands back a sentence — *"never a regular, a quiet month isn't a signal"* — that they can. An exclusion nobody can audit is a black box wearing a decision; a sentence is a claim the gym owner can check against what they actually know about that member.

## What it does

Three call types, three agents, one shared set of guardrails.

| | Member state | Trigger | The job |
|---|---|---|---|
| **Renewal** | Training, fixed term lapsing | 14 days before expiry | Make sure they know it won't renew itself. Make renewing easy. |
| **Reengagement** | Membership live, stopped coming | 28 days absent, or absent with the term nearly up | Get them back in the door once. Don't sell. |
| **Winback** | Already lapsed | ~1, ~3 and ~6 months after expiry | Find out why they stopped. |

On top of those triggers sits an eligibility gate that reads call history: do-not-contact is permanent and holds across all three call types, a member gets at most three conversations, and after a conversation that changed nothing the member is left alone for three months — unless the call actually got them in, in which case the normal trigger resumes immediately.

Every decision, including every refusal, comes back as a sentence a front-desk manager can read:

> *Away 10 weeks and the term ends in 13 days. Get them back in first; the renewal is a heads-up, not a pitch.*

> *Auto-renewing membership. The call is the only thing that could end it, so they are never called — however long they have been away.*

> *Away 5 weeks, but never a regular (0.3 visits a week historically). A quiet month is not a signal for someone who was always occasional.*

## Cost and value

Shown on the dashboard with every assumption on screen next to the number it produces.

| | |
|---|---|
| Cost per call | **$0.41** — $0.10/min ElevenLabs + $0.055/min Twilio to an Australian mobile, 2.5 minutes, plus an SMS on about a third of calls |
| Today's queue | 173 calls, **$70** all in |
| A saved member | **$473** — their own monthly fee across six more months, deliberately one renewal cycle rather than an indefinite life |
| **Break-even** | **0.09% conversion. One save in roughly 1,200 calls pays for the run.** |

The break-even is the figure worth arguing about, because it takes **no guess about how often a call works**. Conversion rate is the one thing this build can't know — no call has been placed to a real member — so it isn't assumed anywhere. Everything above is arithmetic on the queue and on published per-minute rates.

The other output is the one nobody else has. Every retention product records *that* a member churned. This records **why**, in the words they used — `reason_for_absence` and `reason_detail` on every conversation, broken down by cohort, call type and tenure band at `/intelligence`. A gym that's never had that can act on it in a week: if the reason is the six o'clock crowd, that's a rota change, not a discount.

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev                    # http://localhost:3000
```

```bash
npm run agents:sync            # create/update the three ElevenLabs agents
npm run agents:diff            # what a sync would change, without doing it
npm run evals                  # routing guards + 15 simulated calls
npm run evals:guards           # just the deterministic half: no model, no network
npm run data:build             # regenerate the synthetic dataset
```

`.env.example` documents every variable. Two matter more than the rest:

- **`CALL_OVERRIDE_NUMBER`** — routes every call and text to one verified number. The 500 member phone numbers are synthetic and belong to nobody. Leave this set for any demo.
- **`DATASET_CLOCK`** — set it to `live` to measure time against the wall clock instead of the dataset's frozen reference date. Only correct against a real gym feed; see the note on the frozen clock below.

Before the first call works end to end, three things have to be done by hand and are listed with exact steps in [`REVIEW_NOTES.md`](REVIEW_NOTES.md): apply the `call_records` migration, deploy, and register the post-call webhook.

## Architecture

**Offline, Python (`pipeline/`).** Generates a synthetic gym — members, contracts, check-ins — then computes features and sorts every member into one of five cohorts with readable rules. It emits **raw facts only**: ISO dates, booleans, counts, rates.

**At call time, TypeScript (`lib/`).** `callType.ts` decides which agent a member is due for. `eligibility.ts` adds what only the database knows. `compileVariables.ts` turns raw facts into the plain-English strings the agent reads aloud. `economics.ts` prices the whole thing.

**The agents (`agents/prompts/`, `scripts/`).** Three ElevenLabs agents whose prompts, model settings, eleven data-collection fields and three evaluation criteria all live in this repo and are pushed by `scripts/sync-agents.mjs`. Anything edited in the ElevenLabs dashboard is overwritten on the next sync, on purpose.

**Back again (`app/api/webhook`).** The post-call webhook verifies an HMAC signature, writes eleven typed fields plus the three criteria results plus the raw analysis object, and marks a dial that never connected as failed rather than leaving it "initiated" forever.

**The dashboard (`app/`).** Next.js on Vercel. Server components call the same `lib/` functions the API routes call, so the screen and the endpoint can't disagree about who's due a call.

## Decisions, and why

### Three narrow agents, not one with a `call_type` branch

A single prompt carrying `if renewal … if winback …` hands the model three scripts and one call, and it drifts: a winback conversation slides into renewal language the moment the member mentions money, because the renewal branch is sitting right there in its context. Three narrow prompts can't drift into each other.

The cost is that four sections — Personality, Tone, Guardrails, Tools — appear three times. We pay for it by storing each one **once** in `agents/prompts/shared/` and assembling the prompts at sync time. Byte-identity across the three agents is therefore a property of the build rather than a discipline someone has to remember when they fix a guardrail at 2am, and the sync script fails loudly if a per-agent copy of a shared section ever appears.

### Prompt variables are compiled plain English, not conditionals in the prompt

Every gym-specific rule reaches the call as a finished sentence. `expiry_line` either tells the agent to raise the expiry or forbids it. `incentives` either hands it a discount, with instructions on how to deliver it, or closes the door on everything. The prompt itself contains no `if`.

That's what lets one prompt per call type serve every gym. Southbank has a 20% renewal discount, a guest pass, a free PT session, two sister sites and online training; Kensington Barbell has one room and nothing to offer. Switching between them on the dashboard changes what the agent may put on the table without touching a prompt — and the hardest guardrail in the system is the one Kensington exercises: *if the incentives section says you have nothing, you have nothing.*

Every incentives block ends with a sentence that closes the door. That closing sentence is the important half; without it the agent fills the gap with something the gym never agreed to.

### Variables compile at call time, not in the pipeline

Three of them can't be computed offline. `time_left` depends on the date. `attempt_number` depends on Supabase. `context` has to fold in what a previous call already extracted, so the agent doesn't ask a question it already has the answer to. The pipeline emits facts; `lib/compileVariables.ts` turns them into speech, once, in one file. A prompt-variable rename touches one place.

### The router is rule-based and interpretable, not a churn model

This is a deliberate trade against raw accuracy. A front-desk manager has to be able to see **why** a member was called, and to disagree — "she's on holiday, skip her." A propensity score can't be argued with, and an outbound call justified by a number nobody can read is a call the gym will eventually stop trusting. Every branch in `callType.ts` returns the sentence that explains it, including the branches that decide *not* to call.

It also makes the exclusions auditable, which matters more than the inclusions. "We didn't call these 148 people, and here's the rule" is a claim a gym owner can check.

### Auto-renewing members are never called

Covered above, and it's checked before any other branch so nothing downstream can undo it, enforced server-side in `/api/call` so a hand-rolled POST gets a 403, and asserted by two of the nineteen routing guards.

### Model and audio choices

| | Choice | Why |
|---|---|---|
| Conversation LLM | `gemini-3.5-flash`, temperature 0.3 | Latency is the whole game: on a phone call every 100ms of thinking time is dead air a stranger is listening to, and the prompts do no reasoning — they're a script with guardrails — so a larger model buys delay and cost and nothing else. That argued for the fastest model, and the first choice was `gemini-2.5-flash`. **The eval suite rejected it:** on roughly one call in eight it appended its own chain of thought to the spoken turn, which text-to-speech then reads aloud. A prompt instruction not to narrate reduced it and didn't remove it — the signature of a model behaviour rather than a prompt bug — so the model changed instead, at the same latency tier and cost order. Temperature 0.3 rather than 0 so the same objection doesn't produce the same sentence every time; much above 0.5 and the model starts paraphrasing the guardrails, which is the one thing that must not vary. |
| Speech | `eleven_flash_v2` | The fastest voice model. The brief asked for Flash v2.5; ElevenLabs rejects it for an English-language agent ("English Agents must use turbo or flash v2"), so this is the English build of the same family and latency class. |
| Voice | "Charlie", Australian male | He calls Australian gyms and introduces himself by that name. An American voice saying "Charlie from Southbank Strength" is the first thing a member would distrust. |
| Audio format | mu-law 8000Hz, both directions | What a telephone actually carries. Sending 16kHz PCM means synthesising detail Twilio then throws away, and paying a resample each way for nothing. |
| Max duration | 4 minutes | The prompts target under three. This is the backstop for the call that won't end, and it caps worst-case cost per dial. |
| Analysis | ElevenLabs' own extraction and criteria | Eleven fields and three always-on judges run on every call, including real ones. The controlled measurement lives in `evals/`; this is the field. |

### One phone number for every call

`CALL_OVERRIDE_NUMBER` routes every outbound call and text to a single verified handset. The alternative was normalising 500 Faker-generated Australian numbers in six different formats into E.164 — which would have produced valid-looking numbers belonging to strangers. Documented rather than hidden: the routing decision is unchanged, only the last hop.

## Evaluation

Two suites, one runner, both committed: [`evals/`](evals/README.md), rendered at `/evals` in the app.

**19 routing guards.** Deterministic assertions over the router, the eligibility gate, call-history summarising and the variable compiler. No model, no network, milliseconds. They cover the auto-renew rule, the three winback windows *and the silence between them*, do-not-contact holding across call types, a no-answer not counting as a conversation, and the gym switch changing what the agent may offer.

**15 simulated conversations** against the real agents, via ElevenLabs' agent-testing API. Each is one of the brief's verification behaviours, with local regex conditions checked in this repo **and** one plain-English condition handed to a judge model. Both halves must pass. Ordering questions — *did it state the price before being asked*, *did it raise the expiry before they agreed to come in* — are never delegated to the judge, because a regex settles them exactly and for free.

Scenarios build their variables with `compileVariables`, the same compiler the live route uses, and fail loudly if a fixture doesn't route to the call type it claims. The suite can't drift away from the live path.

### The numbers, and the runs that failed

Nine runs, all committed with transcripts. Latest: **20/20 guards, 15/15 conversations.**

```
10/15 -> 12/15 -> 15/15 -> 11/15 -> 11/15 -> 13/15 -> 13/15 -> 13/15 -> 15/15
```

**The conversation score isn't stable, and saying so is more useful than quoting the best number.** It moved between 11 and 15 across runs that changed nothing about the agents, because the simulated member is a model and so is the judge. The deterministic half sat at 19/19 or 20/20 throughout, which is precisely why it exists: the spine of the measurement doesn't wobble.

The most valuable thing the suite did was force a model change. `gemini-2.5-flash` appended its own reasoning to the spoken turn on about one call in eight —

> "...maybe to de-stress a bit after all that study? **The user gave a clear reason for their absence: uni exams... as per step 5 of the "Goal" section, I need to ask for one small next step...**"

— which the voice model then reads out loud. Nothing about reading the prompt would have predicted that, and it would have happened on the first real call.

The first run found three real defects and two bad assertions of ours:

1. The agent **narrated its own reasoning out loud**. Verbatim: *"It's seventy-nine dollars a month. The user asked about the price. I need to tell them it's seventy-nine dollars a month."* On a phone call that's unrecoverable. Fixed in the shared Tone section, which reached all three agents at once, and now asserted on every scenario.
2. It **invented a gym's quiet times** — "mid-mornings and early afternoons" for a gym whose quiet hours it had never been given. The cause was a default value: read as a value, `"I don't have that in front of me"` looks like a fact to paraphrase rather than an absence to admit.
3. A second call **re-asked what the first had already answered**, as *"is there anything else keeping you from coming in, or is it still just the knee?"* — the same question wearing a hat.
4. Our own "explains the calling criteria" pattern matched *"because your membership ends in twelve days"*, which isn't a criterion — it's the reason for the call.
5. Our invented-fact check demanded the prompt's exact words and failed *"I don't have that **information** in front of me."*

Five more failures across the later runs were also the suite rather than the agent, and every one was the same mistake in different clothes: **a regex can't see polarity, and an unscoped condition catches the legitimate behaviour that precedes the thing it forbids.** `"I don't have any cheaper plans to offer"` read as offering one. `"Hi, is that Sarah?"` read as naming a member to a stranger, when it's the only way an outbound call can check who answered. Every pattern that fooled us is now pinned to the transcript line that did it, as its own routing guard — the suite's own assertions are under test too. Two conditions were deleted rather than widened, including a turn-count ceiling that came in at 8 against a limit of 7, because raising it until it passed would have been the same mistake as the accuracy number below.

A suite that passed everything first time would only be evidence that its assertions are too weak to catch anything. The full account, including what this suite **can't** tell you, is in [`evals/README.md`](evals/README.md).

## The withdrawn accuracy number

An earlier version of this repo reported **90.4% cohort accuracy** against the generator's answer key. That number has been removed and shouldn't be quoted: the answer key is produced by the same rules the router applies, so the comparison is circular — it measures whether two copies of one ruleset agree, and tuning thresholds against it was fitting one random seed's noise. The router's honest status is *validated in structure, not in accuracy*.

## LIMITATIONS

Written to be read by someone looking for the holes.

### The data is synthetic, and that limits what we can claim

- **500 generated members, seed 42.** No real gym's data has touched this. The router is validated in structure — every branch fires, every window has a population, the exclusions hold — and **not** in accuracy. We can't tell you what share of the members it calls would have actually churned.
- **The dataset is built to exercise the product.** Guaranteed sub-slices put 40 members inside the renewal window and 30 in each winback window, because otherwise two of the three call types couldn't be demonstrated at all. A real gym's distribution would look nothing like this, and the 30% auto-renew share is a modelling choice, not a finding.
- **The clock is frozen at 2026-09-12.** Every date in the dataset is relative to that instant, and the app reads it back from `data/dataset_meta.json` rather than the wall clock — otherwise a member twelve days from expiry quietly lapses a fortnight later and the renewal queue empties out. The app's "today" is the dataset's. Re-run `npm run data:build` to move it, or set `DATASET_CLOCK=live` against a real feed.
- **Phone numbers are Faker output** in six inconsistent formats and belong to nobody. Every call and text goes to one verified number via `CALL_OVERRIDE_NUMBER`.

### What is not built

- **No gym-management integration.** The pipeline reads CSVs shaped like a real export, but nothing talks to a real platform. See below for what that needs.
- **No voicemail detection or message.** A call that reaches an answering machine is recorded as a completed call with `reached_member = false` and nothing else happens. The ElevenLabs voicemail tool isn't configured.
- **No scheduler.** The triggers are dated but a human presses "Call now." That keeps a person in the loop, which is right for a demo and arguably right for a first deployment, but it isn't automation.
- **No live push to the browser.** A call sitting at "initiated" doesn't flip to "completed" on its own; there's a refresh button. Real-time subscriptions were deferred rather than half-built.
- **Nothing handles the member who came in once after a call and then stopped again.** `context` carries prior-call history, which is most of what that needs, but the reengagement prompt has no line for it.
- **One tenant.** Members have no `gym_id`; the two gyms in `data/gyms.json` are a config switch, not multi-tenancy.

### Known rough edges

- **Simulated members are more cooperative and more literal than real ones.** Passing the eval suite means the agent behaves under a scripted provocation, not under a real one.
- **Judged eval conditions aren't deterministic.** The conversation score moved between 11 and 15 out of 15 across runs that changed nothing about the agents. Ordering and forbidden-phrase checks were pushed into local regexes precisely to keep the suite's spine deterministic, but the judgement calls remain judgement calls, graded by the same vendor's models as the agent under test. Treat 15/15 as the best observed run, not a property of the system.
- **The reasoning leak is fixed by a model choice, not a proof.** It hasn't appeared in the sixty scenario-runs since the switch, which is evidence and not a guarantee. It's asserted on every scenario, so a regression fails the suite instead of surprising someone mid-call.
- **`twilio_call.py` has a live Account SID and auth token committed in plaintext**, already in git history. Flagged in [`REVIEW_NOTES.md`](REVIEW_NOTES.md) as a rotate-immediately item. Rotating it is a Twilio-console action.
- **The `sleeping_dog` cohort's `action` and `contact` fields are stale descriptive text.** They say "do not contact," which was keyed on dormancy; the exclusion is now keyed on contract type. The dashboard renders the derived routing instead, so nothing reads them, but they're wrong where they sit.

### What a real deployment actually needs

**Data access.** Three tables, which every major platform exports:

| We need | Glofox | Mindbody | PushPress |
|---|---|---|---|
| Members: id, name, mobile, join date | Members export / API `/members` | Clients (`ClientID`, `MobilePhone`, `CreationDate`) | Members API |
| Contracts: type, term dates, price, **whether it auto-renews** | Memberships | Contracts / ClientContracts (`AutoPayEnabled`) | Plans / Subscriptions |
| Check-ins: member id, timestamp | Bookings / check-ins | Visits (`ClientID`, `StartDateTime`) | Check-ins |

The one field that decides everything is whether a contract rolls over. Mindbody exposes it directly; Glofox and PushPress require inferring it from the plan type, and getting that inference wrong is exactly the failure mode this product exists to avoid. It's the first thing to verify per platform, not the last.

**Consent and telemarketing obligations (Australia).** Non-trivial and not addressed in this build:

- The Spam Act 2003 covers SMS. Every message needs consent (existing paying members are usually inferred consent for related communications, but a lapsed member is a harder argument) and a functional unsubscribe. The links this sends have none.
- The Do Not Call Register Act 2006 covers voice. Existing-customer relationships carry exemptions, but a member who lapsed six months ago is arguably no longer a customer, and the 6-month winback window sits right on that line. Production needs DNCR washing before dialling, not just our own do-not-contact list.
- Calling hours are restricted (broadly 9am–8pm weekdays, 9am–5pm Saturdays, never Sundays or public holidays). The scheduler that doesn't exist yet is where that belongs.
- Privacy Act / APPs: members must be told their calls are recorded and transcribed, and recording requires care under state legislation. Retention is currently unlimited (`retention_days: -1`).
- The agent discloses that it's an AI the moment it's asked, and is asserted on doing so. It doesn't disclose unprompted, which is a defensible reading of current Australian law and may not survive it.

**Cost at volume.** $0.41 a call is the marginal number and it holds: 1,200 members with roughly a third due a call in any month is ~400 calls, about $165 a month in usage. ElevenLabs' plan tiers and concurrency limits, not per-minute cost, are what bite first — the workspace here is capped at a concurrency of one by default, so 400 calls is a queue, not a burst. Twilio's Australian mobile termination rate is the single largest line item and worth renegotiating before anything else.

## Repo map

```
pipeline/        synthetic data generator + the cohort router (Python)
lib/             routing, eligibility, the variable compiler, economics
agents/prompts/  the three system prompts; shared sections stored once
scripts/         sync-agents.mjs pushes agent config; agentConfig.mjs is its source of truth
evals/           19 routing guards, 15 simulated calls, every run committed
app/             dashboard, intelligence, evals page, API routes, texted-link landings
supabase/        migrations for call_records
docs/            architecture diagram
```

Further reading: [`evals/README.md`](evals/README.md) for how evaluation works and what it misses; [`FEATURES_AND_DECISIONS.md`](FEATURES_AND_DECISIONS.md) for the build log; [`REVIEW_NOTES.md`](REVIEW_NOTES.md) for what still needs a human.