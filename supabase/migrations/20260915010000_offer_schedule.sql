-- Offer schedules: how often each offer may be made to the same member.
--
-- A gym could already say what it offers; this is how often. Each configured
-- offer gets its own period ("every quarter, allow the guest pass"), stored as
-- typed data — a JSON object from a fixed offer list to a fixed period list —
-- and enforced in lib/eligibility.ts before the incentives block is compiled.
-- An offer inside its cooldown is compiled as though the gym didn't have it.
-- Null means no schedule: every offer behaves as it did before this column.
--
-- `call_records.offers_available` is what the compiled block granted on that
-- call, written by /api/call before dialling. The cooldowns are measured from
-- the conversations where an offer was made; a record without this column
-- counts every offer its call type can carry, which can only lengthen a
-- cooldown. send_text only texts an offer this list contains.
--
-- Requires 20260914000000_create_gyms.sql and the call_records migrations.
-- Idempotent: safe to re-run.

alter table gyms add column if not exists offer_schedule jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gyms_offer_schedule_shape') then
    alter table gyms add constraint gyms_offer_schedule_shape check (
      offer_schedule is null
      or (
        jsonb_typeof(offer_schedule) = 'object'
        and offer_schedule - array['renewal_discount', 'guest_pass', 'free_session', 'free_pt_session', 'cheaper_tier'] = '{}'::jsonb
        and not jsonb_path_exists(
          offer_schedule,
          '$.* ? (@ != "monthly" && @ != "quarterly" && @ != "twice_yearly" && @ != "yearly" && @ != "never")'
        )
      )
    );
  end if;
end $$;

comment on column gyms.offer_schedule is
  'Offer -> period (monthly, quarterly, twice_yearly, yearly, never). Null: no schedule. Enforced before the incentives block is compiled; never reaches a prompt.';

alter table call_records add column if not exists offers_available text[];

comment on column call_records.offers_available is
  'The offers the compiled incentives block granted on this call, after the offer schedule and habit gate. Written by /api/call.';
