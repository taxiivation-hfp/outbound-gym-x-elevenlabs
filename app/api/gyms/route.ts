import { NextResponse } from "next/server";
import { listGyms } from "@/lib/gymStore";
import { CALL_TYPES, compileIncentives } from "@/lib/incentives";

/**
 * The gyms the dashboard can switch between: each one's typed config, and the
 * incentive text that config compiles to for each call type. Shown in full
 * rather than as a name and an id: what the gym is allowed to put on the table
 * is the most consequential thing in this config, and an operator should be
 * able to read the exact words before switching.
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
