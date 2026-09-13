# PASS_ONE_REPORT.md

The report on `PASS_ONE.md`: the business-side features, data and logic only.

## The short version

- **All five items are built** on the `pass-one` branch, one commit per item. Nothing is pushed or deployed.
- **Guards: 73/73.** The 53 that existed before are unchanged in what they assert. This pass adds 20 new ones.
- **All 15 conversation scenarios send byte-identical payloads.** I compared them against `8177d23`, the commit that wrote the committed 15/15 `evals/results/latest.json`, and against `main` before this pass. I re-checked after every item. No prompt was touched, and `agents:sync` was not run.
- **Every other check passes:**
  - type-check;
  - `npm run db:verify`, now covering all nine migrations with 51 checks;
  - `data:verify-port`: 500/500 members;
  - `gyms:seed-check`;
  - `next build`: 24 routes.
  - Lint's only findings are the two errors in `components/TranscriptPanel.tsx`, which predate this pass.
- **Not done, because it can't be done from here:**
  - `ONBOARDING_WRITES=enabled` is not on Vercel. There is no Vercel CLI or token in this environment.
  - The four new migrations are not applied to the real Supabase project.

  Both are listed in `REVIEW_NOTES.md` §0a, in order. The code tolerates each migration being missing.
- **No metric turned out to need an input the data doesn't have.** Several are shaped more by the synthetic generator than by any gym; see "Metrics and what the data can say".

## Commits

| Commit | Item |
|---|---|
| `53b7b63` | 1. Health of the gym on `/intelligence` |
| `eb4f3f8` | 2. Offer schedules and offer eligibility |
| `27aec1a` | 3. "Something else": the offer long tail |
| `f02e92b` | 4. Editing a gym with `PATCH` |
| *(this commit)* | 5. Cancellation requests, plus the docs and this report |

---

## What runs, per item

### 1. Health of the gym

**Runs.** `/intelligence` is now titled "Health of the gym". The nav link reads "Gym health". The existing churn-reasons breakdown sits in the middle, under its own "Why they leave" heading.

Every number is computed by pure functions in `lib/gymHealth.ts`, called from `composeIntelligence` in `lib/intelligence.ts`. The page and `/api/intelligence` both use them.

- **Members** are read through `loadMembers`, the same reader the queue uses. Before, this page imported the dataset JSON directly.
- **Eligibility** comes from `evaluateEligibility` with the same call history the queue reads.

**Membership and money**

- **Active members:** the router's own definition of "not lapsed".
- **Fixed terms ending in the next 14, 30 and 90 days.** These count live fixed-term members only. An auto-renewing member's end date is the next rollover, so auto-renewers are shown as their own count and never as "expiring".
- **Monthly churn and retention**, for six complete calendar months plus the month to date:
  - churn is members lost in the month ÷ members at its start;
  - a member is lost on the last day their term ran.
- **90-day retention:** members who joined 120 to 485 days ago and were still members at day 120. Day 120 is the first paid month plus 90 days.
- **MRR and ARPM.**
- **Revenue at risk:** `monthly_fee` summed over the members each call queue is due to call today. For winback, that is what the lapsed members used to pay.

**Engagement**

- **Frequency segments:** frequent, occasional, inactive after a habit, and inactive and never regular.
  - They are cut at `ABSENCE_DAYS` and `HABIT_MIN_RATE`, which `lib/callType.ts` now exports as `ROUTING_THRESHOLDS`.
  - A guard checks the thresholds' edges. It also checks that all 20 dataset members the router sends to reengagement for a settled habit land in "inactive, had a habit". The page's 50 in that segment also include members it doesn't call: those near expiry, who get the near-expiry trigger, and auto-renewers.
- **Visits per member per week:** twelve seven-day windows of completed days.
- **Busyness:** a weekday × hour grid over the last twelve weeks, with the five busiest cells named.
- **Where the check-in data comes from:**
  - *Synthetic dataset:* `data/checkin_activity.json`, built by `scripts/build-checkin-activity.ts`, which is now part of `data:build`. Shipping all 37,692 check-ins to a page render would cost load time.
  - *Uploaded data:* two SQL functions, `checkin_weekly` and `checkin_hourly`. `db:verify` checks that they return exactly what `summariseCheckins` returns for the whole dataset.

**Why members leave**

- **The existing breakdown** by reason, cohort, call type and tenure band is unchanged. It is aggregated in TypeScript over the call records, as before, not in SQL. No model is involved either way.
- **The themed summary of `reason_detail`:**
  - It runs only in the nightly recompute, via `runRecompute` → `summariseReasonThemes`, on `claude-haiku-4-5`.
  - It is stored on `queue_runs.reason_themes`.
  - The page only reads it (`latestReasonThemes`). No page, and no route a person calls, calls a model.
  - The model returns statement numbers per theme, not counts. `checkThemes` counts them itself: it drops statement numbers that don't exist or were already claimed, drops one-member themes, and refuses a theme name that isn't a short, single-line plain phrase.
  - Below 10 statements, the page shows the breakdown alone and says the summary needs more calls. It never shows a stored summary it doesn't have enough statements for. The run doesn't call the model either.
  - Nothing a call is built from can reach it. A guard walks the import graph of the call route, the send-text route, the webhook, `compileVariables` and the agent sync: none of those files imports the summary module or names its column. The guard also checks that no prompt file names it, and that a call compiled next to a stored summary contains none of its text.
- **Verified live once:** 12 made-up statements, including an injected instruction, went through the real `summariseReasonThemes` against `claude-haiku-4-5-20251001`.
  - It returned "crowding in the evenings" 4, "parking is difficult or full" 3 and "price increase too expensive" 2.
  - The injected line was one of the 3 unthemed statements.
  - Nothing was stored.

**Checked in a real page render** against the local dev server, reading the real Supabase project read-only. Synthetic dataset, 2026-09-12:

| Measure | Value |
|---|---|
| Active members | 410, of whom 148 are on auto-renew |
| MRR | $32,570 |
| ARPM | $79.44 |
| 90-day retention | 100% (354 of 354) |
| Fixed terms ending in 14 / 30 / 90 days | 65 / 65 / 103 |
| Revenue at risk: renewal | $2,903 a month, 37 members |
| Revenue at risk: reengagement | $3,268 a month, 42 members |
| Revenue at risk: winback | $6,824 a month, 86 members |
| Segments | 189 frequent, 123 occasional, 50 inactive after a habit, 48 inactive and never regular |

### 2. Deal offers: scheduling and eligibility

**Runs.**

**The schedule.** `gyms.offer_schedule` maps an offer to a period: monthly, quarterly, twice yearly, yearly or never.

- The onboarding form has a row per limit: "Every [period] allow the agent to offer [offer]". The offer choices are `configuredOffers(fields)`.
- `parseOfferSchedule` refuses an offer the gym doesn't configure, an unknown offer, a period that isn't one of the choices, and anything that isn't an object. So does a check constraint in the database.
- A gym with no schedule parses to exactly the object it did before. That keeps the seed gyms and every scenario payload unchanged.

**Enforcement** lives in `lib/eligibility.ts`, next to do-not-contact, the attempt cap and the call cooldown. `evaluateOffers(member, history, schedule, callType)` runs before the block is compiled:

1. **The habit gate.** On reengagement and winback calls, every offer is withheld unless the member is inactive after a genuine habit:
   - "inactive" means absent `ABSENCE_DAYS` or more, or lapsed;
   - "a genuine habit" means `old_rate` of at least `HABIT_MIN_RATE`, which is unchanged at 1.0.
2. **Per-offer cooldowns,** measured from `history.offersLastMade`. There is no lifetime cap.

**A withheld offer is compiled as though the gym never configured it** (`withholdOffers`), so it takes the existing "nothing to offer" path. `compileVariables` then validates the block against that masked config.

**Recording.** `/api/call` stores the offers each block granted in `call_records.offers_available`. `send_text` texts an incentive only if the offer is in that list.

### 3. Enum widening: the offer long tail

**Runs.** `reengagement_perk` and `winback_offer` each gain `other`. Each comes with two typed fields: `*_other_label`, and `*_other_delivery`, which is `link` or `booking`.

**The label** gets a new `offer_label` kind in `lib/textSafety.ts`. It is refused, with the reason shown beside the field, if it has:

- a character outside the tier name's allowlist (letters, spaces, `'`, `&` and `-`, so no digits);
- more than four words, or a leading article;
- another typed offer's name, such as guest pass, session or discount;
- a period or price word, such as month or half;
- a second thing joined on, such as "and" or "with";
- "everyone";
- anything the existing instruction and offer vocabulary already catches, including "free".

**The sentences.** There is one registry sentence per call type with a slot for the label, for example "You are calling with something to give them from the gym: {reengagement_label}." Each also has a limit sentence, "The {label} is the only thing you have." Delivery reuses the existing link and booking sentences. The gym supplies only the noun.

**The validator** re-derives the label and delivery from config, requires both exactly when `other` is chosen, and then checks the block:

- it must name the configured label;
- it may not name the label anywhere the compiler didn't put it: on a call type that doesn't grant it, or in a sentence whose template doesn't carry that slot;
- it may not grant any other offer the config doesn't hold.

**Joined up with everything else.** `other` also gets:

- schedule keys: `reengagement_other` and `winback_other`;
- the habit gate and cooldowns;
- `send_text` with a "GIFT" code prefix, by link only;
- its own landing-page copy.

**Never extracted.** The extraction schema's enums don't include `other`, the four new fields aren't extracted, and the sanitiser rejects `other` if it arrives anyway. The schema's union count stays at 11, under the limit of 16.

### 4. Editing an existing gym

**Runs.** `PATCH /api/gyms/[gymId]` and `POST /api/gyms` share one parse → compile → validate path, now in `lib/gymWrites.ts`.

**What PATCH does:**

- refuses unless `ONBOARDING_WRITES=enabled`;
- refuses a body that carries `gym_id` or `created_via`;
- keeps the id from the URL when the name changes, because call records refer to it;
- writes every config column, so a field cleared on the form is cleared in the row;
- returns 404 rather than creating a gym.

**POST still never overwrites:** `insertGym` only ever inserts, and an existing id is a 409.

**The edit form.** `/onboarding/[gymId]/edit` is the same form, prefilled with the current values and schedule, and it saves with PATCH. "Gyms already set up" links to it.

- Checked by rendering: the edit page SSRs the form with Southbank's stored values.
- Against the local dev server, whose writes are off, `PATCH /api/gyms/southbank` returned 403 and wrote nothing.
- No PATCH has been made against the real database. The two guards run the real `insertGym` and `updateGym` against an in-memory table that answers like PostgREST.

**Store behaviour on an older database.** `gymStore` now reads every column and narrows to the config's keys. It writes the pass-one columns only when a config uses them. So a gym that uses no new setting still reads and saves on a database without the new migrations; one that does gets told which migration to apply.

### 5. Cancellation requests: data and visibility only

**Runs.**

- **Schema:** `members.cancellation_requested`, a nullable `timestamp` in local gym time. `import_members` now takes it as a fifth element.
- **CSV import:** an optional `cancellation_requested` column.
  - A date is read as midnight. A local timestamp is kept.
  - A time zone, or a value such as "yes", is refused with its line number.
  - A blank cell, or no column at all, means no request (`null`).
- **Carried through:** `Member`, `memberData` (the port still matches 500/500), `memberStore`, `QueueEntry` and `members_scored.json`.
- **Generation:** `pipeline/generate_cancellations.py`, a new `data:build` step between the generator and `build_scores.py`.
  - It reads the generated CSVs and has its own RNG, so every other column, row and check-in is byte-for-byte what it was.
  - `members_scored.json` differs from before only by the new key on each member.
- **Dashboard:** a "Cancellation requests" group.
  - It lists each member with the date they asked, their contract type (fixed or auto-renewing), how long they've been away, and what happens to them today.
  - It says the auto-renewing ones are the only auto-renewing members the system would ever call, and that the path isn't built yet. Each is tagged "pending".
- **No call path changed.** The auto-renew branch in `callType.ts` is untouched and still first.
  - `/api/call`'s refusal body moved to `lib/callGate.ts` so a guard can pin it. The response is unchanged.

---

## The generated cancellation distribution against the table

25 of 500 members. The seed is 547; re-running produces the same 25.

| Shape (plan) | Planned | Generated | Eligible pool | Notes |
|---|---|---|---|---|
| Auto-renewing, absent 8+ weeks | ~12 | **12** | 14 | Away 56–139 days. Tenure 109–585 days. |
| Fixed-term, term ending within 14 days, says so | ~5 | **5** | 6 | Terms end in 3–14 days. Last visit 8–22 days ago, so all five are in the renewal queue today. |
| Recent joiner churning early | ~5 | **5** | 5 | Tenure 16–21 days. **Four of the five have never checked in**, and one is on auto-renew. |
| Long-tenured active cancelling anyway | ~3 | **3** | 33 | Tenure 431–519 days, last visit 9–26 days ago. One is on auto-renew. |

- **14 auto-renewers in total:** the 12 absent members, plus one recent joiner and one long-tenured member.
- **Both rules hold for all 25, checked against the raw check-ins by a guard:**
  - no check-in in the 7 days before 2026-09-12;
  - no more than 8 check-ins in the last 28 days;
  - every request falls after the member's last visit and before the dataset's date.
- **Shortfalls in the pool:**
  - The recent-joiner pool was exactly 5. That means requiring 14–90 days of tenure and no visit in the last week. So that shape is fully determined, and four of them read as "signed up and never came", not "came, then stopped".
  - The near-expiry pool was 6, because most renewal-window members train more than twice a week.

  A larger synthetic population would give both shapes more choice.

---

## Guards: 73, of which 20 are new

### `evals/healthGuards.tsx` (item 1): 6

| Guard | What it pins |
|---|---|
| `health-numbers-match-a-hand-count` | Five members small enough to count by hand. Active 4, of whom 1 auto-renews. MRR $290, ARPM $72.50. Fixed terms ending 1/1/2. August: 5 at the start, 1 lost, 20% churn. 90-day retention 4/5. Revenue at risk $80 renewal, $100 reengagement, $70 winback. |
| `health-segments-use-the-routers-thresholds` | The segment edges fall where the router's do (28 days and 1.0 visits a week). All 20 settled-habit reengagement members in the dataset are "inactive, had a habit". |
| `checkin-summary-matches-the-dataset` | `data/checkin_activity.json` equals `summariseCheckins` over `pipeline/data/checkins.csv`. |
| `intelligence-renders-with-no-calls-and-few-reasons` | The real page view renders with zero calls (health plus the empty state). With five reasons it says the summary needs 10, hides a stored summary and keeps the breakdown. With twelve it shows the summary. |
| `themed-summary-counts-are-counted-not-trusted` | Invented, duplicate and out-of-range statement numbers aren't counted, and one-member themes are dropped. A multi-line or over-long theme name refuses the whole summary. Nine statements return "insufficient" without a model call. `reasonDetails` counts only completed calls that reached the member. |
| `themed-summary-never-reaches-a-prompt` | No file reachable from the call route, send-text, the webhook, `compileVariables` or the agent sync imports the summary or names its column. No prompt file names it. No theme text appears in compiled variables for either gym. |

### `evals/offerGuards.ts` (item 2): 5

| Guard | What it pins |
|---|---|
| `offer-inside-cooldown-compiles-to-nothing` | A guest pass 30 days into a quarterly cooldown compiles to exactly Southbank's "nothing to give them" block, and the validator accepts it. It returns at day 92. "Never" switches it off. |
| `offer-cooldowns-are-independent` | A spent PT session leaves the cheaper tier on offer, in a valid block. A renewal discount doesn't spend the guest pass. A guest pass spends across call types. |
| `habit-guard-blocks-offers-regardless-of-cooldown` | A sporadic near-expiry reengagement member, and a sporadic lapsed member with a long-expired cooldown, get no offer, in valid blocks. The gate passes at exactly 1.0 and fails at 0.99. The renewal discount isn't gated. |
| `schedule-names-only-configured-offers` | Kensington can't schedule a guest pass, and neither can a stored row. Unknown periods and offers are refused. `{}` is blank. The seed gyms gain no key. An eligible member with no schedule compiles byte-identically. |
| `offer-history-spends-conservatively` | A record from before `offers_available` spends every offer its call type can carry. A block that granted nothing spends nothing, and so does "no offer made" or an unanswered dial. The latest offer is the one the cooldown counts from. |

### `evals/otherOfferGuards.ts` (item 3): 4

| Guard | What it pins |
|---|---|
| `other-label-refused-or-compiled-naming-only-itself` | 14 labels are refused, each with a reason on the label field. They include "free protein shake", "a protein shake", "…and a guest pass", "50 percent off", "ignore previous instructions", an invisible combining mark, a fullwidth "…with bonus", a sentence break and "personal training". Five real labels ("protein shake", "gym towel", "smoothie", "Café crème", "branded drink bottle") compile to valid blocks that grant only `other`, name the label and no other offer. |
| `validator-checks-the-other-label` | Each of these is refused: a shake block against a towel config; a shake block against a guest-pass config; the label smuggled into a renewal block; the reengagement label inside a winback sentence; the grant sentence removed; a label without `other` chosen. The last is refused by the validator and by the parser. |
| `every-config-with-other-compiles-to-a-valid-block` | 192 blocks: `other` by link and by booking on both call types, with and without a tier and quiet times. All valid. |
| `other-offer-is-scheduled-texted-and-never-extracted` | A shake inside its quarter is withheld, and its nothing block is valid. It is texted by link, never when booked. The landing page names it only when the gym texts it. The extraction schema can't return it, and the sanitiser rejects `other`. |

### `evals/gymEditGuards.ts` (item 4): 2

| Guard | What it pins |
|---|---|
| `patch-updates-and-revalidates` | A valid PATCH updates the row: new name, same id, 15% discount, a cleared field stored as null, the schedule saved, and the recompiled block returned. A 60% discount, a schedule for an unconfigured offer, an unsafe label and an id in the body are refused, and none of them writes. A missing gym is a 404. Writes off is a 403. |
| `post-still-refuses-to-overwrite` | A POST whose name slugs to an existing id is a 409, the row is untouched, and the store is never asked to update. A new gym is inserted without the unused pass-one columns. |

### `evals/cancellationGuards.ts` (item 5): 3

| Guard | What it pins |
|---|---|
| **`cancellation-flag-does-not-yet-change-who-is-called`** | All 14 flagged auto-renewers in the dataset, plus a fixture, are excluded by `routeMember`. `evaluateEligibility` blocks each on `auto_renew`, and `/api/call`'s refusal (`callRefusal`) is a 403 with `blocked_by: "auto_renew"`. No flagged member routes any differently from the same member without the flag. |
| `generated-cancellations-obey-both-exclusion-rules` | Checked against the raw check-ins, for all 25: no check-in in the last week, no more than 8 in 28 days, requested after the last visit and before the dataset's date, on an active membership. 20–30 requests in total, and at least 12 auto-renewers away 8+ weeks. |
| `cancellation-column-is-optional-in-the-import` | No column gives null for every row. A blank cell is null. A date and a local time are kept. A time zone, or "yes", is refused with its line. |

---

## Metrics and what the data can say

Every metric in item 1 is computed from data already in the pipeline. None needed an invented input. What each can honestly claim:

- **Churn, retention and 90-day retention** are measured from each member's current contract end date. That is the only term the synthetic dataset has, and uploaded data reduces to the same thing through `currentContract`. A member who left before an export's history begins can't be counted by anyone.
- **The synthetic generator shapes the trends:**
  - Lapsed members exist only in the three winback windows (20–45, 75–105 and 165–195 days ago). So monthly churn alternates between about 7% and nearly 0%: March 7.8%, April 0.0%, May 0.3%, June 7.0%, July 1.0%, August 6.7%.
  - Every lapsed member was generated with at least 120 days of tenure, so **90-day retention is 100% by construction**.
  - Check-in hours are drawn uniformly between 6am and 8pm, so the busy-hours grid is nearly flat.

  The same functions on real uploaded data will say something real.
- **"Still paying at day 120"** means the membership term was still running. A missed direct debit isn't in the data.
- **A cancellation request is not a loss.** It isn't counted in churn. An auto-renewing member stays active until their membership actually ends.
- **Revenue at risk for winback** is lapsed members' former fees: revenue already lost and recoverable, not revenue at risk of loss. It is labelled that way on the page.

## Decisions the plan didn't settle

1. **"Never" in the offer schedule means the offer is switched off.** The alternative reading, "once, then never again", would be a lifetime cap of one, which the plan rules out.
2. **An offer with no schedule has no cooldown.** It behaves as offers did before schedules existed. That is what keeps every payload identical.
3. **The habit gate covers reengagement and winback calls, not renewal.** The plan says offers reach only members who are inactive after a habit. A renewal call only reaches members still training, so applying "inactive" there would make the renewal discount unreachable. The renewal discount is limited by its schedule alone. The cheaper tier on a winback call is gated like every other winback offer.
4. **"Inactive" includes lapsed.** A winback member absent fewer than 28 days has no membership to attend with.
5. **A guest pass is one offer type across both call types.** Given on reengagement, it is spent for winback. An `other` offer is keyed per call type (`reengagement_other`, `winback_other`), since each has its own label.
6. **When a call analysis says "offer made" and the block granted two offers, both are spent.** A record from before `offers_available` spends every offer its call type can carry. Both err towards a longer cooldown.
7. **A withheld offer is removed from the config before compiling,** rather than having a "don't offer X" sentence added. The prompt never sees a cooldown.
8. **`other` delivery reuses the existing link and booking sentences.** A booked `other` offer says someone from the gym will call to lock in a time.
9. **`other` labels can't start with an article.** The limit sentence says "The {label}", and "The a protein shake" would be wrong.
10. **An `other` label left behind when the choice changes is an error in the parser and the database.** The form doesn't send the label or delivery for a choice that isn't `other`. Those fields are hidden while another choice is selected.
11. **PATCH replaces the whole config and keeps the id,** even when the name changes. It doesn't version edits; that is noted in LIMITATIONS.
12. **An absent cancellation column on re-import clears stored requests.** The plan says an absent column means no requests. It is also the safe direction for pass two: a stale request would lift the auto-renew exclusion for someone who may have withdrawn it. This differs from mobile numbers, which a file without the column leaves alone.
13. **Cancellation generation is a separate pipeline step, not part of the generator.** Changing the generator's random draws would have changed every name, date and check-in.
14. **The themed summary covers every call record's `reason_detail`,** the same rows the existing breakdown aggregates. It is stored per member source: the dataset, or a gym.
15. **The themed summary is capped at the 200 most recent statements.** The request uses a 25-second timeout and no retry, so it fits inside the cron route's 60 seconds. A failure is stored as "unavailable" with the reason and never fails the run.
16. **The guard runner became async** (`runGuards`), because the summary's "fewer than ten" path is an async function. No existing guard changed.
17. **The unused `NO_HISTORY` import in `app/api/call/route.ts` was removed** while moving the refusal body. It was the pre-existing lint warning.

## Fixture changes

- **`evals/fixtures.ts` `fixtureMember`** now includes `cancellation_requested: null`, because `Member` gained the field. No scenario's payload changed, and no assertion changed.
- **`evals/memberGuards.ts`**: `sarah`, the guard's `MemberRecord`, gained `cancellation_requested: null` for the same reason. No assertion changed.
- **`evals/guards.ts`**: the `Guard.run` type now allows a promise, and `runGuards` awaits each guard. No existing guard's code changed.

## Environment and handover

- **`ONBOARDING_WRITES=enabled` on Vercel (Production and Preview) is not set.** There is no Vercel CLI, project link or token here. The accepted risk of unauthenticated writes is written into the README's LIMITATIONS, now including PATCH.
- **Four migrations to apply, in order:**
  - `20260915000000_gym_health.sql`
  - `20260915010000_offer_schedule.sql`
  - `20260915020000_other_offers.sql`
  - `20260915030000_cancellation_requests.sql`

  `db:verify` applies each twice against PGlite and checks their constraints and functions: the schedule shape, `other` consistency, the label's characters, activity functions matching TypeScript, cancellation import and clearing, and denial to the `anon` role.
- **`ANTHROPIC_API_KEY` and `CRON_SECRET`** are needed on the deployment for the nightly summary. Without the key the run records "unavailable".
- **Placeholder UI.** Every new component carries a PLACEHOLDER comment for pass three:
  - `components/intelligence/GymHealth.tsx`
  - `components/intelligence/ReasonThemes.tsx`
  - `components/onboarding/OfferScheduleField.tsx`
  - `components/onboarding/OtherOfferFields.tsx`
  - `components/CancellationRequests.tsx`

  `components/intelligence/IntelligenceView.tsx` holds the pre-existing intelligence sections, moved unchanged, plus the new ones.
- **No external benchmark figure appears anywhere.** All trends are the gym's own.
- **No model is called on any page render.** The only new model call is in the nightly recompute.

## Verification log

| Check | Result |
|---|---|
| `npm run evals:guards` | 73/73 |
| Scenario payloads | 15/15 byte-identical to `8177d23`, the commit that produced the 15/15 run, and to `main` before this pass. Checked after every item. |
| `tsc --noEmit` | clean |
| `npm run db:verify` | all checks pass, nine migrations each applied twice |
| `npm run data:verify-port` | 500/500 exact, including `cancellation_requested` |
| `npm run gyms:seed-check` | matches |
| `build-checkin-activity --check` | matches |
| `members_scored.json` | identical to before except the new key; `pipeline/build_scores.py` reproduces the old file byte for byte |
| `next build` | compiles and type-checks; 24 routes, including `/api/gyms/[gymId]` and `/onboarding/[gymId]/edit` |
| `eslint` | 2 errors in `components/TranscriptPanel.tsx`, unchanged and pre-existing |
| Page renders (local dev server, real Supabase read-only) | `/intelligence`, `/onboarding`, `/onboarding/southbank/edit` (prefilled), `/` with the cancellation group: all 200 |
| Live themed summary | one call to `claude-haiku-4-5-20251001` on 12 made-up statements: 3 themes with correct counts, the injected line left unthemed, nothing stored |
