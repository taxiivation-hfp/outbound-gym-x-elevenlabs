import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import membersData from "@/data/members_scored.json";
import { getCallHistory, NO_HISTORY, type CallHistory } from "@/lib/callHistory";
import type { CallType } from "@/lib/callType";
import { compileVariables } from "@/lib/compileVariables";
import { resolveDialTarget } from "@/lib/dialSafety";
import { evaluateEligibility } from "@/lib/eligibility";
import { getGym } from "@/lib/gyms";
import { insertCallRecord } from "@/lib/callRecords";
import type { Member } from "@/lib/types";

const members = membersData as Member[];

/** One agent per call type. Created by `scripts/sync-agents.mjs`. */
const AGENT_ID_ENV: Record<CallType, string> = {
  renewal: "ELEVENLABS_AGENT_ID_RENEWAL",
  reengagement: "ELEVENLABS_AGENT_ID_REENGAGEMENT",
  winback: "ELEVENLABS_AGENT_ID_WINBACK",
};

/**
 * Place one outbound call.
 *
 * The client sends a `member_id` and, optionally, which gym's rules to use.
 * Everything else — the member's facts, whether they may be called at all,
 * which agent answers, what it is told — is resolved here. That is what makes
 * "we never call an auto-renewing member" a property of the system rather than
 * a property of the dashboard: a hand-rolled POST for an auto-renewer gets a
 * 403 no matter what it claims about them.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const memberId = body?.member_id;

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  }

  const member = members.find((m) => m.member_id === memberId);
  if (!member) {
    return NextResponse.json({ error: "Unknown member_id" }, { status: 404 });
  }

  // Call history is a gate, not a nicety: it carries do-not-contact and the
  // cooldown. If it cannot be read, refuse rather than dial blind — the cost of
  // a missed call is nothing next to ringing someone who asked us to stop.
  let history: CallHistory;
  try {
    history = await getCallHistory(member.member_id);
  } catch (err) {
    console.error("Refusing to call: call history unreadable", err);
    return NextResponse.json(
      {
        error:
          "Cannot verify call history, so the call was not placed. Do-not-contact " +
          "and the cooldown are enforced from it.",
      },
      { status: 503 }
    );
  }

  const eligibility = evaluateEligibility(member, history);
  if (!eligibility.allowed || !eligibility.routing.call_type) {
    return NextResponse.json(
      {
        error: "Member is not eligible for an outbound call",
        blocked_by: eligibility.blockedBy,
        reason: eligibility.blockedReason,
      },
      { status: 403 }
    );
  }

  const callType = eligibility.routing.call_type;
  const gym = getGym(typeof body?.gym_id === "string" ? body.gym_id : null);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env[AGENT_ID_ENV[callType]];
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) {
    return NextResponse.json(
      {
        error: `ElevenLabs env vars not configured (need ELEVENLABS_API_KEY, ${AGENT_ID_ENV[callType]}, ELEVENLABS_PHONE_NUMBER_ID)`,
      },
      { status: 500 }
    );
  }

  const dynamicVariables = compileVariables({
    member,
    gym,
    routing: eligibility.routing,
    callType,
    attemptNumber: eligibility.attemptNumber,
    priorCall: history.priorCall,
  });

  // The last check before a phone rings. Every number in this dataset is Faker
  // output — well-formed, and belonging to a stranger — so the route refuses to
  // dial it unless an override number is set or someone has deliberately opted
  // in. Nothing about the routing changes, only the last hop.
  const dial = resolveDialTarget(member.phone);
  if (!dial.allowed || !dial.to) {
    return NextResponse.json(
      { error: "Refusing to dial", reason: dial.reason, blocked_by: "unverified_number" },
      { status: 409 }
    );
  }

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
          to_number: dial.to,
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

  // The call has already gone out by now, so a bookkeeping failure is logged
  // rather than reported as a failed call — but it is never swallowed silently.
  const { error: dbError } = await insertCallRecord({
    id: randomUUID(),
    member_id: member.member_id,
    member_name: member.name,
    conversation_id: conversationId ?? null,
    status: "initiated",
    call_type: callType,
    attempt_number: eligibility.attemptNumber,
    gym_id: gym.gym_id,
    transcript: null,
    outcome: null,
    created_at: new Date().toISOString(),
  });
  if (dbError) console.error("Failed to write call_records row:", dbError);

  return NextResponse.json({
    conversation_id: conversationId,
    status: "initiated",
    call_type: callType,
    attempt_number: eligibility.attemptNumber,
    gym_id: gym.gym_id,
    dialled: dial.overridden ? "override number" : "member number",
    // Echoed back so the dashboard can show exactly what the agent was told.
    dynamic_variables: dynamicVariables,
  });
}
