import { NextRequest, NextResponse } from "next/server";
import { MemberStoreError } from "@/lib/memberStore";
import { RecomputeError, runRecompute } from "@/lib/queueRecompute";

/**
 * The nightly queue recompute, called by Vercel Cron (see vercel.json).
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without a CRON_SECRET the
 * route refuses to run at all rather than running for anyone who finds the URL.
 * Every refusal says why, and nothing reports success unless a run was recorded.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set, so the recompute is disabled on this deployment." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  try {
    // Wall-clock time of the run itself; which date the queue is measured from
    // is decided by planRecompute (DATASET_CLOCK), and recorded with the run.
    const result = await runRecompute(new Date());
    return NextResponse.json({ recorded: true, ...result });
  } catch (err) {
    if (err instanceof RecomputeError || err instanceof MemberStoreError) {
      return NextResponse.json({ recorded: false, error: err.message }, { status: err.status });
    }
    console.error("recompute failed", err);
    return NextResponse.json({ recorded: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
