import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Reads through the service-role key server-side — the browser never gets
// direct Supabase access, since we only have a service-role key (no RLS-safe
// anon key configured), and exposing that to the client would bypass RLS
// entirely.
export async function GET(req: NextRequest) {
  const memberIdsParam = req.nextUrl.searchParams.get("member_ids");
  if (!memberIdsParam) {
    return NextResponse.json({ error: "member_ids is required" }, { status: 400 });
  }
  const memberIds = memberIdsParam.split(",").filter(Boolean);
  if (memberIds.length === 0) {
    return NextResponse.json({});
  }

  const { data, error } = await supabaseAdmin
    .from("call_records")
    .select("*")
    .in("member_id", memberIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch call records" }, { status: 500 });
  }

  // One row per member — the most recent, since a member could in principle
  // have been called more than once.
  const latestByMember: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const memberId = (row as { member_id: string }).member_id;
    if (!(memberId in latestByMember)) {
      latestByMember[memberId] = row;
    }
  }

  return NextResponse.json(latestByMember);
}
