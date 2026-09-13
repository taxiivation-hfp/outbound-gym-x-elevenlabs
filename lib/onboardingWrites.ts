/**
 * Whether onboarding may write: save a gym, import member data.
 *
 * Neither route has a login — nothing in this app does — and both write the
 * facts calls are decided on: a gym's offers, and which members are on
 * auto-renew and what their numbers are. Applying the migrations must not be
 * what switches that on for anyone who can reach the URL. So writes are off
 * until a deployment deliberately sets `ONBOARDING_WRITES=enabled`, which
 * REVIEW_NOTES.md says to do only once access protection is in front of it —
 * the same shape as `dialSafety.ts`: a refusal in code, not a step to remember.
 */
export const ONBOARDING_WRITES_OFF =
  "Onboarding writes are switched off on this deployment. Set ONBOARDING_WRITES=enabled once access protection is in front of it — these routes have no login.";

export function onboardingWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ONBOARDING_WRITES?.trim() === "enabled";
}
