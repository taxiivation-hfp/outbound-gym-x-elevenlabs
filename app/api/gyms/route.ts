import { NextResponse } from "next/server";
import { DEFAULT_GYM_ID, gyms } from "@/lib/gyms";

/**
 * The gyms the dashboard can switch between, including the incentive text each
 * one gives the agent. Shown in full rather than as a name and an id: what the
 * gym is allowed to put on the table is the most consequential thing in this
 * config, and an operator should be able to read it before switching.
 */
export function GET() {
  return NextResponse.json({ default_gym_id: DEFAULT_GYM_ID, gyms });
}
