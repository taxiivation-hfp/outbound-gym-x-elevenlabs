-- Gym health: check-in activity for uploaded members, and the nightly summary
-- of why members say they left.
--
-- 1. Two read functions over `checkins`, so the intelligence page can show a
--    gym's attendance trend and its busiest hours without paging tens of
--    thousands of rows through the API on every render. They compute what
--    `summariseCheckins` in lib/gymHealth.ts computes for the synthetic dataset;
--    `npm run db:verify` checks the two agree. Completed days only, the same
--    windows as `member_visit_counts`: the reference day itself is excluded.
--
-- 2. `queue_runs.reason_themes`. The nightly recompute reads what members said
--    on calls (`call_records.reason_detail`), asks a small model to group it
--    into themes with counts, and stores the result on that night's run. The
--    page reads it from here and never calls a model. It is read-only output for
--    a person to read: nothing that builds a call reads this column.
--
-- Requires 20260914010000_member_data.sql and 20260914020000_queue_runs.sql.
-- Idempotent: safe to re-run.

alter table queue_runs add column if not exists reason_themes jsonb;

comment on column queue_runs.reason_themes is
  'Nightly themed summary of call_records.reason_detail, for the intelligence page only. Never read when building a call.';

-- Visits per seven-day window, 0 = the seven completed days before p_as_of.
create or replace function checkin_weekly(p_gym_id text, p_as_of date)
returns table (weeks_ago integer, visits bigint)
language sql
stable
as $$
  select ((p_as_of - c.visited_at::date - 1) / 7)::integer as weeks_ago, count(*) as visits
  from checkins c
  where c.gym_id = p_gym_id
    and c.visited_at::date < p_as_of
    and c.visited_at::date >= p_as_of - 84
  group by 1
$$;

-- Visits by weekday (Monday = 0) and hour over the twelve weeks before p_as_of.
create or replace function checkin_hourly(p_gym_id text, p_as_of date)
returns table (weekday integer, hour integer, visits bigint)
language sql
stable
as $$
  select
    (extract(isodow from c.visited_at)::integer - 1) as weekday,
    extract(hour from c.visited_at)::integer as hour,
    count(*) as visits
  from checkins c
  where c.gym_id = p_gym_id
    and c.visited_at::date < p_as_of
    and c.visited_at::date >= p_as_of - 84
  group by 1, 2
$$;

revoke all on function checkin_weekly(text, date) from public, anon, authenticated;
revoke all on function checkin_hourly(text, date) from public, anon, authenticated;
grant execute on function checkin_weekly(text, date) to service_role;
grant execute on function checkin_hourly(text, date) to service_role;
