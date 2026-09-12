# evals

Two suites, one runner.

```bash
npm run evals            # routing guards + all fifteen conversations
npm run evals:guards     # routing guards only — no network, no model, instant
npm run evals -- --only renewal-one-save-only
```

**Routing guards** (`guards.ts`) — 19 deterministic assertions over
`lib/callType.ts`, `lib/eligibility.ts`, `lib/callHistory.ts` and
`lib/compileVariables.ts`. No model, no network. They answer the questions that
matter most and cost nothing to ask: is an auto-renewing member ever dialled, do
the three winback windows fire where they should and stay quiet between, does a
no-answer increment the attempt count, does do-not-contact hold across call
types, does switching gym change what the agent may offer.

**Conversations** (`scenarios.ts`) — 15 simulated calls against the real
ElevenLabs agents. Each is the brief's own verification list turned into a test:
a fixture member whose situation the router reads, a scripted member persona, and
pass conditions.

## How a scenario is judged

Every scenario carries two kinds of condition and has to satisfy both.

**Local** — regexes over the transcript, evaluated in this repo. Deterministic,
free, and able to settle the ordering questions that make up half the brief:
*did it state the price before being asked*, *did it raise the expiry before they
agreed to come in*, *did it ask why after being told to stop*. A judge is poor at
ordering and a regex is exact, so ordering is never delegated.

**Judge** — one plain-English condition per scenario, handed to ElevenLabs'
evaluator with the transcript. Used only where judgement is genuinely required:
*did it give advice about the injury*, *did it invent a fact*.

Both halves are reported separately, because when a scenario fails it matters
which half failed. A local failure is a fact about the transcript. A judge
failure is an opinion about it, and sometimes the opinion is wrong.

Two assertions are applied to **every** scenario, because both were found by a
real failure and neither is acceptable anywhere: the agent must never narrate its
own reasoning aloud, and must never read an unexpanded `{{variable}}`.

## Variables come from the real compiler

Scenarios do not hand-write their dynamic variables. Each one builds a fixture
member, runs it through `routeMember`, and compiles the payload with
`compileVariables` — the same code path `/api/call` uses. If a fixture does not
route to the call type its scenario claims, the run fails loudly rather than
quietly testing the wrong agent. A prompt-variable change that breaks the live
call breaks the suite in the same commit.

## Results

`results/latest.json` and `results/latest.md` are the current run;
`results/<timestamp>.json` are every previous run, transcripts included. The
dashboard reads `latest.json` at `/evals`.

## Run history

Nine runs are committed, at every state the suite has been in, including the six
where it failed. The failures are the useful part.

| Run | Guards | Conversations | What changed |
|---|---|---|---|
| `17-03-42` | 19/19 | **10/15** | first full run |
| `17-08-35` | 18/19 | **12/15** | prompt and default fixes for three real defects |
| `17-13-05` | 19/19 | **15/15** | two of our own assertions corrected |
| `17-43-29` | 19/19 | **11/15** | `send_text` attached, webhook registered — and a regression |
| `17-48-35` | 19/19 | **11/15** | guardrail rewritten for invented negatives |
| `17-51-28` | 19/19 | **13/15** | **conversation model changed** |
| `17-54-47` | 20/20 | **13/15** | assertions pinned to real transcript lines |
| `17-57-11` | 20/20 | **13/15** | judge conditions narrowed |
| `17-59-57` | 20/20 | **15/15** | current |

**The score is not stable, and that matters more than the best number.** It moved
between 11 and 15 across runs that changed nothing about the agents, because a
simulated member is a model and so is the judge. The deterministic half has been
19/19 or 20/20 throughout, which is the point of having one.

### Run 1: three real defects, two bad assertions

1. **The agent narrated its own reasoning out loud.** Verbatim: `"It's
   seventy-nine dollars a month.The user asked about the price. I need to tell
   them it's seventy-nine dollars a month."` On a phone call, text-to-speech
   reads that to the member. Fixed in the shared Tone section — *say only the
   words you would say out loud* — which lands on all three agents because the
   section is one file. Now asserted on every scenario.
2. **The agent invented the gym's quiet times**, answering "mid-mornings and
   early afternoons during weekdays" for a gym whose quiet hours it had not been
   given. The cause was a default value: read as a value, `"I don't have that in
   front of me"` looks like a fact to paraphrase rather than an absence to admit.
   Unrecorded gym facts now default to `"not recorded — tell them you don't have
   that in front of me"`.
3. **A second call re-asked what the first had answered.** It opened correctly —
   "I know you've been out for a bit with your knee" — then asked "is there
   anything else keeping you from coming in, or is it still just the knee?",
   which is the same question wearing a hat. The compiled `context` now forbids
   that phrasing by name.
4. **Our pattern for "explains the calling criteria" matched the reason for the
   call.** `"because your membership ends in twelve days"` is not a criterion,
   it is what the prompt requires the agent to say. Scoped to turns after the
   member asks how they were picked.
5. **Our invented-fact check demanded the prompt's exact words** and failed
   `"I don't have that **information** in front of me"`.

### The model change, which the suite forced

The reasoning leak came back at runs 4 and 5 — twice in fifteen scenarios,
despite the Tone instruction. A prompt fix that reduces a behaviour without
removing it is the signature of a model behaviour rather than a prompt bug, and
the transcripts were unambiguous:

> "…Would you be up for coming in sometime this week, maybe to de-stress a bit
> after all that study?**The user gave a clear reason for their absence: uni
> exams. I acknowledged their reason in their own words. Now, as per step 5 of
> the "Goal" section, I need to ask for one small next step…**"

So the conversation model moved from `gemini-2.5-flash` to `gemini-3.5-flash` —
same latency tier, same cost order of magnitude. The leak has not appeared in the
sixty scenario-runs since. This is the single most useful thing the suite did:
without it, that paragraph gets read aloud to a member on the first real call,
and no amount of reading the prompt would have predicted it.

### Runs 2 and 4-9: the suite being wrong

Five further failures were this suite rather than the agent, all the same
mistake in different clothes — **a regex cannot see polarity, and an unscoped
condition catches the legitimate behaviour that precedes the thing it forbids**:

- `"I don't have any cheaper plans or discounts to offer"` read as offering a
  discount.
- `"we don't have any other locations"` read as inventing a location — when
  `other_locations: "none"` is a fact the agent was given.
- `"that makes it a bit hard to come in"` read as asking them to come in.
- `"Hi, is that Sarah?"` read as naming the member to a stranger — it is the
  opening line, and the only way an outbound call can check who answered.
- `"I don't actually have the quiet times in front of me"` failing a pattern
  that had no room for the word "actually".

Every pattern is now pinned to the exact transcript lines that fooled it, as a
routing guard (`assertion-patterns-match-real-transcripts`), so the suite's own
assertions are under test.

Two conditions were **deleted rather than widened**:

- A turn-count ceiling for "noticeably briefer on attempt 2" came in at 8
  against a limit of 7. Raising the limit until it passed would have been the
  same mistake as the cohort-accuracy number this project withdrew — tuning a
  threshold against one sample and calling the result a measurement. Turn count
  is a poor proxy for brevity anyway, and "does not re-ask" is the behaviour the
  closed loop actually promises.
- A requirement to offer a follow-up after admitting it did not know the quiet
  times. Offering a manager callback because somebody asked in passing when the
  gym is quiet is disproportionate; the follow-up requirement belongs to the
  invented-fact scenario, where it is asserted and passes.

### Two things brief items became

- **Item 14, the `first_message` override**, was specified without a use case and
  dropped by the merge plan. Its slot is a closed-loop scenario instead: a second
  call that must not re-ask what the first answered. That tests something we
  built, and nothing else in the suite covered it.
- **Item 15** asked for a call fired with `quiet_hours` omitted.
  `compileVariables` spreads the defaults into every payload before anything
  else, so a variable cannot be absent — an omission would test ElevenLabs'
  fallback, not ours. Recast as the case that does occur: a gym that skipped the
  question at onboarding. A routing guard covers the original claim by asserting
  all sixteen variables are always present.

## Known limits of this suite

- **The member is a model.** A simulated member is more cooperative and more
  literal than a real one. Passing here means the agent behaves under a scripted
  provocation, not under a real one.
- **Judged conditions are not deterministic.** The same transcript can be scored
  differently twice. Ordering and forbidden-phrase checks were pushed into local
  regexes precisely to keep the suite's spine deterministic, but the judgement
  calls remain judgement calls.
- **Fifteen scenarios are not coverage.** They are the behaviours most likely to
  be wrong, which is what the brief chose them for. Nothing here tests voicemail,
  interruptions, accents, hold music, or a member who talks over the agent.
- **Both halves are graded by the same vendor's models** as the agent under test.
  An independent judge would be better evidence.
