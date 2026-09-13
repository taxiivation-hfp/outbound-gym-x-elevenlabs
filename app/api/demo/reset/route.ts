import { NextRequest, NextResponse } from "next/server";
import { resetDemoData } from "@/lib/demoReset";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";

/**
 * POST: empty the demo's database rows — gym config (seed gyms included),
 * members, contracts, check-ins, call records and queue runs — so the next
 * person starts at onboarding.
 *
 * POST only, and only with `{ "confirm": "reset" }` in the body, so nothing but
 * the button on the configuration screen sends it: no page load, refresh or
 * prefetch can. It deletes database rows and nothing else; the committed eval
 * run files under evals/ are read by the Our Journey page and are never
 * touched from here.
 *
 * There is no login in front of this, the same as the onboarding writes it
 * undoes, so it is off under the same switch.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!onboardingWritesEnabled()) {
    return NextResponse.json({ error: ONBOARDING_WRITES_OFF }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (body?.confirm !== "reset") {
    return NextResponse.json({ error: 'Send { "confirm": "reset" } to clear the demo data.' }, { status: 400 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so there is nothing to reset." },
      { status: 503 }
    );
  }

  const outcome = await resetDemoData();
  if (!outcome.ok) {
    console.error("Demo reset stopped part-way:", outcome.error, outcome.deleted);
    return NextResponse.json(
      { error: `${outcome.error}. Tables listed under "deleted" were already cleared; pressing reset again finishes the rest.`, deleted: outcome.deleted, missing: outcome.missing },
      { status: outcome.status }
    );
  }
  return NextResponse.json({ reset: true, deleted: outcome.deleted, missing: outcome.missing });
}
