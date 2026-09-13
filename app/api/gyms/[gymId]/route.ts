import { NextRequest, NextResponse } from "next/server";
import { editGym } from "@/lib/gymWrites";

/**
 * PATCH: edit an existing gym from the prefilled onboarding form.
 *
 * The same body as saving a new gym (the typed fields and the offer schedule)
 * and the same parse, compile and validate path (lib/gymWrites.ts); the only
 * difference is that it replaces this gym's config instead of inserting one.
 * It never creates a gym, and the id and how the gym was created don't change.
 * Refused unless ONBOARDING_WRITES=enabled, like every onboarding write.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const body = await req.json().catch(() => null);
  const result = await editGym(gymId, body);
  return NextResponse.json(result.body, { status: result.status });
}
