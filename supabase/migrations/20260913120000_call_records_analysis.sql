-- Widen call_records to hold everything a finished call produces.
--
-- Before this migration the table stored three of the eleven data-collection
-- fields the agents extract (`transcript`, `outcome`, `reason_for_leaving`) and
-- nothing about which agent made the call. Eight fields were being discarded
-- on arrival, including the two the product is actually sold on: why the member
-- stopped, in their own words, and which day they said they would come in.
--
-- Two decisions worth recording:
--
-- 1. Typed columns for the eleven fields, not one JSON blob. The webhook helper
--    stringifies whatever it receives, so five booleans would land as the text
--    "true"/"false" and every query against them would need casting. The
--    dashboard aggregates these; they need to be booleans and enums.
-- 2. Plus `analysis jsonb` holding the whole raw analysis object anyway. The
--    typed columns are what we query; the blob is what we keep, so a field
--    added to an agent tomorrow is not lost between then and the migration
--    that gives it a column.
--
-- Idempotent: safe to re-run.

-- `reason_for_leaving` was an unverified guess at the agent's field name, and it
-- is wrong for two of the three call types — a renewal or reengagement member
-- has not left. The agents extract `reason_for_absence`.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'call_records' and column_name = 'reason_for_leaving'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'call_records' and column_name = 'reason_for_absence'
  ) then
    alter table call_records rename column reason_for_leaving to reason_for_absence;
  end if;
end $$;

alter table call_records
  -- Which agent made this call, and which conversation it was. `attempt_number`
  -- counts conversations, not dials: a no-answer does not increment it, which is
  -- why `reached_member` has to be stored rather than inferred.
  add column if not exists call_type        text,
  add column if not exists attempt_number   integer,
  add column if not exists gym_id           text,

  -- The eleven data-collection fields.
  add column if not exists reached_member     boolean,
  add column if not exists reason_for_absence text,
  add column if not exists reason_detail      text,
  add column if not exists committed_day      text,
  add column if not exists offer_made         boolean,
  add column if not exists offer_accepted     boolean,
  add column if not exists link_sent          boolean,
  add column if not exists do_not_contact     boolean,
  add column if not exists human_followup     text,
  add column if not exists sentiment          text,

  -- The three always-on evaluation criteria, as 'success' | 'failure' |
  -- 'unknown'. Rationales stay in `analysis`.
  add column if not exists eval_stuck_to_one_ask text,
  add column if not exists eval_invented_nothing text,
  add column if not exists eval_no_guilt         text,

  -- Everything the webhook sent, verbatim.
  add column if not exists analysis jsonb,

  -- Set when the webhook lands, so "how long did this sit unfinished" is
  -- answerable and a stuck `initiated` row is visible.
  add column if not exists completed_at timestamptz;

-- `outcome` stays free text on purpose. The ten values are an enum on the
-- agent, where they belong; a database constraint here would reject an
-- unexpected extraction instead of recording it, and losing the row is worse
-- than storing a surprising string.
comment on column call_records.outcome is
  'One of: renewed, link_sent, booked, will_return, callback_requested, not_interested, do_not_contact, bad_time, wrong_number, no_answer. Deliberately unconstrained.';

comment on column call_records.do_not_contact is
  'Permanent. Any true row for a member blocks every future call of every type.';

-- The queue asks two questions of this table on every render: what happened on
-- this member''s calls, and which members are blocked.
create index if not exists call_records_member_created_idx
  on call_records (member_id, created_at desc);
create index if not exists call_records_do_not_contact_idx
  on call_records (member_id) where do_not_contact;
