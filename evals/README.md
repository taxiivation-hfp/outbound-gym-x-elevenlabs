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

Both suites are committed at every state they have been in, including the states
where they failed. The failures are the useful part — a suite that passed
everything on the first attempt would only be evidence that its assertions are
too weak to catch anything.

| Run | Guards | Conversations | |
|---|---|---|---|
| `17-03-42` — first full run | 19/19 | **10/15** | three product bugs, two bad assertions |
| `17-08-35` — after the first round of fixes | 18/19 | **12/15** | one product bug, two bad conditions, one stale guard |
| `17-13-05` — after the second round | 19/19 | **15/15** | current |

### What the first run found, and what it cost to fix

**Three were real defects.**

1. *The agent narrated its own reasoning out loud.* Verbatim from the
   transcript: `"It's seventy-nine dollars a month.The user asked about the price.
   I need to tell them it's seventy-nine dollars a month."` On a phone call that
   is unrecoverable. Fixed in the shared Tone section — *say only the words you
   would say out loud* — which lands on all three agents at once because the
   section is one file. Now asserted on every scenario.
2. *The agent invented the gym's quiet times.* Asked when it was quietest, it
   answered "mid-mornings and early afternoons during weekdays" for a gym whose
   quiet hours it had not been given. The cause was the default value: read as a
   value, `"I don't have that in front of me"` looks like a fact to paraphrase
   rather than an absence to admit. Defaults for unrecorded gym facts now read
   `"not recorded — tell them you don't have that in front of me"`.
3. *A second call re-asked a question the first had answered.* It opened
   correctly — "I know you've been out for a bit with your knee" — and then asked
   "is there anything else keeping you from coming in, or is it still just the
   knee?", which is the same question wearing a hat. The compiled `context` now
   forbids that phrasing by name.

**Two were bad assertions**, and saying so matters as much as the fixes:

4. *The selection-question scenario failed on a false positive.* The pattern for
   "explains the calling criteria" matched `"because your membership ends in
   twelve days"` — which is not a criterion, it is the reason for the call, and
   the prompt requires it. The assertion now looks only at turns after the member
   asks how they were picked.
5. *The invented-fact scenario demanded the prompt's exact words.* The agent said
   "I don't have that **information** in front of me" and was marked down for it.
   The pattern now matches the family of honest non-answers.

### What the second run found

6. *A judge condition was stricter than the brief.* The near-expiry scenario
   required the heads-up to come after the member *named a day*; the brief
   requires it after they *agreed to come in*. The transcript had behaved
   correctly. Condition corrected.
7. *A scenario could not reach its own subject.* In the nothing-to-offer scenario
   the simulated member stopped replying after five turns and the price was never
   raised, so the test proved nothing either way. The persona now raises the
   objection in its first substantive turn.
8. *Brief item 15 tested something the system cannot do.* It asked for a call
   fired with `quiet_hours` omitted. `compileVariables` spreads the defaults into
   every payload before anything else, so a variable cannot be absent — an
   omission tests ElevenLabs' fallback, not ours. Recast as the case that does
   occur: a gym that skipped the question during onboarding. A routing guard
   covers the original claim by asserting all sixteen variables are always
   present.

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
