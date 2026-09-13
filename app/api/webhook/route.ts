import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildCompletedPatch } from "@/lib/callAnalysis";
import { updateCallRecordByConversation } from "@/lib/callRecords";

// ElevenLabs' docs only document the SDK helper (elevenlabs.webhooks.constructEvent)
// and don't publish the raw scheme, so this is reimplemented from
// @elevenlabs/elevenlabs-js's shipped source (wrapper/webhooks.js), not guessed:
// header "elevenlabs-signature" = "t=<unix_seconds>,v0=<hex hmac>", signed
// message is "${timestamp}.${rawBody}", HMAC-SHA256, 30-minute tolerance.
function verifySignature(rawBody: string, sigHeader: string | null, secret: string): boolean {
  if (!sigHeader) return false;

  const parts = sigHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v0="));
  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.slice(2);
  const reqTimestampMs = Number(timestamp) * 1000;
  if (Number.isNaN(reqTimestampMs)) return false;
  if (reqTimestampMs < Date.now() - 30 * 60 * 1000) return false; // older than 30 min

  const expected = "v0=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  const a = Buffer.from(signaturePart);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const sigHeader = req.headers.get("elevenlabs-signature");

  if (!secret || !verifySignature(rawBody, sigHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const data = event.data ?? {};
  const conversationId: string | undefined = data.conversation_id;

  // A dial that never connected. Without this branch the row sits at
  // "initiated" forever and cannot be told apart from a call in progress, which
  // is also what stops the attempt count from being meaningful.
  if (event.type === "call_initiation_failure") {
    if (!conversationId) return NextResponse.json({ received: true });
    const { error } = await updateCallRecordByConversation(conversationId, {
      status: "failed",
      reached_member: false,
      completed_at: new Date().toISOString(),
      analysis: { event_type: event.type, data },
    });
    if (error) console.error("Failed to mark call failed:", error);
    return NextResponse.json({ received: true });
  }

  if (event.type !== "post_call_transcription") {
    // Ack the rest (post_call_audio, …) without acting on them.
    return NextResponse.json({ received: true });
  }

  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversation_id" }, { status: 400 });
  }

  const { error } = await updateCallRecordByConversation(
    conversationId,
    buildCompletedPatch(data)
  );

  if (error) {
    console.error("Failed to update call_records:", error);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
