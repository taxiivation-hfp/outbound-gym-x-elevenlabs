-- Cancellation requests: when a member asked to cancel.
--
-- A member who has asked to cancel is the one case where the auto-renew
-- exclusion might one day lift — the reason for it, that a call is the only
-- thing that could end the membership, no longer holds. This migration only
-- stores the fact. Nothing routes on it: lib/callType.ts still excludes every
-- auto-renewing member first, and a guard pins that.
--
-- `cancellation_requested` is local gym time, like `checkins.visited_at`. Null
-- means no request. It comes from the members export: a file with the column
-- sets it for every member in the file (blank cell = no request), and a file
-- without the column means no requests — so a request can only stand while the
-- latest export still says so.
--
-- `import_members` gains a fifth element per row. Same signature, so callers
-- sending four elements store null.
--
-- Requires 20260914010000_member_data.sql. Idempotent: safe to re-run.

alter table members add column if not exists cancellation_requested timestamp;

comment on column members.cancellation_requested is
  'Local gym time the member asked to cancel; null for no request. Shown on the dashboard; nothing routes on it yet.';

create or replace function import_members(p_gym_id text, p_rows jsonb, p_has_mobile boolean)
returns table (inserted bigint, updated bigint)
language sql
as $$
  with incoming as (
    -- [member_id, name, mobile, join_date, cancellation_requested]
    select
      e->>0 as member_id,
      e->>1 as name,
      e->>2 as mobile,
      (e->>3)::date as join_date,
      (e->>4)::timestamp as cancellation_requested
    from jsonb_array_elements(p_rows) as e
  ),
  written as (
    insert into members as m (gym_id, member_id, name, mobile, join_date, cancellation_requested)
    select p_gym_id, i.member_id, i.name, i.mobile, i.join_date, i.cancellation_requested from incoming i
    on conflict (gym_id, member_id) do update
      set name = excluded.name,
          mobile = case when p_has_mobile then excluded.mobile else m.mobile end,
          join_date = excluded.join_date,
          cancellation_requested = excluded.cancellation_requested,
          last_imported_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted), count(*) filter (where not was_inserted) from written
$$;

revoke all on function import_members(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function import_members(text, jsonb, boolean) to service_role;
