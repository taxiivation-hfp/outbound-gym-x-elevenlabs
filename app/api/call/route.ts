import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCallHistory, type CallHistory } from "@/lib/callHistory";
import type { CallType } from "@/lib/callType";
import { today } from "@/lib/clock";
import { compileVariables, GymConfigError } from "@/lib/compileVariables";
import { IncentivesValidationError } from "@/lib/validateIncentives";
import { parseTestNumber, resolveDialTarget, withTestNumber } from "@/lib/dialSafety";
import { callRefusal } from "@/lib/callGate";
import { evaluateEligibility, evaluateOffers, scheduleKey, withholdOffers } from "@/lib/eligibility";
import { resolveGym } from "@/lib/gymStore";
import { compileIncentives, grantedOffers } from "@/lib/incentives";
import { insertCallRecord } from "@/lib/callRecords";
import { gymForMember, loadMember, type MemberSource } from "@/lib/memberSource";

/** One agent per call type. Created by `scripts/sync-agents.mjs`. */
const AGENT_ID_ENV: Record<CallType, string> = {
  renewal: "ELEVENLABS_AGENT_ID_RENEWAL",
  reengagement: "ELEVENLABS_AGENT_ID_REENGAGEMENT",
  winback: "ELEVENLABS_AGENT_ID_WINBACK",
  cancellation: "ELEVENLABS_AGENT_ID_CANCELLATION",
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
  // The sidebar's test number, if one was typed. Blank means CALL_OVERRIDE_NUMBER stands.
  const testNumber = parseTestNumber(body?.test_number);
  if (!testNumber.ok) {
    return NextResponse.json({ error: "Refusing to dial", reason: testNumber.reason, blocked_by: "test_number" }, { status: 400 });
  }
  const dialEnv = withTestNumber(testNumber.number);

  // Read the member now, not from whatever the queue showed. The queue was
  // computed when the page rendered; since then a member can have renewed,
  // switched to auto-renew or walked in, and an uploaded export is re-derived on
  // every read. Eligibility below is decided on this read alone.
  let member;
  let source: MemberSource;
  try {
    const loaded = await loadMember(memberId);
    member = loaded.member;
    source = loaded.source;
    if (!member && loaded.unroutedReason) {
      return NextResponse.json({ error: "Member can't be routed", reason: loaded.unroutedReason }, { status: 409 });
    }
  } catch (err) {
    console.error("Refusing to call: member data unreadable", err);
    return NextResponse.json(
      { error: `Member data couldn't be read, so the call was not placed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
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
  const refusal = callRefusal(eligibility);
  if (refusal || !eligibility.routing.call_type) {
    return NextResponse.json(refusal?.body ?? { error: "Member is not eligible for an outbound call" }, { status: 403 });
  }

  const callType = eligibility.routing.call_type;

  // Which gym's rules the agent speaks for. Read from the gyms table (or the
  // seed before its migration), and an id that resolves to nothing is refused:
  // substituting another gym would put that gym's offers in this gym's mouth.
  if (body?.gym_id !== undefined && body?.gym_id !== null && typeof body.gym_id !== "string") {
    return NextResponse.json({ error: "gym_id must be a string" }, { status: 400 });
  }
  // An uploaded member can only be called as the gym they were uploaded for.
  const gymChoice = gymForMember(source, body?.gym_id ?? null);
  if (!gymChoice.ok) {
    return NextResponse.json({ error: "Refusing to call", reason: gymChoice.reason, blocked_by: "gym_mismatch" }, { status: 409 });
  }
  const gymLookup = await resolveGym(gymChoice.gymId);
  if (!gymLookup.ok) {
    return NextResponse.json({ error: gymLookup.error, blocked_by: "gym_config" }, { status: gymLookup.status });
  }
  const gym = gymLookup.gym;

  // The one gate that needs the gym rather than the member or the database: a
  // cancellation call is placed only when this gym has a freeze or a cheaper
  // tier to put on the table. Evaluated again with the gym in hand so the
  // refusal comes from the same function the queue used, not a second rule.
  const gated = evaluateEligibility(member, history, today(), gym);
  const gateRefusal = callRefusal(gated);
  if (gateRefusal) {
    return NextResponse.json(gateRefusal.body, { status: gateRefusal.status });
  }

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

  // The compiler re-validates the gym and the incentives block it writes on
  // every compile. A failure here means the agent would have been told
  // something the config doesn't back, so nothing is dialled.
  // Which of the gym's offers this member may be given today: the habit gate
  // and each offer's own cooldown, from the same call history as eligibility.
  // A withheld offer is compiled as though the gym didn't have it.
  const offers = evaluateOffers(member, history, gym.offer_schedule, callType);
  let dynamicVariables: Record<string, string>;
  let offersAvailable: string[];
  try {
    dynamicVariables = compileVariables({
      member,
      gym,
      routing: eligibility.routing,
      callType,
      attemptNumber: eligibility.attemptNumber,
      priorCall: history.priorCall,
      offers,
    });
    // Recorded on the call so the next call's cooldowns know which offers this
    // block carried, and so send_text only texts an offer the agent was given.
    offersAvailable = grantedOffers(compileIncentives(withholdOffers(gym, offers), callType))
      .map((offer) => scheduleKey(offer, callType))
      .filter((key): key is NonNullable<typeof key> => key !== null);
  } catch (err) {
    if (err instanceof IncentivesValidationError) {
      return NextResponse.json(
        {
          error: `The ${err.callType} incentives for this gym failed validation, so the call was not placed.`,
          blocked_by: "incentives_validation",
          violations: err.violations,
        },
        { status: 422 }
      );
    }
    if (err instanceof GymConfigError) {
      return NextResponse.json(
        { error: "This gym's config failed validation, so the call was not placed.", blocked_by: "gym_config", errors: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }

  // The last check before a phone rings. Every number in this dataset is Faker
  // output — well-formed, and belonging to a stranger — so the route refuses to
  // dial it unless an override number is set or someone has deliberately opted
  // in. Nothing about the routing changes, only the last hop.
  if (!member.phone.trim() && !dialEnv.CALL_OVERRIDE_NUMBER?.trim()) {
    return NextResponse.json(
      { error: "Refusing to dial", reason: "There is no mobile number on file for this member.", blocked_by: "no_number" },
      { status: 409 }
    );
  }
  const dial = resolveDialTarget(member.phone, source, dialEnv);
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
  } catch (err) {
    console.error(`ElevenLabs outbound call (${callType}) did not reach ElevenLabs:`, err);
    return NextResponse.json(
      { error: "Failed to reach ElevenLabs", details: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // Read the body as text first: a non-JSON error page would otherwise parse to
  // null and the reason would be lost.
  const rawBody = await elevenLabsResponse.text().catch((err) => `<unreadable body: ${String(err)}>`);
  let result: { success?: boolean; conversation_id?: string } | null = null;
  try {
    result = JSON.parse(rawBody);
  } catch {
    result = null;
  }
  // ElevenLabs answers with HTTP 200 even when the call never left the ground —
  // a stale Twilio credential on the imported number, for instance, comes back
  // as `{ success: false, message: "..." }` inside a 200. Checking only
  // `.ok` would tell the dashboard "placed" for a call that was never dialled.
  if (!elevenLabsResponse.ok || result?.success === false) {
    console.error(
      `ElevenLabs outbound call (${callType}, agent ${AGENT_ID_ENV[callType]}) failed: HTTP ${elevenLabsResponse.status}`,
      rawBody
    );
    return NextResponse.json(
      {
        error: "ElevenLabs call failed",
        call_type: callType,
        elevenlabs_status: elevenLabsResponse.status,
        details: result ?? rawBody,
      },
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
    offers_available: offersAvailable,
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
    offers_available: offersAvailable,
    offers_withheld: offers.withheld,
    // Echoed back so the dashboard can show exactly what the agent was told.
    dynamic_variables: dynamicVariables,
  });
}
