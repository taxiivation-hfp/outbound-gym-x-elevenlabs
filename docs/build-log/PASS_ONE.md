# PASS_ONE.md — business-side features, data and logic only

Read this, then `ONBOARDING_REPORT.md` for current state, then `lib/gymConfig.ts`,
`lib/incentives.ts` and `pipeline/generate_gym_data.py` before writing anything.

A judge told us the technical build is complex enough, and that what's thin is
the business side: what this gives a gym beyond the retention calls themselves.
This pass builds that. Retention calling stays the product; this is what the
data we already collect is worth.

## Scope discipline

**This pass must not touch the three existing agent prompts.** All 15
conversation scenarios must still send byte-identical payloads to the committed
15/15 run. That evidence is load-bearing and a prompt change invalidates it.
Anything requiring a prompt change belongs to pass two.

**UI here is deliberately placeholder.** A full UX rehaul is pass three, working
from HTML mockups being drafted in parallel. Build the screens plainly —
correct data, readable layout, no design investment. Say so in a comment at the
top of each new component so pass three knows to replace it wholesale. Do not
spend effort on visual polish that is about to be thrown away.

**No external benchmark figures.** Trends are the gym's own, over time. Do not
cite industry averages anywhere in the product.

**Load time is the priority.** No LLM call on any page render. Anything needing
a model runs in the nightly recompute and is served from the database.

---

## 1. Health of the gym

Merge into the existing `/intelligence` page rather than adding a screen. The
churn-reasons breakdown already there is the centrepiece; this surrounds it with
the numbers an operator actually runs their week on.

Everything below is computable from data already in the pipeline. If something
isn't, leave it out and say so in the report — do not invent an input.

**Membership and money**
- Active members, and members expiring in the next 14 / 30 / 90 days
- Monthly churn rate: members lost in the period ÷ members at the start
- Retention rate over time, the gym's own trend
- 90-day retention: share of joiners still paying 90 days after their first
  paid month. Strongest available predictor of long-term value, and you have
  join dates and contract status, so it's free
- MRR from `monthly_fee` across active members
- ARPM: monthly revenue ÷ active members
- Revenue at risk: `monthly_fee` summed across members in each call queue

**Engagement**
- Attendance per member per week, trended
- Visit-frequency segments — frequent, occasional, inactive — with counts, using
  the same thresholds the router uses so the screen and the queue can't disagree
- Time-of-day busyness from check-in timestamps. A gym that learns its 6pm is
  the problem can change a rota, which is a cheaper fix than a discount

**Why members leave**
- The existing `reason_for_absence` enum breakdown, by cohort, call type and
  tenure band. SQL, no model
- **New: a themed summary of `reason_detail`** — the members' own words. An LLM
  reads the free-text reasons and reports themes with counts: "eleven mentioned
  the evening crowd, seven mentioned parking". No competitor has this because no
  competitor has the words.
  - Runs **in the nightly recompute only.** Store the summary with the run;
    serve it from the database. Never on page load.
  - Read-only output to a screen a human reads. It must never reach a prompt,
    a variable, or any compiled text. This is the opposite direction of travel
    from the thing the safety model forbids, and the distinction is the reason
    it's allowed at all.
  - Use a small fast model. Fifty short sentences is a trivial call.
  - If there are fewer than ~10 completed calls with `reason_detail`, show the
    enum breakdown alone and say the summary needs more calls. Do not summarise
    three sentences.

Derive every number from `lib/` functions the API routes already use, so the
screen and the endpoints can't disagree.

## 2. Deal offers — scheduling and eligibility

The incentive system has content but no eligibility layer. A gym can say what it
offers and cannot say how often, so nothing stops the same member being offered
something every month. This adds the missing half.

**The form, not an LLM.** Shape: `every [select period], allow the agent to
offer [select offer]`. The offer dropdown is populated from what that gym's own
onboarding captured — a gym cannot schedule something it never configured.

**Cooldown is per offer type, not per member.** Each configured offer gets its
own period: the guest pass quarterly, the free session twice a year, whatever
the gym picks. Periods as a fixed select — monthly, quarterly, twice yearly,
yearly, never.

**No lifetime cap.** Cooldowns are sufficient; don't add one.

**Reward-hacking guard.** Offers only reach members who are inactive *and* had a
genuine habit. The existing habit guard (`old_rate >= 1.0`) is that check and
**stays at 1.0** — its job is distinguishing a routine from sporadic
attendance, not measuring churn risk. Do not change the threshold. Gaming this
requires not going to the gym, which costs the member more than the offer, and
the habit guard stops someone who never had a routine from qualifying at all.

**Enforcement lives with eligibility, not the prompt.** `eligibility.ts` already
holds do-not-contact, the conversation cap and the cooldown. Offer cooldowns
belong beside them, checked before an offer is compiled into a block. A member
inside an offer's cooldown compiles as though the gym had nothing to offer —
which is a code path that already exists and is already guarded.

## 3. Enum widening — the offer long tail

`reengagement_perk` and `winback_offer` are closed enums, so a gym offering a
free protein shake has nowhere to put it.

- Add `other` to both, with a short typed label through `lib/textSafety.ts` and
  a delivery select: texted link, or needs booking.
- One registry sentence with a slot for the label, plus the matching delivery
  instruction. The compiler still writes the sentence; the gym only supplies a
  noun.
- `validateIncentives.ts` must check the block contains that label and no other
  offer, exactly as it does for the existing enum values.
- The label goes through the same allowlist as every other free text field. A
  label that fails is refused with a reason, not cleaned up.

This is what a chat interface would have been for, without an LLM writing
anything.

## 4. Editing an existing gym

`POST /api/gyms` never overwrites, so a gym fills in the questionnaire once and
is stuck with it. Add a `PATCH` route and the same form prefilled with current
values, reusing the existing parse, compile and validate path. No new safety
surface — it is the save route with a different verb.

Keep the never-overwrite behaviour on `POST`. Editing is explicit.

## 5. Cancellation requests — data and visibility only

A member who has asked to cancel is the one case where the auto-renew exclusion
should lift, because the reason for that exclusion — that the call is the only
thing that could end the membership — no longer holds. They've already moved to
end it.

**This pass adds the field, generates it, and shows it. It does not call anyone.**
The exclusion flip and the agent that handles a freeze are pass two, so that the
enforcement of the most important rule in the system changes in the same pass as
the thing that needs it.

**Schema.** A `cancellation_requested` timestamp on the member, nullable. Null
means no request. Also accept it in the CSV import as an optional column —
absent column means no requests, not all-false.

**Generation rule.** Roughly 5% of 500 members, about 25, distributed the way
cancellations actually happen: someone stops going, then something unrelated —
a bank statement, a partner asking about the direct debit — makes them notice
they're paying. Weight it:

| Shape | Roughly | Why |
|---|---|---|
| Auto-renewing, absent 8+ weeks | 12 | The bulk of real cancellations, and the sleeping dog waking on their own |
| Fixed-term near expiry who says so unprompted | 5 | Less common since they could just lapse, but they'd otherwise sit in the renewal queue |
| Recent joiners churning early | 5 | Early churn is real and 90-day retention is the strongest predictor there is |
| Long-tenured actives cancelling anyway | 3 | Moving, injury, money. Rare, and it stops the flag being perfectly predictable |

Two rules across all of them: **nobody who checked in within the last week, and
nobody currently visiting more than twice a week.** Those people don't cancel,
and a flag on a four-times-a-week member makes the whole dataset look fabricated.

**Visibility.** On the dashboard, a cancellation-requests group showing these
members with their contract type and absence. Label it honestly: these are the
only auto-renewing members the system would ever call, and that path is not
built yet. State it as pending rather than implying it works.

## Guards

Every item above needs guards beside the existing 53. The one that matters most:

**`cancellation-flag-does-not-yet-change-who-is-called`.** A member with
`cancellation_requested` set and `auto_renew == true` is still excluded by the
router and still gets a 403 from `/api/call`, in this pass. Pin it now, so pass
two has to deliberately change a guard rather than quietly changing behaviour.

Also pin:
- An offer inside its cooldown compiles to a block that offers nothing, and the
  validator accepts that block
- Each offer type's cooldown is independent — one being spent doesn't spend another
- A member failing the habit guard never reaches an offer regardless of cooldown
- An `other` label that fails `textSafety` is refused, and one that passes
  compiles to a valid block naming it and nothing else
- `PATCH` updates and re-validates; `POST` still refuses to overwrite
- The generated cancellation flags obey both exclusion rules — no recent
  check-in, no high-frequency attender
- The themed summary never appears in any compiled variable or prompt text
- The intelligence page renders with zero completed calls, and with fewer than
  ten `reason_detail` values

## Environment

`ONBOARDING_WRITES=enabled` now goes into Vercel for Production and Preview, so
onboarding can be demoed on the live URL rather than locally. The
unauthenticated-write concern is accepted and out of scope. Note it in
LIMITATIONS rather than silently dropping it.

## Do not

- Do not touch the three existing agent prompts, or run `agents:sync`.
- Do not build the fourth agent, the freeze offer, or the exclusion flip.
- Do not change the habit guard threshold.
- Do not add a lifetime offer cap.
- Do not cite external benchmark figures anywhere in the product.
- Do not call a model on page render, anywhere.
- Do not let the themed summary reach a prompt, a dynamic variable, or any
  compiled text.
- Do not weaken any of the 53 existing guards. If a schema change breaks a
  fixture, fix the fixture and say which and why.
- Do not invest in visual design — pass three replaces it.
- Do not build a chat interface, a login page, template slots, an additional
  facts list, or a request queue.

## Report

In `PASS_ONE_REPORT.md`: what runs per item, new guard count and what each
pins, any metric that turned out not to be computable from existing data, the
generated cancellation distribution against the table above, and confirmation
that all 15 scenario payloads are still byte-identical.
