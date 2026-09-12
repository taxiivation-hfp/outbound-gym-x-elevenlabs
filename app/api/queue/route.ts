import { NextResponse } from "next/server";
import { buildQueueView } from "@/lib/queueView";

/**
 * Who is due a call today, who is not, and why — for every member.
 *
 * A thin wrapper over `lib/queueView.ts`, which the dashboard page also calls
 * directly. Kept as an endpoint because it is the quickest way for someone
 * reading the repo to see the routing decisions for all 500 members at once, and
 * because sharing the builder means the screen and the API cannot disagree.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildQueueView());
}
