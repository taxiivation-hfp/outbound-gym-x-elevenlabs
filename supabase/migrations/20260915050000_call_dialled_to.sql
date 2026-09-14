-- The number a call was actually placed to.
--
-- /api/call dials whatever lib/dialSafety.ts allowed: the sidebar's test
-- number, CALL_OVERRIDE_NUMBER, or the member's own number. Until now nothing
-- recorded which, so the agent's send_text tool, which knows only the member,
-- resolved the number again from the environment and texted the env override
-- while the call had gone to the test number. Writing the dialled number on
-- the call record lets the text go where the call went.
--
-- Requires the call_records migrations. Idempotent: safe to re-run.

alter table call_records add column if not exists dialled_to text;

comment on column call_records.dialled_to is
  'The E.164 number this call was placed to, as lib/dialSafety.ts allowed it. send_text reads it so a text follows the call.';
