-- Member data: members, contracts per term, check-ins.
--
-- Gym config is one half of onboarding; the other is the gym's own member data,
-- uploaded as the CSV exports every platform already produces. Until now the app
-- only knew the synthetic dataset in data/members_scored.json. These tables hold
-- real exports, and lib/memberStore.ts derives the same Member shape the router
-- reads from them, at query time.
--
-- Per-table sync semantics, because the tables change differently:
--
-- * members   — UPSERT on (gym_id, member_id). Phone numbers change; a small
--               table with low churn, so the latest export simply wins.
-- * contracts — INSERT ONLY, one row per term. A renewal is a new row with its
--               own start and end, so a member who renewed at the front desk
--               leaves the renewal queue on the next import instead of being
--               rung about a renewal she already did. Current state is the row
--               with the latest end date. Re-importing the same export inserts
--               nothing (the unique key covers every fact about the term); an
--               export in which a term's facts changed — auto-renew switched on,
--               a price corrected — inserts a new row for that term, and the most
--               recently imported row for the latest term wins.
-- * checkins  — INSERT ONLY, one row per visit. A visit that happened cannot
--               un-happen. days_since_visit is derived from MAX(visited_at) at
--               query time and never stored, and check-ins are never an array on
--               the member record.
--
-- Nothing time-relative is stored: contract status comes from end_date against
-- today, visit counts from timestamps against today. No config column has a
-- default; an absent renewal fee or mobile number stays absent.
--
-- `auto_renew` is NOT NULL with no default, deliberately. It is the one field
-- the whole product rests on: an auto-renewing member is never called. A
-- contract row that does not say whether it auto-renews is rejected at import,
-- never assumed to be fixed-term.
--
-- Requires 20260914000000_create_gyms.sql. Idempotent: safe to re-run.

create table if not exists members (
  gym_id text not null references gyms (gym_id) on delete restrict,
  member_id text not null check (char_length(member_id) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- Null: the export had no number. The call route refuses to dial a member
  -- with no number rather than inventing one.
  mobile text check (mobile is null or char_length(mobile) between 1 and 40),
  join_date date not null,
  first_imported_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  primary key (gym_id, member_id)
);

create table if not exists contracts (
  id bigint generated always as identity primary key,
  gym_id text not null,
  member_id text not null,
  contract_type text not null check (char_length(btrim(contract_type)) between 1 and 60),
  auto_renew boolean not null,
  start_date date not null,
  end_date date not null,
  monthly_fee numeric(8, 2) not null check (monthly_fee >= 0),
  renewal_fee numeric(8, 2) check (renewal_fee is null or renewal_fee >= 0),
  imported_at timestamptz not null default now(),
  constraint contracts_term_order check (end_date >= start_date),
  constraint contracts_member_fk
    foreign key (gym_id, member_id) references members (gym_id, member_id) on delete restrict,
  -- The same term with the same facts is one row, however many times it is
  -- exported. NULLS NOT DISTINCT so two rows with no renewal fee are the same
  -- fact (Postgres 15+), and a plain column list so an import can use
  -- ON CONFLICT DO NOTHING against it.
  constraint contracts_term_facts_uniq unique nulls not distinct
    (gym_id, member_id, start_date, end_date, auto_renew, contract_type, monthly_fee, renewal_fee)
);

create index if not exists contracts_current_idx
  on contracts (gym_id, member_id, end_date desc, imported_at desc, id desc);

create table if not exists checkins (
  gym_id text not null,
  member_id text not null,
  visited_at timestamp not null,
  imported_at timestamptz not null default now(),
  primary key (gym_id, member_id, visited_at),
  constraint checkins_member_fk
    foreign key (gym_id, member_id) references members (gym_id, member_id) on delete restrict
);

comment on column checkins.visited_at is
  'Local gym time, as exported. No time zone is assumed; day-level arithmetic only.';

alter table members enable row level security;
alter table contracts enable row level security;
alter table checkins enable row level security;

-- Which contract is current (latest end date, then latest import) is decided in
-- one place, lib/memberData.ts `currentContract`, which the guards cover. There
-- is deliberately no view duplicating that rule — and no view at all, because a
-- view owned by the migration role would read these tables around row level
-- security.

-- Check-in counts relative to a reference date, with the pipeline's windows
-- (pipeline/build_scores.py). Computed on request, never stored, so the counts
-- are right on whatever day they are asked for.
create or replace function member_visit_counts(p_gym_id text, p_as_of date)
returns table (
  member_id text,
  last_visit_at timestamp,
  visits_last_4wk bigint,
  visits_prior_4wk bigint,
  visits_90d bigint,
  visits_before_4wk bigint
)
language sql
stable
as $$
  select
    c.member_id,
    max(c.visited_at) as last_visit_at,
    count(*) filter (where c.visited_at >= p_as_of::timestamp - interval '28 days') as visits_last_4wk,
    count(*) filter (
      where c.visited_at >= p_as_of::timestamp - interval '56 days'
        and c.visited_at < p_as_of::timestamp - interval '28 days'
    ) as visits_prior_4wk,
    count(*) filter (where c.visited_at >= p_as_of::timestamp - interval '90 days') as visits_90d,
    count(*) filter (where c.visited_at < p_as_of::timestamp - interval '28 days') as visits_before_4wk
  from checkins c
  where c.gym_id = p_gym_id
  group by c.member_id
$$;

-- Member visit history is personal data: only the server's service role may ask.
revoke all on function member_visit_counts(text, date) from public, anon, authenticated;
grant execute on function member_visit_counts(text, date) to service_role;
