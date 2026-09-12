import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import membersData from "@/data/members_scored.json";
import type { Member } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const members = membersData as Member[];

const GYM_NAME = process.env.GYM_NAME ?? "the gym";

// The agent's prompt expects a plain number ("about 3 times a week"), not a
// formatted rate string like "3.1x/week".
function formatOldRate(oldRate: number): string {
  return String(Math.round(oldRate));
}

function formatTenure(tenureDays: number): string {
  if (tenureDays < 14) {
    return `${tenureDays} day${tenureDays === 1 ? "" : "s"}`;
  }
  if (tenureDays < 60) {
    const weeks = Math.round(tenureDays / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.round(tenureDays / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const memberId = body?.member_id;

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  }

  // Resolve the member from the authoritative dataset rather than trusting
  // whatever the client sent — this is what actually enforces "who not to
  // call" as a real constraint, not just a UI convention.
  const member = members.find((m) => m.member_id === memberId);
  if (!member) {
    return NextResponse.json({ error: "Unknown member_id" }, { status: 404 });
  }
  if (member.channel !== "ai_call" || !member.last_visit || !member.expiry || !member.offer) {
    return NextResponse.json(
      { error: "Member is not eligible for an outbound call" },
      { status: 403 }
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) {
    return NextResponse.json({ error: "ElevenLabs env vars not configured" }, { status: 500 });
  }

  const dynamicVariables = {
    gym_name: GYM_NAME,
    member_name: member.name,
    expiry_date: member.expiry,
    last_visit: member.last_visit,
    old_rate: formatOldRate(member.signals.old_rate),
    tenure: formatTenure(member.signals.tenure_days),
    offer: member.offer,
  };

  let elevenLabsResponse: Response;
  try {
    elevenLabsResponse = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: phoneNumberId,
          to_number: member.phone,
          conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
        }),
      }
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach ElevenLabs" }, { status: 502 });
  }

  const result = await elevenLabsResponse.json().catch(() => null);
  if (!elevenLabsResponse.ok) {
    return NextResponse.json(
      { error: "ElevenLabs call failed", details: result },
      { status: 502 }
    );
  }

  const conversationId: string | undefined = result?.conversation_id;

  const { error: dbError } = await supabaseAdmin.from("call_records").insert({
    id: randomUUID(),
    member_id: member.member_id,
    member_name: member.name,
    conversation_id: conversationId ?? null,
    status: "initiated",
    transcript: null,
    outcome: null,
    reason_for_leaving: null,
    created_at: new Date().toISOString(),
  });

  if (dbError) {
    // The call already went out — a bookkeeping failure shouldn't look like
    // a failed call to the caller, but it must not be silent either.
    console.error("Failed to write call_records row:", dbError);
  }

  return NextResponse.json({ conversation_id: conversationId, status: "initiated" });
}
