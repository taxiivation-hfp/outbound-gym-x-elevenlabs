import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

interface TranscriptTurn {
  role?: string;
  message?: string;
}

function extractTranscript(data: { transcript?: unknown }): string | null {
  if (!Array.isArray(data.transcript)) return null;
  return (data.transcript as TranscriptTurn[])
    .map((t) => `${t.role ?? "?"}: ${t.message ?? ""}`)
    .join("\n");
}

// Best-effort: these assume the agent has data-collection fields named
// "outcome" and "reason_for_leaving" configured (a reasonable guess given the
// call_records column names, but unverified from this session — no access to
// the live agent's data-collection config). If they aren't configured, these
// just stay null; the transcript is still captured either way.
function extractDataCollectionField(
  results: Record<string, unknown> | undefined,
  key: string
): string | null {
  const entry = results?.[key];
  if (entry == null) return null;
  if (typeof entry === "object" && "value" in (entry as Record<string, unknown>)) {
    const value = (entry as Record<string, unknown>).value;
    return value == null ? null : String(value);
  }
  return String(entry);
}

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const sigHeader = req.headers.get("elevenlabs-signature");

  if (!secret || !verifySignature(rawBody, sigHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.type !== "post_call_transcription") {
    // Ack other event types (post_call_audio, call_initiation_failure, …)
    // without acting on them.
    return NextResponse.json({ received: true });
  }

  const data = event.data ?? {};
  const conversationId: string | undefined = data.conversation_id;
  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversation_id" }, { status: 400 });
  }

  const transcript = extractTranscript(data);
  const dataCollectionResults = data.analysis?.data_collection_results;
  const outcome = extractDataCollectionField(dataCollectionResults, "outcome");
  const reasonForLeaving = extractDataCollectionField(dataCollectionResults, "reason_for_leaving");

  const { error } = await supabaseAdmin
    .from("call_records")
    .update({
      status: "completed",
      transcript,
      outcome,
      reason_for_leaving: reasonForLeaving,
    })
    .eq("conversation_id", conversationId);

  if (error) {
    console.error("Failed to update call_records:", error);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
