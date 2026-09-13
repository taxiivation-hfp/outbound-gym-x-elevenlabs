-- "Something else": the long tail of offers.
--
-- `reengagement_perk` and `winback_offer` were closed enums, so a gym offering a
-- free protein shake had nowhere to put it. Both gain `other`, with a short
-- label and a delivery (texted as a link, or booked by a person). The label is a
-- noun the compiler splices into one fixed sentence per call type; it is held
-- to lib/textSafety.ts's "offer_label" rules in the app, and to the same
-- characters and length here as the backstop for anything written around it.
--
-- The offer schedule's shape constraint is widened to the two new offer keys.
--
-- Requires 20260914000000_create_gyms.sql and 20260915010000_offer_schedule.sql.
-- Idempotent: safe to re-run.

alter table gyms add column if not exists reengagement_other_label text;
alter table gyms add column if not exists reengagement_other_delivery text;
alter table gyms add column if not exists winback_other_label text;
alter table gyms add column if not exists winback_other_delivery text;

alter table gyms drop constraint if exists gyms_reengagement_perk_check;
alter table gyms drop constraint if exists gyms_winback_offer_check;
alter table gyms drop constraint if exists gyms_other_offers;
alter table gyms drop constraint if exists gyms_offer_schedule_shape;

alter table gyms add constraint gyms_reengagement_perk_check
  check (reengagement_perk is null or reengagement_perk in ('guest_pass', 'free_session', 'other', 'none'));
alter table gyms add constraint gyms_winback_offer_check
  check (winback_offer is null or winback_offer in ('free_pt_session', 'guest_pass', 'other', 'none'));

alter table gyms add constraint gyms_other_offers check (
  -- Label and delivery are set exactly when the choice is "other".
  ((reengagement_perk is not distinct from 'other') = (reengagement_other_label is not null))
  and ((reengagement_perk is not distinct from 'other') = (reengagement_other_delivery is not null))
  and ((winback_offer is not distinct from 'other') = (winback_other_label is not null))
  and ((winback_offer is not distinct from 'other') = (winback_other_delivery is not null))
  and (reengagement_other_delivery is null or reengagement_other_delivery in ('link', 'booking'))
  and (winback_other_delivery is null or winback_other_delivery in ('link', 'booking'))
  and (reengagement_other_label is null or (
    char_length(reengagement_other_label) between 1 and 40
    and reengagement_other_label = normalize(reengagement_other_label, NFKC)
    and reengagement_other_label ~ '^[A-Za-zÀ-ÖØ-öø-ſȘ-ț ''’&-]+$'
  ))
  and (winback_other_label is null or (
    char_length(winback_other_label) between 1 and 40
    and winback_other_label = normalize(winback_other_label, NFKC)
    and winback_other_label ~ '^[A-Za-zÀ-ÖØ-öø-ſȘ-ț ''’&-]+$'
  ))
);

alter table gyms add constraint gyms_offer_schedule_shape check (
  offer_schedule is null
  or (
    jsonb_typeof(offer_schedule) = 'object'
    and offer_schedule - array['renewal_discount', 'guest_pass', 'free_session', 'free_pt_session', 'cheaper_tier', 'reengagement_other', 'winback_other'] = '{}'::jsonb
    and not jsonb_path_exists(
      offer_schedule,
      '$.* ? (@ != "monthly" && @ != "quarterly" && @ != "twice_yearly" && @ != "yearly" && @ != "never")'
    )
  )
);
