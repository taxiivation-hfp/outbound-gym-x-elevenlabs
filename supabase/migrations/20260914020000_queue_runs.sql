-- The nightly recompute's record.
--
-- Once a day `/api/cron/recompute` routes every member against the clock and
-- writes what it found here: when it ran, the date it measured from, whether
-- that date was the wall clock or the synthetic dataset's frozen one, where the
-- members came from, and each member's result.
--
-- This is a record, not an input. The call route never reads it: it re-reads
-- the member and re-checks eligibility at dial time, so a stale snapshot cannot
-- produce a wrong call. Insert-only, like the rest of the history in this
-- schema. Idempotent: safe to re-run.

create table if not exists queue_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  as_of date not null,
  clock text not null check (clock in ('live', 'frozen')),
  member_source text not null check (member_source in ('dataset', 'supabase')),
  gym_id text,
  counts jsonb not null,
  -- Set when call history couldn't be read (do-not-contact and cooldowns were
  -- then not applied to the counts), or when the entries didn't all write.
  history_error text
);

create table if not exists queue_run_entries (
  run_id uuid not null references queue_runs (id) on delete cascade,
  member_id text not null,
  call_type text check (call_type is null or call_type in ('renewal', 'reengagement', 'winback')),
  blocked_by text,
  reason text,
  primary key (run_id, member_id)
);

create index if not exists queue_runs_ran_at_idx on queue_runs (ran_at desc);

alter table queue_runs enable row level security;
alter table queue_run_entries enable row level security;
