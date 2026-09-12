import { NextResponse } from "next/server";
import { buildIntelligence } from "@/lib/intelligence";

/**
 * Why members leave, who said they're coming in, and what it all costs.
 *
 * A thin wrapper over `lib/intelligence.ts`, which the intelligence page also
 * calls directly.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildIntelligence());
}
