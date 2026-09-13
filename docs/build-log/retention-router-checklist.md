# Retention Router — pre-submission checklist

Deadline: Monday 14 Sept, 12:00pm (Melbourne). Do these in order — the order is load-bearing in a few places, not arbitrary.

## 0. Security note
- [ ] A tool error in this session printed your live `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` into the conversation transcript (not into git — just this chat). Not urgent, but if you want to be strict about it, rotate those two and update `.env.local` + Vercel after the hackathon, once nothing else is more urgent.

## 1. Unblock the repo (do not reorder these two)
- [ ] Rotate the Twilio auth token in the Twilio console (Account → API keys & tokens). The old one is compromised — it's in git history from an earlier commit.
- [ ] Put the new Twilio token in `.env.local` and in Vercel.
- [ ] **Only after the above:** flip the GitHub repo to public (Settings → General → Danger Zone → Change visibility). Confirmed as of this session: `github.com/taxiivation-hfp/outbound-gym-x-elevenlabs` still 404s — it is still private. This is the single biggest blocker to your prelim score.
- [ ] While in repo settings: add a one-line description and topics. Thirty seconds, judges see it first.

## 2. Make the app actually work end to end
- [ ] Apply the `call_records` migration: Supabase dashboard → SQL Editor → paste all of `supabase/migrations/20260913120000_call_records_analysis.sql` → Run. (Idempotent — safe to run twice.)
- [ ] Add the six missing environment variables in Vercel (values are in `.env.local`):
  - `ELEVENLABS_AGENT_ID_RENEWAL`
  - `ELEVENLABS_AGENT_ID_REENGAGEMENT`
  - `ELEVENLABS_AGENT_ID_WINBACK`
  - `PUBLIC_BASE_URL`
  - `CALL_OVERRIDE_NUMBER` (double-check this is the right handset before saving)
  - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_SMS_FROM` (post-rotation values)
- [ ] Send one real test SMS to confirm Twilio delivery actually works (never tested — was 3am when it was built). Check AU geo-permissions in Twilio if it fails.
- [ ] Place three real calls, in this order, and confirm each lands correctly in Supabase:
  1. A renewal call — watch the member card fill in, confirm the texted link arrives if taken.
  2. A winback call — say something specific about why you stopped ("did my knee", "the six o'clock crowd"). Without this, `/intelligence` shows an empty state on camera.
  3. A reengagement call — agree to come in on a named day. Confirms the "expected at the desk" panel.
- [ ] Confirm this is the first time the full chain (dashboard button → phone rings → transcript in Supabase) has ever run — treat it as the highest-risk item until it has.

## 3. Two demo beats that need no calls
- [ ] Switch gym in the dashboard header (Southbank → Kensington Barbell), place a renewal call, ask about price — confirm the agent has nothing to offer and says it'll pass it on. Proves "one agent, config per gym" live.
- [ ] Filter `/members` to auto-renew — confirm every row reads "never called," including long-dormant ones. Note the header stat (148 excluded, 72 with a renewal date inside the fortnight).

## 4. Fix the scored-artifact gaps
- [ ] Add a short "existing alternatives" section to `README.md` naming Glofox's built-in churn predictor, GymIQ, Superaxe, PredictStay, Keepme, Hapana — and one line on why the auto-renew exclusion + staff-facing framing is a different bet than a churn-score dashboard. This research already exists; it just isn't in the repo yet.
- [ ] Move `CONFLICTS.md`, `FEATURES_AND_DECISIONS.md`, `MERGE_PLAN.md`, `REVIEW_NOTES.md`, `charlie_build_brief.md`, `charlie_spec.md` into a `docs/process/` subfolder so the repo root isn't nine markdown files deep. Keep `README.md`, `CLAUDE.md`, `AGENTS.md` at root.
- [ ] Confirm `README.md` renders correctly on the GitHub page now that its encoding is fixed (it was UTF-16LE, now UTF-8) — this is the first thing judges read.

## 5. Low-priority, only if time allows
- [ ] `sleeping_dog` cohort still has stale `contact: false` / `action: "do not contact"` fields nothing reads. Harmless but confusing if a judge greps for it — one-line fix.
- [ ] Delete or note the stale `offline-cohort-pipeline` remote branch if it's not needed.

## 6. Before recording the demo video
- [ ] Do not quote a conversion rate or a dollar return on camera — the cost panel deliberately doesn't assume one. Use: "one save in about 1,200 calls pays for the whole run, and today's queue is 173 calls at $70."
- [ ] Script the video to hit: the auto-renew refusal (with a real 403), one full call-to-transcript loop, the gym-switch moment, and the `/evals` page (20/20 guards, 15/15 conversations).
