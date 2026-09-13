-- Gym config becomes data.
--
-- Until this table existed, a gym's configuration was `data/gyms.json`, read at
-- build time, and each gym's incentives were hand-written prose. Onboarding
-- needs somewhere to write, and it needs what it writes to be typed values, not
-- prose: an uploaded document may fill in a number, a boolean or an enum, but it
-- must never author a sentence the agent reads. `lib/incentives.ts` writes those
-- sentences from the columns below.
--
-- Decisions worth recording:
--
-- 1. **No column has a default.** Every config column is nullable and null means
--    "the gym did not tell us". A default here would be a plausible value
--    nobody stated, which is the one thing onboarding must never produce.
--    (`created_at` and `created_via` are bookkeeping, not config.)
-- 2. **The checks mirror `lib/gymConfig.ts`.** The app validates first and says
--    why in words; these constraints are the backstop for anything that writes
--    around the app.
-- 3. **There is no incentives column.** The wording is compiled at call time
--    from the typed columns and validated on every compile.
-- 4. **No `renewal_price`.** What renewing costs is per member, from their
--    contract.
-- 5. **Row level security on, no policies.** Only the service-role key the
--    server uses can read or write gym config.
--
-- Idempotent: safe to re-run. Seeds the two original gyms from
-- `data/gyms.json` without overwriting rows that already exist.
-- `npm run gyms:seed-check` fails if the JSON below drifts from that file.

create table if not exists gyms (
  gym_id text primary key
    check (gym_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  gym_name text not null
    check (char_length(btrim(gym_name)) between 1 and 80),

  opening_hours text
    check (opening_hours is null or char_length(opening_hours) between 1 and 120),
  quiet_hours text
    check (quiet_hours is null or char_length(quiet_hours) between 1 and 120),
  -- Null: not stated. Empty array: the gym said it has no other sites. Both
  -- compile to "none".
  other_locations text[]
    check (other_locations is null or cardinality(other_locations) <= 10),
  has_online boolean,
  books_classes boolean,

  renewal_discount_percent integer
    check (renewal_discount_percent is null or renewal_discount_percent between 1 and 50),
  reengagement_perk text
    check (reengagement_perk is null or reengagement_perk in ('guest_pass', 'free_session', 'none')),
  winback_offer text
    check (winback_offer is null or winback_offer in ('free_pt_session', 'guest_pass', 'none')),
  cheaper_tier_name text
    check (cheaper_tier_name is null or char_length(cheaper_tier_name) between 1 and 40),
  cheaper_tier_price numeric(7, 2)
    check (cheaper_tier_price is null or (cheaper_tier_price > 0 and cheaper_tier_price <= 500)),

  -- How this row came to exist: the repo's seed, the questionnaire filled in by
  -- hand, or the questionnaire prefilled from a document and then reviewed.
  -- Every path goes through the review screen; this records which one.
  created_via text not null
    check (created_via in ('seed', 'manual', 'document')),
  created_at timestamptz not null default now(),

  constraint gyms_cheaper_tier_complete
    check ((cheaper_tier_name is null) = (cheaper_tier_price is null)),
  -- The agent reads the site list as one fact, capped like every other fact.
  constraint gyms_other_locations_length
    check (other_locations is null or char_length(array_to_string(other_locations, ', ')) <= 120),
  -- lib/textSafety.ts checks text after NFKC normalisation and stores what it
  -- checked. A row written around the app must hold normalised text too, or a
  -- look-alike character could sit in a prompt unexamined.
  constraint gyms_text_normalised check (
    gym_name = normalize(gym_name, NFKC)
    and (opening_hours is null or opening_hours = normalize(opening_hours, NFKC))
    and (quiet_hours is null or quiet_hours = normalize(quiet_hours, NFKC))
    and (cheaper_tier_name is null or cheaper_tier_name = normalize(cheaper_tier_name, NFKC))
    and (other_locations is null or array_to_string(other_locations, '|') = normalize(array_to_string(other_locations, '|'), NFKC))
  )
);

alter table gyms enable row level security;

comment on table gyms is
  'Typed gym config. Null means the gym did not say. Incentive wording is compiled from these columns by lib/incentives.ts and is never stored.';
comment on column gyms.renewal_discount_percent is
  'Whole percent off a renewal, 1-50. Null: no renewal save exists, and the agent is told so.';
comment on column gyms.quiet_hours is
  'Null: the agent has no quiet times and admits it if asked. Never defaulted.';

-- Seed rows, generated from data/gyms.json.
-- BEGIN SEED (regenerate with: npm run gyms:seed-sql)
insert into gyms (
  gym_id, gym_name, opening_hours, quiet_hours, other_locations, has_online,
  books_classes, renewal_discount_percent, reengagement_perk, winback_offer,
  cheaper_tier_name, cheaper_tier_price, created_via
)
select
  gym_id, gym_name, opening_hours, quiet_hours, other_locations, has_online,
  books_classes, renewal_discount_percent, reengagement_perk, winback_offer,
  cheaper_tier_name, cheaper_tier_price, 'seed'
from jsonb_to_recordset($seed$[
  {
    "gym_id": "southbank",
    "gym_name": "Southbank Strength",
    "opening_hours": "5am to 10pm weekdays, 7am to 7pm weekends",
    "quiet_hours": "weekdays before 8am and after 7pm",
    "other_locations": [
      "Brisbane CBD",
      "Fortitude Valley"
    ],
    "has_online": true,
    "books_classes": true,
    "renewal_discount_percent": 20,
    "reengagement_perk": "guest_pass",
    "winback_offer": "free_pt_session",
    "cheaper_tier_name": "off-peak membership",
    "cheaper_tier_price": 39
  },
  {
    "gym_id": "kensington",
    "gym_name": "Kensington Barbell",
    "opening_hours": "6am to 9pm weekdays, 8am to 2pm Saturdays, closed Sundays",
    "quiet_hours": "weekday mornings before 7am and Saturday afternoons",
    "other_locations": [],
    "has_online": false,
    "books_classes": false,
    "renewal_discount_percent": null,
    "reengagement_perk": "none",
    "winback_offer": "none",
    "cheaper_tier_name": null,
    "cheaper_tier_price": null
  }
]$seed$::jsonb) as seed (
  gym_id text,
  gym_name text,
  opening_hours text,
  quiet_hours text,
  other_locations text[],
  has_online boolean,
  books_classes boolean,
  renewal_discount_percent integer,
  reengagement_perk text,
  winback_offer text,
  cheaper_tier_name text,
  cheaper_tier_price numeric
)
on conflict (gym_id) do nothing;
-- END SEED
