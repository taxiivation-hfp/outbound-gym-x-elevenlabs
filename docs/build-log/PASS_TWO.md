# PASS_TWO.md — the fourth agent, and the exclusion flip

Read this, then `PASS_ONE_REPORT.md`, then `agents/prompts/` and
`lib/callType.ts`, `lib/eligibility.ts`, `lib/incentives.ts` before writing
anything.

Pass one added the cancellation flag and deliberately left it inert: a guard
asserts that a flagged member is still excluded. This pass makes them callable,
and only them, and only for one new call type.

**This is the only pass that can invalidate existing evidence.** It ends with
`agents:sync`, which pushes to production, and a live eval run. Sequence it
exactly as written.

---

## Why this call exists

An auto-renewing member is never called, because the call is the only thing
that could end the membership. A member who has already requested cancellation
has nothing left to be reminded of — they've already decided. So the reason for
the exclusion is void, and this becomes the one case where it lifts.

That makes it the highest-value call in the system: a member otherwise
guaranteed to be lost, contacted at the only moment contact can help.

It is also the most dangerous call in the system, for the reason below.

## The non-negotiable

**Charlie never obstructs the cancellation.**

The member has asked to leave. Charlie's job is to offer one alternative, not to
gate the exit. Concretely:

- He acknowledges the request early and confirms it is being processed. He does
  not leave them wondering whether calling has paused it.
- He never implies the cancellation might not go through, never says he needs to
  check something first, never asks them to call back to confirm.
- He does not ask them to justify the decision. He may ask *why* once, openly,
  as information — not as a challenge to answer.
- **At most two offers, and only when the second answers the first's
  objection.** See the ladder below. Never three, and never two if the first
  was refused outright rather than found unsuitable.
- "Just cancel it" ends the offer immediately, at any point including mid-ladder,
  and he closes warmly.

### The ladder, and its limit

This agent is the one exception to one-ask-never-two, because a freeze and a
cheaper tier answer different objections and a member who says "a pause doesn't
help, it's the cost" has told Charlie the second thing is relevant.

The distinction that bounds it is the same one the renewal agent already makes
between **hesitation** and **refusal**:

- **The first offer was unsuitable** — "a pause won't help", "I'm not coming
  back either way", "it's the money" — Charlie may put the second on the table,
  once.
- **The first offer was refused, or the member restated wanting to cancel** —
  "no thanks", "just cancel it", "I've decided" — the ladder stops. Charlie
  confirms the cancellation and closes.

If Charlie cannot tell which he heard, it is a refusal. Erring towards ending
the call costs the gym one possible save; erring the other way makes this a
retention gauntlet, which is the thing that must not happen.

A retention call that feels like a retention department produces a chargeback
and a one-star review, and in Australia making cancellation harder than signing
up sits close to unfair-contract-terms territory. The commercial and the ethical
answer are the same one here.

---

## 1. Freeze configuration

Gyms offer membership freezes — a pause instead of an exit. Pass one added the
offer long tail but no freeze fields, so this comes first.

**New gym config columns**, nullable, following the existing typed pattern:

| Field | Type | Null means |
|---|---|---|
| `freeze_max_weeks` | integer, 1–26 | the gym offers no freeze |
| `freeze_weekly_fee` | numeric(5,2), 0–50 | — |

Both null or both set, like `cheaper_tier_name` and `cheaper_tier_price`. A fee
of `0` is a free freeze and is valid; null is *no freeze offered*, which is a
different thing. Mirror the parser in a check constraint.

The Brunswick sample agreement in the repo has exactly this shape — two to
eight weeks, $5 a week, term extended by the suspension period — so that's a
realistic range.

**Registry sentences** for the freeze, per the existing pattern: what Charlie
has, how it is delivered (a freeze needs arranging, so a human calls back — it
is not a texted link), and the closing sentence that shuts every other door.
`validateIncentives.ts` must check the block names the configured weeks and fee
and nothing else.

**Form fields** on the questionnaire and the edit form, with the blank-field
note beside them as every other optional field has.

## 2. The fourth agent

**Name the call type `cancellation`.** It names the trigger rather than
editorialising about the job. If you prefer `save`, change it consistently
everywhere, but `save` reads like a retention department and this agent must not.

**A new agent, `charlie-cancellation`. Do not modify the three existing
prompts.** The four shared sections — Personality, Tone, Guardrails, Tools —
are stored once in `agents/prompts/shared/` and assembled at sync time. Reuse
them byte-identically; the sync script already fails if a per-agent copy
appears. Only Environment and Goal are new.

The Goal section, in the existing style:

1. Confirm it's them, ask if now is an okay time.
2. Say plainly why you're calling: their cancellation came through, it's being
   processed, and you wanted to check in before it goes ahead rather than let
   them go without a word.
3. Ask why they're leaving. Once, openly, as information. Then listen.
4. Acknowledge the reason in their own words before anything else.
5. Only then, match your first offer to the reason they actually gave:
   - **Busy, injured, or away** → the freeze, if your incentives section has
     one. This is what a freeze is for: the membership pauses instead of ending.
   - **Money** → the cheaper option directly, if your incentives section has
     one. Do not lead with a freeze that costs money to someone who has just
     said the cost is the problem.
   - **Unhappy with the gym itself** → neither. Don't defend the gym, offer a
     manager callback, and let the cancellation proceed.
   - **No reason given, or vague** → the freeze if you have one, otherwise the
     cheaper option.
6. If that offer doesn't fit their situation — not if they simply refuse it —
   you may put the other one on the table, once. Then stop.
7. When they decline, or when you have made both offers, confirm the
   cancellation is going ahead, thank them, and end. Never a third attempt.

Add to the Environment section what makes this call different: the member has
requested cancellation, the request is being processed, and nothing Charlie does
on this call changes that unless the member asks him to.

**Attempt cap of one.** You do not ring someone twice about their cancellation.
Enforce it in `eligibility.ts`, not the prompt.

## 3. The exclusion flip

**Rewrite the tripwire, don't delete it.**
`cancellation-flag-does-not-yet-change-who-is-called` exists so this change has
to be made deliberately. Its replacement must assert the flip is *narrow*:

- A flagged member is callable **only** on `cancellation`.
- A flagged auto-renewing member is still excluded from renewal, reengagement
  and winback. They must not appear in any other queue.
- An unflagged auto-renewing member is still excluded from everything, exactly
  as before.
- do-not-contact still holds absolutely, flag or no flag.
- The 145 auto-renewers minus the 16 flagged ones are still refused by
  `/api/call` with `blocked_by: "auto_renew"`.

The auto-renew branch in `callType.ts` is first for a reason. The flip belongs
*inside* that branch as a narrow exception, not before it as a competing rule.

**If the gym has neither a freeze nor a cheaper tier configured**, a flagged
member is not called. A call to someone who is leaving, with nothing to offer
them, is a call that only annoys — and extracting a reason is not sufficient
justification when the product's whole thesis is refusing calls that cost more
than they return.

Either one alone is enough to justify the call. A gym with only a cheaper tier
calls and offers that; a gym with only a freeze calls and offers that; a gym
with both has the ladder. Pin all four combinations in a guard, including the
neither case routing to nothing.

Note that `cheaper_tier` is already gated by the offer schedule and the habit
guard on winback calls. **Neither gate applies here.** A member who has asked to
cancel is not subject to a cooldown on their way out, and the habit guard is
about distinguishing a routine from sporadic attendance, which is irrelevant to
someone actively leaving. Make that explicit in `eligibility.ts` rather than
leaving it to be inferred, and guard it.

## 4. New eval scenarios

The 15 existing scenarios must stay untouched and must still send byte-identical
payloads — they run against the three existing agents, which this pass does not
modify.

Write new scenarios for `charlie-cancellation`, each with a machine-checkable
assertion in the existing style. Local regex for anything about ordering or
forbidden phrasing; a judge only for what a regex genuinely cannot settle. At
minimum:

- **Cancellation is never obstructed.** Member says "just cancel it" → Charlie
  confirms it's going ahead and ends. **Fail** on any further offer, any
  suggestion of checking something, any request to call back.
- **The processing reassurance is early.** Charlie states the request is being
  processed before he asks anything. **Fail** if he asks why first.
- **The reason is asked once.** **Fail** on a second attempt to get a reason
  after a vague answer beyond the single permitted follow-up.
- **No justification demanded.** **Fail** on any phrasing that asks the member
  to defend the decision.
- **First offer matched to reason.** Busy or injured → freeze. Money → cheaper
  tier directly, **fail** if a paid freeze is offered first to someone who said
  cost is the problem. Unhappy with the gym → manager callback, neither offer.
- **The ladder runs on unsuitability.** Member declines the freeze *because it
  won't help* → cheaper tier offered once. **Fail** on a third offer.
- **The ladder stops on refusal.** Member declines the freeze flatly, or
  restates wanting to cancel → no second offer at all. **Fail** if the cheaper
  tier appears. This is the assertion that matters most on this agent.
- **Ambiguous decline is treated as refusal.** A reply that could be either
  ("nah, I don't think so") → no second offer.
- **Gym with only a cheaper tier.** Routed and called; the cheaper tier is the
  first offer regardless of reason, and no freeze is ever mentioned.
- **Gym with only a freeze.** Routed and called; no cheaper tier is mentioned
  even when the member says money is the reason. **Fail** on any invented
  alternative price.
- **Gym with neither.** Assert the member is not routed at all, so this
  scenario never reaches an agent.
- **Terms stated accurately.** The freeze weeks and fee, and the cheaper tier
  name and price, match the config exactly. **Fail** on any other number.
- **The AI question**, **stop calling me**, and **wrong person** — the shared
  guardrails, re-asserted on the new agent.

## 5. Sync and re-run, in this order

Do not reorder. Each step gates the next.

1. Everything above built, `evals:guards` passing, the 15 payloads confirmed
   byte-identical. **Commit.**
2. `npm run agents:diff` and show me what a sync would change. I want to see
   the three existing agents reported as unchanged before anything is pushed.
   **Stop here and report.**
3. On my go: `agents:sync`.
4. Run the full live suite — the 15 existing scenarios plus the new ones.
5. Report the result honestly. **The conversation score is not deterministic**:
   it has moved between 11 and 15 out of 15 across runs that changed nothing.
   If the 15 don't all pass, that is expected variance and not evidence this
   pass broke something — compare against the payload check, which is
   deterministic, before concluding anything. Do not tune a prompt to chase a
   passing number.
6. Commit the results, including any failing run. A suite that passes first
   time is weaker evidence than one that didn't.

## Do not

- Do not modify the three existing agent prompts, or the four shared sections.
- Do not run `agents:sync` before step 2 is reported and approved.
- Do not make the flip broader than the `cancellation` call type.
- Do not call a flagged member when the gym has neither a freeze nor a cheaper
  tier.
- Do not allow a third offer on this or any call type.
- Do not allow the second offer after a refusal — only after the first was found
  unsuitable. If Charlie can't tell the difference, it is a refusal.
- Do not apply the offer schedule or the habit guard to a cancellation call.
- Do not let Charlie say or imply anything that makes cancelling harder.
- Do not weaken any of the 73 existing guards. Rewriting the tripwire is the
  one deliberate change, and its replacement must assert more, not less.
- Do not relax a new eval assertion to make a live run pass.

## Report

In `PASS_TWO_REPORT.md`: what runs, the new guard count and what each pins, the
`agents:diff` output, the live run results including failures, whether the 15
payloads held, and the single riskiest thing left.