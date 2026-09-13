# PASS_THREE_REPORT.md

The report on `PASS_THREE.md`: the five screens built from the approved mockups, wired to real data, and then the repo reorganised.

## The short version

- **All five screens are built and committed in order** on the `pass-three` branch. There is one commit per screen, then one for the cleanup:

  | Commit | Screen |
  |---|---|
  | `205129d` | Calls (plus the shared shell, theme tokens and fonts) |
  | `a88873c` | Analytics / Overview |
  | `31602ad` | Setup / Voice agent |
  | `5cfbb66` | Evals |
  | `970f57b` | About |
  | *(the cleanup commit)* | Repo cleanup and this report |

- **No panel shows a number that isn't computed.** Every mockup panel is Wired, Cut or Labelled not built. Each is listed per screen below. After the build, each of the four later screens got an adversarial "assume it cheated" audit and a fix pass, and the Calls screen was checked by hand.
- **Guards: 80/80 after every commit.** No guard was weakened. One guard changed what it queries:
  - `intelligence-renders-with-no-calls-and-few-reasons` (`evals/healthGuards.tsx`) now matches the heading `Gym health` instead of `Health of the gym`.
  - Its assertions are unchanged.
- **Payloads held.** `scenario-payloads-are-pinned` passes, and `npx tsx scripts/snapshot-scenario-payloads.ts --check` reports "31 scenario payloads match the snapshot (as of 2026-09-12)".
  - No agent prompt was touched.
  - `agents:sync` was not run.
  - The full `npm run evals` was not run.
- **No `lib/` function's behaviour changed.** The only `lib/` edits are:
  - the ownership comment headers;
  - deleting three exports in `lib/labels.ts` that the old dashboard used and nothing uses now.
- **Other checks all pass:**
  - `tsc --noEmit` is clean.
  - `npm run lint` is clean. That includes the two old `TranscriptPanel.tsx` errors every earlier report carried, which went when the file was deleted as dead code.
  - `next build` compiles 25 routes, including the new `/about`.
  - `data:verify-port` gives 500/500.
  - `gyms:seed-check` matches.
- **How it was built:**
  - I built the Calls screen and the shell myself.
  - At your instruction ("use dynamic workflows after the calls screen is committed"), the other four screens ran as one workflow: build → adversarial audit → fix per screen, on disjoint files.
  - The workflow hit the session limit partway through. It was resumed from its journal: the two finished builds were reused, and the two interrupted ones were rebuilt over their partial files.
  - Each screen was then looked at in the browser before its commit.
  - The `lib/` headers and the dead-code search ran as a second workflow, with a reviewer that corrected three headers and confirmed the `lib/` diff was comment-only.

## What was cut or labelled, across all screens

Nothing below had a `lib/` function or a committed file behind it, so it is gone rather than faked.

**Cut**
- **Live indicators:** the blinking "Agent live" pills and clocks on every screen, the pulsing "live" dot on Setup, and the queue progress bar ("14 of 46 done").
- **Deltas and trends:**
  - period-over-period deltas ("+$820 vs Aug", "−1.2 pts since Apr", "vs Q2", "+4 pts vs Aug");
  - visit trend arrows;
  - the quietest hour;
  - reasons over time;
  - per-theme quotes and up/down trends.
- **Call details that aren't stored:** call duration, recording playback, per-member freeze history, "78 seconds average" and "cost to date this month".
- **Actions that don't exist:** Snooze 7d, Exclude / Re-include, Hand to Dan, and the evals page's Run suite (it now shows `npm run evals` as text).
- **Nav items and switchers:** Call log, Numbers and Settings; the gym switcher, which was out of scope (calls go out as the default gym).
- **Setup extras:** "Last saved 11 Sep by Dan", the mockup's free-text perk and lapsed-offer inputs (no free text may reach a prompt), page and section locations on quotes, "newest wins" on CSV re-upload (contracts and check-ins are insert-only), a freeze offer limit (the freeze isn't schedulable), and the sample-file button.
- **Layout toggle:** Analytics' mosaic/sections toggle.

**Changed because the mockup was wrong**
- **Evals score history:** "Nine runs, nothing changed between them" and "80/80 every run" were false. The run labels show prompt fixes and a model change, and one run scored 18/19 guards. Both lines are replaced by what the committed run files say.
- **About:** "145 of 500 never called" is now computed (129 today; the 16 auto-renewers who asked to cancel get one call).
  - "in a billing dispute" and "and override it" are gone; neither exists.
  - "Keepme's Antares will make the calls" is corrected to text, chat and email, per README.
  - "hands anything unresolved to a person" is removed; the cancellation goal doesn't say it.
  - "three of them are among the checks that still fail" is replaced by each rule's computed result in the latest run.
  - The opening anecdote about a 1,200-member gym is rewritten without its unsourced specifics.
- **Analytics:** "11 of those have no auto-renew" was nonsense, since fixed terms never auto-renew. Revenue at risk is shown as two sums, "still paying" and "lapsed, recoverable", rather than one total that adds fees being paid to fees already lost.

**Labelled not built**
- Direct connections to Mindbody, Glofox and PushPress, on Setup (`lib/connectors.ts`).
- The member-data card on an unsaved gym, which explains that uploads need a saved gym first.

## Every mockup panel, by screen

Outcomes are **Wired** (with the `lib/` function or committed file it reads), **Cut** (with the reason), or **Labelled** not built. Rows marked "extra" are real panels the old screens had that the mockups didn't, kept and restyled.

### 1. Calls: `/` (mockup `Call Queue.dc.html`)

| Panel / element | Outcome | Source |
|---|---|---|
| Header title "Ironworks" | Wired | default gym name, `buildQueueView().gyms` |
| "Agent live · Sun 13 Sep 08:41" pill (blinking) | Cut → replaced by static "Member data as of {date}" | `view.as_of` (lib/clock). Nothing is live; no time-of-day exists. |
| To call | Wired | `counts.due_total` |
| Called | Wired, relabelled "Dialled" | members with `dial_count > 0` (callHistory). The mockup meant "called today"; there is no per-day call log keyed to the dataset clock. |
| Excluded | Wired | `counts.total - counts.due_total` (all six buckets) |
| Cancel | Wired, "Asked to cancel" | entries with `cancellation_requested` |
| Progress bar under header (14 of 46 done) | Cut | needs "done today", which nothing computes |
| Layout variant A/B | Kept as "One table" / "By call type" | presentation only |
| Filter chips with counts | Wired, plus Cancellation (4 call types) | `counts.renewal` … `counts.cancellation` |
| Search | Wired | client filter over entries |
| Sort note / column sort | Wired | presentation sort; default order is `sortByPriority` with cancellation first |
| Name + CANCELLING badge | Wired | `cancellation_requested` |
| Why now | Wired | short form of the router's trigger (`whyNow` in components/calls/format.ts); full trigger in expansion |
| Days | Wired, "Away" | `days_since_visit` |
| Visits 14d + ▲▼ trend arrows | Column wired as "Visits 90d"; arrows cut | only `visit_count_90d` exists; a trend would need a threshold nothing in lib defines |
| Expires | Wired, "Term ends" (auto-renew shows "rolls {date}") | `expiry_date`, `days_to_expiry` |
| Tenure | Wired | `tenure_days` |
| Fee | Wired | `monthly_fee` ($, the gyms are Australian) |
| Attempts | Wired, "Dials" | `dial_count` |
| Call type tint | Wired, plus cancellation tint | `call_type` |
| Excluded group | Wired, split into the six blocked buckets with counts and reasons; large buckets collapsed | `blocked_by`, `blocked_reason`, `blockedLabel` |
| Group "£x per month in play" | Wired as "$x a month in monthly fees" | sum of `monthly_fee` of rows in the group |
| Expansion: Last call transcript | Wired | `/api/call-records` latest record, `transcript` |
| Expansion: call meta "12 Sep 18:22 · 94s" | Date wired; duration cut | `created_at`; no call duration is stored |
| Recording ▶ button | Cut | no recording is stored |
| Outcome / They said / Committed | Wired | `outcome`, `reason_for_absence` + `reason_detail`, `committed_day` |
| Attempts with timestamps list | Wired as dial count + last dial time | `dial_count`, `last_call_at` (per-dial times aren't in the view) |
| Cooldown "48h — next 15 Sep" | Wired as "Why not" sentence | `blocked_reason` (the eligibility sentence carries the days) |
| Phone | Wired | `phone` |
| Plan / Fee / Term / Expires / Joined | Wired | `contract_type`, `monthly_fee`, `renewal_fee`, `auto_renew`, `expiry_date`, `tenure_days` |
| Freezes "1 (Aug 25, 1mo)" | Cut | no freeze history per member exists |
| Added: Needs a person, Last visit, Before that (habit), Cohort, Asked to cancel, Conversation # | Wired | `human_followup`, signals, `cohort`, `attempt_number` |
| Call now | Wired | `POST /api/call` (server re-checks eligibility) |
| Snooze 7d | Cut | no snooze exists |
| Exclude / Re-include | Cut | no manual override exists; the About mockup's "and override it" claim is removed too |
| Hand to Dan | Cut | no hand-off/assignment exists |
| Footer rows / monthly at risk / avg tenure | Wired | computed over visible due rows |
| Nav: Members count 498 | Wired | `counts.total` |
| Nav: Call log, Numbers, Settings | Cut | no page behind them; the call log lives in each row's expansion |
| Gym switcher (old dashboard) | Removed | out of scope per PASS_THREE; calls go out as the default gym |
| Old "What this costs" panel | Moved to Overview → Today's queue | `campaignEconomics` |
| Old "Calls placed" columns | Folded into row expansion | same records |
| Old "Cancellation requests" table | Folded into rows (badge, Asked to cancel field, Why now/Why not) | same entries |
| Refresh | Kept | router.refresh + /api/call-records |

### 2. Analytics / Overview: `/intelligence` (mockup `Analytics.dc.html`)

| Mockup element | Outcome | Source / reason |
|---|---|---|
| Header title | Wired | `listGyms()` default gym's `gym_name` |
| Gym listing notice (extra) | Wired | `listGyms().notice`; lead text depends on `source` |
| Header eyebrow "Overview" | Wired | static label |
| "Agent live" pill + clock | Cut | nothing on the page is live |
| "Data through …" | Wired | HeaderPill from `data.as_of` |
| Layout toggle A/B | Cut | presentation only; I used the Sections layout |
| Theme toggle | Kept | shared `AppShell` |
| Refresh button | Added | PASS_THREE; `router.refresh()` |
| Section heads + subs | Wired | static text; the Why sub uses `calls.with_a_stated_reason` / `conversations` |
| KPI Active members + sub | Wired | `membership.active`, `auto_renewing_active`; fixed-term is the difference |
| KPI MRR | Wired | `membership.mrr`; delta cut |
| KPI Revenue / member | Wired | `membership.arpm`; delta cut |
| KPI 90-day retention + tooltip | Wired | `ninety_day.rate/retained/measured/joined_from/joined_to`, `NINETY_DAY_MARK_DAYS`; "vs Q2" cut |
| KPI Monthly churn | Wired | latest `months[]` entry with `to_date` false; "since Apr" cut |
| KPI Visits / member / wk + tooltip | Wired | last `attendance` week: `per_member`, `visits ÷ members`; delta cut |
| Busy heatmap cells + titles | Wired | `busyness.by_hour`; hours = span with visits |
| Heatmap window | Wired | `busyness.weeks` (12) |
| Heatmap weekday totals | Wired | row sums of `by_hour` |
| Heatmap legend | Kept | intensity scale only, no numbers |
| Peak note + ringed cells | Wired | `busyness.busiest` |
| "Quietest 2–3pm" | Cut | not computed in lib |
| Monthly churn line | Wired | complete `months[]` |
| Month to date | Wired as text | `to_date` month, not plotted |
| Visits / member / week bars | Wired | 12 `attendance` windows |
| How members use the gym + tooltips + note | Wired | `segments` counts and `thresholds`; the four-week window is described from lib code |
| Fixed terms ending tiles + note | Wired | `expiring.within_14/30/90`; the auto-renew nonsense is cut |
| Revenue at risk rows | Wired | `revenue_at_risk` for 4 call types |
| Revenue at risk totals | Wired, split in two | "Still paying" (renewal + reengagement + cancellation) and "Lapsed, recoverable" (winback) |
| In members' own words | Wired | `why_they_leave.themes`, all 5 states |
| Per-theme quotes, trends | Cut | not stored |
| Real quotes | Wired | `data.quotes` |
| Why members leave bars | Wired | `why_they_leave.overall` + `reasonLabel`; "all calls"; empty state "Nothing here yet" |
| Reasons over time | Cut | not computed; slot holds `by_call_type` / `by_cohort` / `by_tenure_band` |
| Call outcomes | Wired | `outcomes.overall` + `outcomeText`, `WINNING_OUTCOMES`; window cut |
| Offers made / accepted / links (extra) | Wired | `offers` |
| Dials line (extra) | Wired | `calls.*` |
| Sentiment | Wired | `sentiment` tally; % only from those counts; "vs Aug" cut |
| Guardrails on live calls (extra) | Wired | `live_criteria` scored/passed; unscored = `calls.completed − scored` |
| Today's queue calls / cost | Wired | `economics.calls`, `total_cost` |
| Today's queue per type | Wired | `revenue_at_risk[type].members` |
| Per call, saved member, break-even, one-in-N, saves needed | Wired | `cost_per_call`, `average_retained_value`, `retained_months`, `break_even_conversion`, `break_even_saves` |
| Assumptions disclosure | Wired | `economics.assumptions` |
| "78 seconds average", "cost to date" | Cut | not computed |
| Expected at the desk (extra) | Wired | `commitments` |
| Needs a person (extra) | Wired | `follow_ups` |
| Notices | Wired | `db_error` (lists what is empty), `members_error`, `history_error`, `activity_notice`, `themes.notice`, gym listing `notice` |
| Nav member count | Not shown | `Intelligence` has no member total |

No panel is labelled "not built".

### 3. Setup / Voice agent: `/onboarding`, `/onboarding/[gymId]/edit`, `/onboarding/[gymId]/members` (mockup `Setup.dc.html`)

| Mockup panel / element | Outcome | Source / reason |
|---|---|---|
| Header title | Wired | Gym name when editing, "Retention Router" for a new gym, the saved gym's name on the confirmation; on member data, `resolveGym().gym_name`. |
| Header "Agent live — calling from what's below" pill | Cut | Nothing is live. |
| Header "Last saved 11 Sep by Dan" | Cut | No audit trail exists. |
| Header save state | Wired | Edit: field-by-field comparison with the stored gym ("N unsaved changes" / "No unsaved changes"). New: "Nothing entered yet" / "Not saved yet". Also shows saving, "Not saved", and "Saving is off here" (`ONBOARDING_WRITES`). |
| Header Save button | Wired | Existing POST/PATCH save via `form="gym-form"`; `aria-disabled` when saving is off. |
| "Start from a document" card, drop zone, Choose a file | Wired | Existing drag/drop and file input; size limit from `MAX_UPLOAD_BYTES`. |
| Card status (nothing read / reading X / read X) | Wired | Document state and the file actually read. |
| "Use the sample price list" button | Cut | Wiring it honestly means serving a sample PDF publicly and running the real extraction on it; not done this pass. The samples now live in `evals/documents/pdf/`. |
| Upload / Read / Extract / Check stages | Wired | `DocumentReader`, driven by the real requests (bytes, pages and characters, model and seconds, count backed by the document). The fake 55% bar is replaced by the existing sweep. |
| "N filled, M left for you" + "Clear and start over" | Wired | `review.summary`. Clearing asks for confirmation and now also resets the form's state. |
| "The gym's details" card | Wired | The real typed fields; the mockup's free-text perk and lapsed-offer inputs are cut. |
| "N of M optional fields filled" | Wired | `isDraftBlank` over the optional fields. |
| Per-field chip (from document / set / blank / nothing) | Wired | The draft plus `FieldOutcome`. |
| Blank-means-what lines | Wired | `fieldSpec().whenBlank`. |
| Renewal discount range hint | Wired | `RENEWAL_DISCOUNT_MIN` / `RENEWAL_DISCOUNT_MAX`. |
| Provenance quote | Wired | `FieldOutcome.quote` plus file name. |
| Mockup "page 3 · Renewals" location | Cut | No page or section data exists. |
| "Couldn't support this" warning + "Use X" | Wired | `unsupported`: reason, quote, suggestion. The "Use X" button now works again from the second document on. `rejected` shows "Not used from the document". |
| Warning's "Leave blank" button | Cut | An unsupported value is already left blank, so the button would do nothing. |
| "Offer limits" rows | Wired | Real `OfferScheduleField`. The pill comes from `scheduleRowState` in `draftSchedule`'s order: choose both / not configured — ignored / never offered / ready. The cheaper membership adds "except cancellations". |
| Offer limits dropdown option "a freeze" | Cut | The freeze isn't in `SCHEDULABLE_OFFERS`, and `scheduleKey` returns null for it: it is only carried by the cancellation call, which has no limits. |
| Offer limits explanatory copy | Wired | Worded from `evaluateOffers`: limits and the habit rule, with the cancellation exemption stated. |
| Offer limits header count | Wired | "nothing configured" or "N of M offers limited". |
| "Member data" card on a new gym | Labelled | Uploads need a saved gym; lists existing gyms with Edit / Member data links. "The queue calls as this gym" comes from `default_gym_id`. |
| Member data card on edit | Wired | Link to the gym's member data page. |
| CSV rows on `/onboarding/[gymId]/members` | Wired | Real `MemberImport`; counts and line-numbered problems only appear after a real preview. |
| Badges "validated just now" / "not uploaded" | Wired | Replaced by each upload slot's real phase. |
| Mockup "read in 0.4s", KB sizes | Cut | The import route doesn't return them. |
| Mockup "re-upload any time, the newest wins" | Cut | Contracts and check-ins are insert-only in `memberStore.ts`, so "newest wins" is false. |
| "Direct connections" | Labelled not built | `lib/connectors.ts`: real members/contracts/check-ins mappings, auto-renew detail and "Needs"; the mockup's invented chips are cut. |
| "What the agent will say" | Wired | The four `previewDraft` blocks: tint, audience, checked/failed pill, offers line, violations. The mockup's invented script is cut. |
| Pulsing "live" dot | Cut | Replaced by the words "rewritten as you type". |
| "Left out because you haven't said" | Wired | A fixed mapping from each call type to the fields its block reads (`incentiveSentenceIds`); quiet times only counts in the one winback branch that reads it. |
| "Offer cadence" | Wired | Offers the answers configure, each with its schedule row (every X / never / no limit / not chosen yet). The cheaper membership adds "not on cancellations". The ignored-row note only counts rows with both choices made. |
| "Facts Charlie may state" (not in mockup) | Kept, wired | `preview.facts` (`compileGymFacts`). |
| Saved confirmation | Wired | Real compiled blocks. Copy qualified for withheld offers. "Gym switcher" is gone; the queue gym comes from `default_gym_id`. |
| Members page "In Supabase now", router tally, nightly recompute | Wired | `memberDataCounts`, `routeMember`, `latestRun`. |
| Mockup nav counts, Call log / Numbers / Settings | Not mine | Shared shell. |

### 4. Evals: `/evals` (mockup `Evals.dc.html`)

The Inconclusive row state is added. Its tooltip reads exactly "The call was cut off mid-turn." It is read from each result's `inconclusive` flag. The latest run is 28/31 with 1 inconclusive, so the score line says so, and an agent tile turns red only for a real fail.

| Mockup element | Outcome | Source / reason |
|---|---|---|
| Header title and eyebrow | Wired | "Retention Router" / "Evals" |
| "Read the thinking" | Wired | Link to `/about` |
| Sidebar, theme toggle | Wired | Shared AppShell |
| Intro heading and paragraph | Wired | First run's score from the earliest bundled run file (10/15). "Three real defects, two bad assertions" from README. The note that failures are committed is kept. `evals/README.md` shown as plain text. |
| "Run suite" button | Cut | Must not run a paid suite. Shows `npm run evals` instead; tooltip count from `calls.total`. |
| Running progress bar, "Suite failed to start" | Cut | Nothing runs |
| "Filter: failures" | Wired | Browser filter over logic checks and test calls: fails and inconclusive |
| Agent select | Wired | `conversations.by_agent` keys |
| Run ID and time | Wired | Stamp from `latest.run_at`, UTC time; label on hover |
| "Copy run ID" | Wired | Copies the stamp; shows "Copy blocked" if the clipboard refuses |
| "Download results" | Wired | Server action returns the committed latest.json |
| "80 logic checks" title and badge | Wired | `latest.guards.total` / `.passed` |
| Logic-check groups | Wired | `groups.ts` titles; counts and pass state counted at render; unlisted ids go to "Other checks" (1 today) |
| Logic-check rows | Wired, expandable | `why`, `detail` and id |
| "Run the suite to see results" empty state | Replaced | "Every logic check passed…" when the filter leaves nothing |
| "31 test calls" title and score | Wired | 28 / 31 and "1 inconclusive", from `conversations` |
| Test-call subtitle | Rewritten | Matches evals/README: regex checks, one judged condition each |
| Agent tiles | Wired | `by_agent`; red only for a real fail; inconclusive count shown; click filters |
| Test-call rows (Pass / Fail / Inconclusive) | Wired | `passed` and `inconclusive`; tooltip exactly "The call was cut off mid-turn." |
| "Open transcript" | Wired | Expansion with real turns, local assertions, and the judge condition with rationale. The judge badge shows Inconclusive on inconclusive rows. |
| "The score moves" bars | Wired | Every bundled run file (11). Height is passed/total, fraction printed, date and full label under each, inconclusive count shown, brackets by suite size. |
| Mockup subtitle "nothing changed between them" | Replaced | False; now a true, computed subtitle |
| "Show logic checks" toggle | Wired | Each run's real guard score, including the 18/19 run |
| Mockup footer "80/80 throughout" | Replaced | Computed: the one short run and the 19 → 20 → 80 count |
| Leak quote "What the member heard" | Wired | Verbatim turn found in run 1's file (`renewal-price-only-on-request`) |
| Second leak quote | Added, wired | "as per step 5" turn found in run 5's file |
| "One call in eight", "a prompt reduced it, a model change removed it" | Wired (cited) | README "Conversation LLM" row; citation corrected |
| "Fixed — asserted on every call" chip | Wired | Shown only when the check is on 31/31 latest scenarios and passes 31/31 |
| "Since" line | Wired | Counted from the run files |
| Price-list rows | Wired | Real `sanitizeExtraction` over the committed extraction and bundled text. The sanitiser's reasons show as visible text. |
| "Buried line" subtitle | Wired | Injected sentence taken from the document |
| Price-list closing line | Wired | Real counts (6 filled, 4 blank, 1 held back, 0 rejected) plus the computed "model ignored the injected line" sentence |
| Price-list logic checks | Added, wired | Worst-case guard first, details visible; `pdf-documents-keep-their-facts` second |
| "Read the document" toggle | Added, wired | The bundled document text |
| "We deleted our best number" | Static, sourced | README "The withdrawn accuracy number" |
| "Still broken" rows | Wired | Latest non-passes, each linking to its row. Owners from PASS_TWO_REPORT addendum §4: Platform, Suite, Suite. The Platform tooltip is corrected. |
| "Still broken" untested risk | Added | "The riskiest thing left, revised": Agent / Untested |
| Mockup "Still broken" placeholder rows | Cut | Placeholder issues |
| "Nothing outstanding" empty state | Cut | The untested risk is always listed |
| Live/blink animations | Cut | No realtime anything |

### 5. About: `/about` (mockup `About.dc.html`)

| Panel / element | Outcome | Source / reason |
|---|---|---|
| Header: title "Retention Router", eyebrow "About", "See the evals" → /evals, "Open the product" → / | Wired | `AppShell` props and links as specified |
| Header theme toggle | Wired | `AppShell`'s own toggle |
| Shell chrome: "Ironworks" brand, Overview / Call queue / Voice agent / Evals / About nav, "‹ Collapse" | Handled by the shared shell | Comes from `components/shell/AppShell.tsx`, not this screen; wired or cut there. This page only passes `current="about"` and `memberCount` |
| Nav: Members count | Wired | `counts.total` (500) |
| Nav: Call log, Numbers, Settings | Cut | No pages behind them; the shared shell leaves them out |
| History warning | Wired, now at the top of the article | Shown when `view.history_error` is set; covers every number on the page |
| Opening paragraph (the "gym with 1,200 members, one person on the front desk" anecdote) | Rewritten | README ~43–45 describes front desks in general; the invented specifics are gone |
| "Spent a week with the data" | Rewritten | Unsourced; now "looked hard at who those calls would reach" |
| Competitors | Wired to README ~57–61 | Keepme Score, PredictStay and Glofox At Risk predict. Replify runs outbound calls. Antares runs text, chat and email, not calls |
| "Point either at this data…" | Wired | `counts.excluded_auto_renew` (129) and `auto_renewers_inside_expiry_window` (60) |
| "A call is not free" | Rewritten to README line 51 | Includes "risks" and "sleeping dogs" |
| Pull quote (accent-ink) | Kept | Describes the product; `callType.ts` checks auto-renew before anything else |
| "145 of 500 never called" | Wired | 129 of 500 (`excluded_auto_renew`, `counts.total`) |
| Auto-renewers who asked to cancel | Wired | Entries with `auto_renew && cancellation_requested` (16): at most one call, only if the gym has a freeze or a cheaper plan (`eligibility.ts`) |
| Reasons members are held back | Wired | The six real buckets with live counts: auto-renew 129, asked us to stop 0, nothing to offer 0, **cooling off or waiting to redial 6** (label fixed), attempt limit 0, not due 226. "Billing dispute" and "and override it" removed |
| "Four conversations, not one" heading and sentence | Wired | `ABOUT_CALL_TYPES.length` |
| Four call-type descriptions | Wired to the prompts | The list uses `ABOUT_CALL_TYPES`. Text is consistent with `callTypeBlurb`, the four `goal.md` files, the winback windows and PASS_TWO. "Hands anything unresolved to a person" removed: the cancellation goal doesn't support it |
| Gym config paragraph | Rewritten | CLAUDE.md rules (no model writes prompt text, blank stays blank); "whether classes need booking" removed |
| "Forty-one cents" heading and arithmetic | Wired | `economics`: $0.41 per call; $485 per saved member; six months from `retained_months`; 139 members due a call; break-even 0.084%; about 1,200 calls per save from 1 ÷ `break_even_conversion`, rounded to tens. A separate message shows when nobody is due a call |
| "Six things, not configurable" list | Wired | Checked against `shared/guardrails.md`, `cancellation/goal.md` and `eligibility.ts`; the injury rule reworded to match the guardrail |
| "Three of them are among the checks that still fail" | Replaced with computed results | Per-rule results from `latest.json` (13 Sep 2026 run): AI 2/2, stop calling 3/3, no guilt "no eval checks it yet", injury 0/1 (only the judge failed it), invents nothing 2/2, cancellation 4/4. Missing ids are now shown, and a cut-off call shows as "Inconclusive" |
| "The one we get asked about most" | Rewritten | Unsourced; now "The last one matters most." |
| Team heading, four photos and names | Wired | Names from the mockup; photos in `public/team/`; heading from `TEAM.length` |
| "Built at a hackathon… nobody has run a gym…" | Cut | Unsourced; replaced with a true line that everything above is in the repository |
| Closing links | Wired | /evals and / |

## Files moved

Organised, not deleted. Every reference that named a moved file was updated.

| From | To |
|---|---|
| `PASS_ONE.md`, `PASS_TWO.md`, `PASS_THREE.md` (were untracked) | `docs/build-log/` |
| `PASS_ONE_REPORT.md`, `PASS_TWO_REPORT.md` | `docs/build-log/` |
| `CONFLICTS.md`, `MERGE_PLAN.md`, `FEATURES_AND_DECISIONS.md` | `docs/build-log/` |
| `ONBOARDING_PLAN.md`, `ONBOARDING_REPORT.md` | `docs/build-log/` |
| `charlie_spec.md`, `charlie_build_brief.md` | `docs/build-log/` |
| `Claude outputs/retention-router-checklist.md` | `docs/build-log/retention-router-checklist.md` (the empty folder is gone) |
| `DESIGN.md`, `PRODUCT.md` | `docs/design/` (design context. `DESIGN.md` describes the old dark-only look, and the index says so) |
| `FULL HTML MOCKUP/` (was untracked) | `docs/design/mockups/` |
| `sample-price-list.pdf`, `sample-membership-agreement.pdf`, `adversarial-price-list.pdf` (were untracked) | `evals/documents/pdf/`, beside the extraction output that names each one as its `source` |

**New**
- `docs/build-log/README.md`: the index, every plan and report in order.
- This report, at `docs/build-log/PASS_THREE_REPORT.md`, next to the plan it answers.

**Stayed at the root:** `README.md`, `REVIEW_NOTES.md`, `CLAUDE.md` and `AGENTS.md`. LIMITATIONS is a section of `README.md`, not a file.

**References updated**
- `README.md`: the further-reading link now points to the build log, and the repo-map line for `docs/`.
- `REVIEW_NOTES.md`: links to `MERGE_PLAN`, `ONBOARDING_REPORT`, `PASS_ONE_REPORT` and `PASS_TWO_REPORT`.
- `evals/README.md`: two report paths.
- `components/evals/attribution.ts`: the source line shown on the evals page.
- `CLAUDE.md`: a short "Screens" paragraph, including where the build log lives.

**Other config changes**
- `.gitignore` gained `supabase/.temp/`, the Supabase CLI's scratch folder.
- `eslint.config.mjs` now ignores `docs/design/mockups/**`. The design tool's `support.js` isn't this project's code.
- A new `.gitattributes` marks `*.pdf` and `*.png` as binary, so line-ending conversion can't touch the committed sample PDFs.
- `.gitignore` also leaves out `docs/design/mockups/uploads/`: two raw headshot uploads from the design tool that no mockup references. They stay on disk. The cropped team photos the mockup and the About page use are committed.

Nothing a guard, script or `package.json` command imports was moved. Guards were re-run after the moves: 80/80.

**Kept, as the plan asked**
- Every eval result: all 11 conversation runs and the extraction runs in `evals/results/`.
- The three sample PDFs, and the adversarial fixture (`evals/documents/`).

## Files deleted

Each was checked as unreferenced before it went. The dead-code agent built an import graph from every page, route, `package.json` script and config file, found no other unreachable file, and grepped each candidate across the repo.

**Replaced by the new screens** (nothing imports them any more)
- `components/Dashboard.tsx`
- `components/CancellationRequests.tsx`, a pass-one PLACEHOLDER
- `components/Nav.tsx`
- `components/Avatar.tsx`
- `components/EconomicsPanel.tsx`; its content is now the overview's Today's queue card

**Dead before this pass**
- `components/TranscriptPanel.tsx`: imported by nothing since the dashboard stopped using it. It was the source of the two lint errors every earlier report listed.
- `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`: the create-next-app defaults, referenced by nothing.

**Dead because of this pass:** in `lib/labels.ts`, `outcomeStyle`, `callTypeStyle` and `outcomeClass`. These were Tailwind class strings in the old dark palette, used only by the deleted dashboard. No function's behaviour changed.

**Found dead but not deleted.** These are zero-reference exports that predate this pass. They are left for someone who knows whether they're meant as API:
- `routeMembers` (`lib/callType.ts`)
- `COOLDOWN_RULES` (`lib/eligibility.ts`)
- `emptyGymFields` (`lib/gymConfig.ts`)
- `SLOTS` (`lib/incentives.ts`)

**PLACEHOLDER comments removed** from all five pass-one components. Three were rewritten, one was deleted, and two were restyled in place:
- `GymHealth.tsx` and `ReasonThemes.tsx`: rewritten on the overview.
- `CancellationRequests.tsx`: deleted (see above).
- `OfferScheduleField.tsx` and `OtherOfferFields.tsx`: restyled on setup.

## `lib/` headers

All 42 `lib/` files now open with a two-line header:

```
/**
 * Owns: <what this file is the single source of>.
 * Not here: <the nearest thing a reader would expect here, and the file it's actually in>.
 */
```

A reviewer checked each header against the code and its neighbours, and corrected three:
- **`callRecords.ts`**: it doesn't own every read of `call_records`, because `callHistory.ts` reads the table too.
- **`clock.ts`**: `build_scores.py` writes the date to `pipeline/output/`, and `copy-pipeline-output.mjs` copies it into `data/`.
- **`gymStore.ts`**: the seed also stands in for a listing when the table can't be read, never for a call's lookup.

`git diff -U0 lib/` shows 42 files, each with one block of comment lines added at line 1 and no line removed. The only other `lib/` change is the three deletions above.

## Where I was tempted to hardcode, and what happened instead

**Calls**
- **"Called" count and progress bar:** the mockup's "14 called" and progress bar needed a "done today" count that nothing keeps. The stat is "Dialled", meaning members with a call on record, and the bar is cut.
- **Call duration:** the mockup's "94s" could have been `completed_at − created_at`, but that includes ringing and webhook delay. It's cut.
- **"Visits 14d":** no 14-day window exists, so the column is the real `visit_count_90d`.
- **Trend arrows:** they would have needed a threshold no `lib/` function defines. Cut.
- **Excluded footer:** a first version counted the rows inside collapsed buckets as "shown". It now counts only the rows actually on screen.

**Analytics** (from the screen's final report)
- **Deltas** ("+$820 vs Aug", "since Apr", "vs Q2"): cut rather than computed from `months[]`.
- **Churn KPI:** uses the last complete month; the month to date is text only.
- **Revenue at risk:** two sums, not one mixed total.
- **Sentiment:** shows the honest "0% · 0 of 3".
- **"78 seconds" and "cost to date":** cut; call length appears only as its `ASSUMPTIONS` entry.
- **Quietest hour:** cut, since lib doesn't compute a minimum.
- **Heatmap window:** from `busyness.weeks`, not the mockup's 8.
- **Guardrails footnote:** the old "same three criteria as the suite" was false and is replaced by lib's own wording. I could have shown one "N of M scored" figure, but scored counts can differ per criterion, so each row shows its own unscored count.
- **Retention tooltip:** "day 120" comes from `NINETY_DAY_MARK_DAYS`.
- **Four-week habit window:** kept as text describing lib, because `WINDOW_4WK` isn't exported.

**Setup**
- **"of 11 backed by the document":** computed as `Object.keys(review.outcomes).length`.
- **Upload limit:** from `MAX_UPLOAD_BYTES`, not the mockup's 20MB or the old 10 MB.
- **Filled-count total:** computed from the field list, not the mockup's "of 10".
- **Offer limit states:** from `scheduleRowState`, now in `draftSchedule`'s order.
- **Which offer ignores limits on cancellation calls:** there is no lib export naming it. It is one component constant, `UNLIMITED_ON_CANCELLATION`, taken from `evaluateOffers` (no limits on cancellation calls) and the cancellation branch of `incentiveSentenceIds`, whose only schedulable offer is the cheaper tier. A new constant in lib would be cleaner, but lib is off-limits.
- **Renewal discount range:** interpolated from lib (new this round).
- **Offer-name word cap:** the number is dropped rather than copied, because it isn't exported and lib is off-limits.
- **CSV counts and timings, stage notes:** only real results after a real upload or read.
- **Unsaved changes:** a field-by-field comparison, not an invented number.
- **Queue gym on the saved screen:** from `default_gym_id`.

**Evals**
- **Run history:** an explicit list of 11 JSON imports would have been simplest. I used a glob, so the page can't silently miss a run added later.
- **Document text:** pasting it into a `.ts` constant would have worked, but it would drift from the fixture. The text import bundles the committed `.txt` itself.
- **"The model ignored the injected line":** writing it as fixed copy was tempting. It's shown only when the computed flag is true.
- **"31" in the tooltip:** now `data.calls.total`.
- **Guard groups:** rather than squeeze the schema-limit guard under a claim it doesn't back, I left it in "Other checks".
- **Older items:** the history bars, the "80/80 throughout" footer, the leak chip and its "since" count, the price-list counts, the owners and the run ID were all already computed after the earlier round, and they still are.

**About**
- **$473, 0.09%, 1,200:** these come from the `economics` fields; calls per save is computed from `break_even_conversion`.
- **145 and 67 (README's numbers):** the page uses `excluded_auto_renew` and `auto_renewers_inside_expiry_window` instead.
- **"Four", "Six", "Forty-one", "Four of us":**
  - "Four conversations" is spelled out from `ABOUT_CALL_TYPES`; the second hand-typed list is gone.
  - "Six" and "Four of us" come from `COMMITMENTS` and `TEAM`.
  - "Forty-one" is the cost per call in cents, rounded.
- **Pass/fail per rule:** read from `latest.json`. A missing id is now shown, not dropped.
- **"Six more months" and the run date:** read from `retained_months` and `run_at`.
- **The cooling-off wording:** it had described the 90-day rule only. It now matches both branches in `eligibility.ts`.

## Verification log

| Check | Result |
|---|---|
| `npm run evals:guards` | 80/80 after each of the six commits |
| `scenario-payloads-are-pinned` | passes |
| `npx tsx scripts/snapshot-scenario-payloads.ts --check` | 31 scenario payloads match the snapshot (as of 2026-09-12) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (0 problems) |
| `npx next build` | compiles; 25 routes including `/about` |
| `npm run data:verify-port` | `lib/memberData.ts` reproduces `build_scores.py` for all 500 members |
| `npm run gyms:seed-check` | matches (2 gyms) |
| Agent prompts, `agents:sync`, full `npm run evals` | untouched, not run, not run |
| Browser check before each commit | `/`, `/intelligence`, `/onboarding`, `/onboarding/southbank/edit`, `/evals`, `/about` looked at in the running dev server. The Calls row expansion was checked with a real call record (Scott Gordon: transcript, outcome, "Needs a person"). The Calls page was also checked at 1024px wide. |

## Things to know

- **Local clock skew.** On this machine, Supabase refused some reads with "JWT issued at future", because the local clock is ahead. When it happened, the queue and overview showed their history-error notices and empty call sections. That is the honest state rather than a bug, but a demo recorded on a machine with a correct clock will show the real call records.
- **Transcript evidence was checked live.** The Calls expansion, outcome, reason and follow-up were confirmed against a real call record in the dev server. The overview's call sections were only ever seen empty, because of the clock skew above. The render guard covers them with fixtures at 0, 5 and 12 reasons.
- **Setup: not clicked through.**
  - A save was never made against the real database; it would write a real row.
  - The form reset between two documents is covered by the typecheck only.
- **Evals bundling.** `components/evals/data.ts` bundles every committed run file with Turbopack's `import.meta.glob`, and the adversarial document with a text import. That is Turbopack-only, which is Next 16's default for dev and build. `next build` passed with it. A run file committed later is picked up on the next build without editing an import list.
- **Figures differ from README.** The README still quotes 145 auto-renewers never called, 67 inside the renewal window and $473 per saved member. The About page now computes 129, 60 and about $482–485 (the last moves with call history). The README rewrite is the next pass, as `PASS_THREE.md` says.
- **Would be cleaner in `lib/`, left alone because `lib/` was out of bounds:**
  - `buildIntelligence` returning its gym listing, so the overview reads it once;
  - exporting the four-week habit window (`WINDOW_4WK`) and the offer-name word cap;
  - a label for the `"callback"` outcome value that appears in real records;
  - a constant naming the offer a cancellation call carries regardless of the schedule.
