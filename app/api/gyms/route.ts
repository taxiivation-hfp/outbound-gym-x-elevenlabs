import { NextRequest, NextResponse } from "next/server";
import { listGyms } from "@/lib/gymStore";
import { createGym } from "@/lib/gymWrites";
import { CALL_TYPES, compileIncentives } from "@/lib/incentives";

/**
 * GET: the gyms the dashboard can switch between — each one's typed config, and
 * the incentive text that config compiles to for each call type. Shown in full
 * rather than as a name and an id: what the gym is allowed to put on the table is
 * the most consequential thing in this config, and an operator should be able to
 * read the exact words before switching.
 *
 * POST: save a gym from the onboarding review screen. The only way a config is
 * saved, whether it was typed by hand or prefilled from a document — so every
 * value a document supplied has been in front of a person first. The fields are
 * parsed again here, as untrusted input, and the three incentives blocks are
 * compiled and validated before anything is written. POST never overwrites a gym
 * that exists; editing is `PATCH /api/gyms/[gymId]`, through the same path
 * (lib/gymWrites.ts).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const listing = await listGyms();
  return NextResponse.json({
    default_gym_id: listing.default_gym_id,
    source: listing.source,
    notice: listing.notice,
    invalid: listing.invalid,
    gyms: listing.gyms.map((gym) => ({
      ...gym,
      incentives: Object.fromEntries(CALL_TYPES.map((t) => [t, compileIncentives(gym, t).text])),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await createGym(body);
  return NextResponse.json(result.body, { status: result.status });
}
