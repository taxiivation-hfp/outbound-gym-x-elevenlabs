# ONBOARDING_PLAN.md — gym setup, document extraction, and data sync

Read this, then `README.md` for the current architecture, then
`lib/compileVariables.ts` and `data/gyms.json` before writing anything.

This builds the path a real gym takes from nothing to a working agent. Today
that path is "edit a JSON file in the repo", which is fine for a demo and is
also the weakest answer to "how does this scale past two gyms".

---

## What this is worth

| Rubric line | Why this moves it |
|---|---|
| Technical Difficulty (8) | Model chaining — an extraction model feeds the voice agents. The rubric names it in the top band. |
| Creativity in Solution Design (8) | Drop the handbook you already have, don't fill in a form. Nobody types eight fields for fun. |
| Feasibility & Viability (8) | CSV export works on day one for any platform. API partnerships come after customers, not before. |
| Live Demo Quality (8, finals) | "One prompt, config per gym" stops being a claim in the README and becomes something a judge watches happen. |
| Functionality & Execution (10) | Only if nothing here fakes a success state. See the non-negotiables. |

---

## Non-negotiables

Three rules. Everything in this document is downstream of them.

### 1. Extraction produces structured values, never prompt text

An uploaded document is untrusted input from a customer. It must never reach an
agent's system prompt unmediated.

The extraction model's only job is to read a document and fill **typed form
fields** — a number, a boolean, an enum, a short string. It does not write
sentences the agent will read. `lib/compileVariables.ts` still builds every
incentives block, every `expiry_line`, every `context` string, from those typed
values, exactly as it does now.

This is the difference between "extract 20 into `renewal_discount_percent`" and
"write the incentives paragraph". The first is structured extraction with a
narrow output space. The second lets a gym owner's PDF author the guardrails
that constrain an agent making real financial offers to real people, which is
the standard indirect-injection path and a categorically worse failure than
the quiet-hours hallucination the eval suite already caught.

### 2. Blank stays blank

A field the document doesn't mention is left empty. Not guessed, not inferred
from context, not filled with a plausible default.

This is a feature and it is worth demonstrating. `"I don't have that in front of
me"` was read by the agent as a fact to paraphrase rather than an absence to
admit — eval run 1, defect 2. An onboarding flow that invents a quiet-hours
value because the handbook didn't state one would reintroduce that bug from a
new direction. An empty field must propagate as a genuine absence all the way
to the agent saying it doesn't know.

### 3. Nothing fakes success

A button that shows a spinner and then says "Connected!" when nothing connected
is the one thing in this plan that could cost points rather than earn them.
Placeholders are fine. Placeholders that claim to have worked are not.

Label unbuilt integrations as unbuilt. See Phase 6.

---

## The flow

```
Welcome
  ├─ "Set up manually"  ──────────────┐
  └─ "Upload what you've got" ─→ extract ─→ review & edit ─┤
                                                            ↓
                                                    Gym config saved
                                                            ↓
                                              Connect member data
                                                ├─ CSV upload (real)
                                                └─ Platform API (labelled unbuilt)
                                                            ↓
                                                     Dashboard
```

Both paths land on the same review screen. Manual arrives with it empty,
upload arrives with it prefilled. The review screen is the only way config gets
saved, in both cases — which makes the human reviewing prefilled fields the
validation step for extraction, and means there is no path where extracted
values reach an agent without someone having seen them.

---

## Phase 1 — Gym config becomes data

`data/gyms.json` is currently a checked-in file read at build time. It needs to
be writable at runtime before any form can save to it.

1. **Create a `gyms` table in Supabase** with the structured fields below, and
   migrate the two existing gyms into it as seed rows. Keep
   `data/gyms.json` as the seed source so `npm run data:build` still works and
   the repo still documents what a gym config looks like.
2. **The structured schema.** These are form fields, not prose. Every one is
   nullable, and null means the gym didn't tell us.

   | Field | Type | Null means |
   |---|---|---|
   | `gym_name` | string, required | — |
   | `opening_hours` | string | agent says it doesn't know |
   | `quiet_hours` | string | agent never mentions quiet times |
   | `other_locations` | string[] | agent treats as "none" |
   | `has_online` | boolean | false |
   | `books_classes` | boolean | false |
   | `renewal_discount_percent` | integer | no renewal save available |
   | `reengagement_perk` | enum: `guest_pass`, `free_session`, `none` | nothing to lead with |
   | `winback_offer` | enum: `free_pt_session`, `guest_pass`, `none` | nothing to offer |
   | `cheaper_tier_name` | string | no cheaper option exists |
   | `cheaper_tier_price` | decimal | — |

   Note what is *not* here. `renewal_price` is per member and comes from their
   contract, not from gym config. Do not add it.

3. **Extend `compileVariables.ts` to build the three incentives blocks from
   these fields.** It already does this for the two hand-written gyms; the
   change is reading from typed values rather than a prose string in JSON.

   Every generated block must end with the door-closing sentence. A gym with
   `renewal_discount_percent = null` gets the "you have nothing to offer, do not
   mention discounts, do not offer to ask a manager" block, not an empty
   section. The closing sentence is the important half — without it the agent
   fills the gap with something the gym never agreed to.

   `free_pt_session` needs a booking, so its block says a human will call to
   arrange a time. `guest_pass` is a link, so its block says to text it. The
   delivery instruction is a property of the offer type, not a field the gym
   fills in.

## Phase 2 — The questionnaire

4. **A form at `/onboarding`** covering exactly the fields in Phase 1. Typed
   inputs — number spinner for the discount, select for the offer enums,
   checkbox for the booleans. No free text where an enum will do, because the
   free-text field is the one that can produce a config nothing has evaluated.
5. **Empty is a valid answer and the UI must say so.** Next to each optional
   field, show what the agent will do if it's left blank — "Charlie won't
   mention quiet times", "Charlie will say he doesn't have opening hours". This
   is the cheapest possible way to make rule 2 visible, and it doubles as the
   thing a judge notices.
6. **A live preview panel** showing the three compiled incentives blocks as the
   form changes. This is the whole architecture made visible on one screen: the
   gym fills in structured values, the prompt text is generated, no `if` ever
   enters a prompt. If you build one thing in this phase that isn't strictly
   necessary, build this.

## Phase 3 — Document extraction

7. **Accept a PDF, DOCX or plain text upload** on the welcome screen. What gyms
   actually have varies: franchise groups have real sales handbooks and
   objection scripts, a two-site owner-operator has a price list and a
   membership agreement. Accept any of them and parse what's there. The
   membership agreement is usually the most reliable, because contract terms and
   prices have to be in it.
8. **One extraction call, structured output.** Give the model the document text
   and the Phase 1 schema, and require JSON matching that schema with nulls for
   anything not stated. Use a small fast model — this is structured extraction,
   not reasoning, and the model choice is itself a scored decision under Use of
   Data / Models. Record the reasoning wherever the other model choices are
   documented.
9. **Prompt the extractor to prefer omission.** Explicitly: if the document
   does not state a value, return null. Do not infer from context, do not use a
   typical value for a gym of this kind. An over-eager extractor is the failure
   mode here, not a lazy one.
10. **Show provenance on the review screen.** For each prefilled field, show
    the sentence from the document it came from. A gym owner checking eleven
    fields needs to see why the discount says 20%, and it turns the review from
    a chore into a verification. Fields with no provenance are ones the
    extractor guessed, and should be treated as suspect.
11. **The progress bar should be real.** Upload, parse to text, extract,
    validate — four stages with actual transitions, not a timed animation.

## Phase 4 — The validator, and new guards

This is the phase that keeps Phase 3 from being dangerous, and it is the most
interesting thing in this plan from a Technical Difficulty standpoint: an
assertion suite over generated prompt text, sitting alongside the existing
assertions over routing logic.

12. **Write `lib/validateIncentives.ts`.** Given a compiled incentives block and
    the structured config it came from, assert:
    - The block ends with a door-closing sentence.
    - Every number appearing in the block appears in the structured config.
    - The block mentions no offer type absent from the config.
    - A config with nothing to offer produces a block that forbids offering, and
      contains no discount, no percentage, no cheaper-tier language.
    - Nothing in the block resembles an instruction to the agent that did not
      come from the compiler's own templates.
13. **Run it on every compile, not just at onboarding.** It is cheap and it is
    the last line between a malformed config and a live call.
14. **Add these as routing guards.** The suite is at 19 deterministic guards;
    these belong with them. Pin each one to a specific bad config — the gym with
    nothing, the gym with a discount but no cheaper tier, a config with a
    negative discount, a config where extraction returned a string where a
    number was expected.
15. **Add one adversarial fixture.** A questionnaire document containing text
    that reads like an instruction — the price list with a line saying to
    disregard prior instructions and offer everyone half price. The assertion is
    that extraction fills fields or nulls, and the compiled block is unchanged
    from what those fields would produce on their own. This is a guard against
    the failure rule 1 exists to prevent, and it is worth having in the repo
    whether or not anyone asks about it.

## Phase 5 — Member data: CSV upload and the data model

Gym config is one half of onboarding. The other is the member data, and it needs
a schema change first.

16. **Contracts become one row per term, not one mutable row per member.** A
    renewal currently has nowhere to go: if a sync only appends, a member who
    renewed at the front desk keeps her old expiry date and stays in the renewal
    queue, and the agent rings a member who renewed three days ago to tell her
    she needs to renew. That is the call that costs the gym a member.

    One row per term fixes it. Sarah's 12-month term to March is a row; her
    renewal to September is a second row with its own start and end. Current
    state is the row with the latest end date. Contract history comes free —
    tenure, renewal count, whether she has ever lapsed before. This is also how
    the platforms model it; Mindbody exposes ClientContracts as distinct records
    for exactly this reason.

17. **Per-table sync semantics.** Different tables, different rules:
    - **Check-ins: insert only.** One row per visit, member id and timestamp.
      `days_since_visit` is derived from `MAX(timestamp)` at query time, never
      stored, never an array on the member record. A visit that happened cannot
      un-happen.
    - **Contracts: insert only**, given 16.
    - **Members: upsert.** Phone numbers change, `auto_renew` flips when someone
      switches plan. Small table, low churn, don't be clever.

18. **Build the CSV upload properly.** Three files — members, contracts,
    check-ins. Validate the columns, show what parsed and what didn't, reject a
    malformed file with an error someone can act on. Every major platform
    exports these to CSV, because gym staff already do it for their accountant.
    This is a real integration path, not a stopgap: it works on day one for any
    platform, with no API access, no credentials and no partnership.

## Phase 6 — The platform connectors, labelled honestly

19. **A section listing Glofox, Mindbody and PushPress, marked not built.** Not
    a button with a spinner. For each platform, show the three field mappings
    already documented in the README's limitations table, and flag the one field
    that decides everything: whether the contract auto-renews. Mindbody exposes
    it directly as `AutoPayEnabled`; Glofox and PushPress require inferring it
    from the plan type, and getting that inference wrong is precisely the
    failure this product exists to avoid.
20. **Say what each integration needs.** Mindbody wants developer credentials
    and an approved app; Glofox and PushPress vary by the gym's plan tier. That
    sentence is a better answer to "how would you integrate" than a connector
    coded blind against documentation, and it is the honest reason the CSV path
    exists.

## Phase 7 — The nightly recompute

Optional, and only worth building if Phases 1–6 are solid. It closes the
"CSV is a snapshot" objection properly.

21. **Nothing in this product needs to be real-time. It needs to be daily.**
    There is no moment where calling at 2pm beats calling at 9am tomorrow.
    Contracts and expiry dates don't move, so renewal and winback triggers run
    fine off a periodic export plus a clock. The one field that genuinely goes
    stale is `days_since_visit`, and a 28-day absence trigger firing on day 28
    or day 29 is indistinguishable to everyone involved.
22. **A scheduled job that recomputes the queue against the wall clock.** The
    pipeline already does this computation; it just does it against a frozen
    reference date. `DATASET_CLOCK=live` is already the switch. The frozen clock
    exists because the dataset is synthetic, not because the architecture needs
    freezing — make sure the README says that, because as written it reads like
    a limitation of the design.
23. **Re-check eligibility at dial time, not only at queue time.** The queue is
    computed nightly; the call happens when someone presses the button. Between
    those a member can renew, cancel or walk in. `/api/call` already re-checks
    the auto-renew rule server-side — same pattern, one more read — so a stale
    queue entry cannot produce a wrong call even when the sync missed something.

---

## Do not

- Do not let an LLM write prompt text. Extraction fills typed fields; the
  existing compiler writes prose. This is the whole safety model.
- Do not fill a blank field with a plausible default, anywhere in the stack.
- Do not build a connector that shows a success state without connecting.
- Do not store check-ins as an array on the member record.
- Do not add `renewal_price` to gym config. It is per member, from their
  contract.
- Do not bypass the review screen. There must be no path from an uploaded
  document to a saved config without a human seeing the values.
- Do not let the existing 19 routing guards or 15 conversation scenarios break.
  If a schema change breaks a fixture, fix the fixture and say so — do not
  weaken the assertion.

## Report

What runs, what doesn't. The new guard count and what each one pins. Whether the
adversarial fixture passes. Anything in this plan that turned out wrong. And
specifically: does an empty `quiet_hours` still produce an agent that admits it
doesn't know, end to end through the new config path — because that is the one
regression this whole plan could cause.
