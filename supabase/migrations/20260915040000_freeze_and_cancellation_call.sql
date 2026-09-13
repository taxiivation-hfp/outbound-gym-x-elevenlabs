-- The membership freeze, and the fourth call type.
--
-- A gym can offer a member who has asked to cancel a pause instead of an exit:
-- the membership freezes for up to `freeze_max_weeks` weeks at
-- `freeze_weekly_fee` a week. Both or neither, like the cheaper tier. A fee of
-- 0 is a free freeze and is valid; null is no freeze at all, which is a
-- different thing — a gym with neither a freeze nor a cheaper tier does not
-- call a member who has asked to cancel, because there would be nothing to
-- offer them. The check mirrors lib/gymConfig.ts's parser.
--
-- `queue_run_entries.call_type` gains 'cancellation': the one call an
-- auto-renewing member ever gets, and only once they have asked to cancel.
-- lib/callType.ts routes it; lib/eligibility.ts caps it at one conversation.
--
-- Requires 20260914000000_create_gyms.sql and 20260914020000_queue_runs.sql.
-- Idempotent: safe to re-run.

alter table gyms add column if not exists freeze_max_weeks integer;
alter table gyms add column if not exists freeze_weekly_fee numeric(5, 2);

alter table gyms drop constraint if exists gyms_freeze_complete;
alter table gyms add constraint gyms_freeze_complete check (
  (freeze_max_weeks is null) = (freeze_weekly_fee is null)
  and (freeze_max_weeks is null or freeze_max_weeks between 1 and 26)
  and (freeze_weekly_fee is null or (freeze_weekly_fee >= 0 and freeze_weekly_fee <= 50))
);

comment on column gyms.freeze_max_weeks is
  'Longest membership pause the gym allows, in weeks (1-26). Null: no freeze is offered. Set together with freeze_weekly_fee.';
comment on column gyms.freeze_weekly_fee is
  'Dollars a week while frozen, 0-50. 0 is a free freeze. Null: no freeze is offered.';

alter table queue_run_entries drop constraint if exists queue_run_entries_call_type_check;
alter table queue_run_entries add constraint queue_run_entries_call_type_check
  check (call_type is null or call_type in ('renewal', 'reengagement', 'winback', 'cancellation'));
