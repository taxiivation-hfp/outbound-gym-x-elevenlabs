import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
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

/**
 * The mirror of `lib/compileVariables.ts`: the agent's field names become
 * columns here, and nowhere else. The names match `DATA_COLLECTION` in
 * `scripts/agentConfig.mjs` exactly, because that file is what configures them
 * on the agents — if one is renamed there, this is the one other place to change.
 */
interface DataCollectionEntry {
  value?: unknown;
  rationale?: string;
}

type Results = Record<string, DataCollectionEntry | undefined> | undefined;

function rawValue(results: Results, key: string): unknown {
  const entry = results?.[key];
  if (entry == null) return null;
  if (typeof entry === "object" && "value" in entry) return entry.value ?? null;
  return entry;
}

function asText(results: Results, key: string): string | null {
  const value = rawValue(results, key);
  if (value == null) return null;
  const text = String(value).trim();
  // The extraction prompts say "empty string if they didn't say", and an empty
  // string in a column reads as "we asked and got nothing" — null is the truth.
  return text.length === 0 ? null : text;
}

/**
 * Booleans arrive as real booleans when the field is declared boolean, but a
 * model asked for a boolean occasionally answers "true". Both are accepted;
 * anything else stays null rather than being coerced to false, because "we don't
 * know whether they asked us to stop" and "they didn't ask us to stop" are very
 * different facts for a do-not-contact flag.
 */
function asBoolean(results: Results, key: string): boolean | null {
  const value = rawValue(results, key);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "yes") return true;
    if (lower === "false" || lower === "no") return false;
  }
  return null;
}

interface CriteriaResult {
  result?: string;
}

function criteriaResult(
  results: Record<string, CriteriaResult | undefined> | undefined,
  key: string
): string | null {
  return results?.[key]?.result ?? null;
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

  const analysis = data.analysis ?? {};
  const collected = analysis.data_collection_results as Results;
  const criteria = analysis.evaluation_criteria_results as
    | Record<string, CriteriaResult>
    | undefined;

  const { error } = await updateCallRecordByConversation(conversationId, {
    status: "completed",
    completed_at: new Date().toISOString(),
    transcript: extractTranscript(data),

    reached_member: asBoolean(collected, "reached_member"),
    outcome: asText(collected, "outcome"),
    reason_for_absence: asText(collected, "reason_for_absence"),
    reason_detail: asText(collected, "reason_detail"),
    committed_day: asText(collected, "committed_day"),
    offer_made: asBoolean(collected, "offer_made"),
    offer_accepted: asBoolean(collected, "offer_accepted"),
    link_sent: asBoolean(collected, "link_sent"),
    do_not_contact: asBoolean(collected, "do_not_contact"),
    human_followup: asText(collected, "human_followup"),
    sentiment: asText(collected, "sentiment"),

    eval_stuck_to_one_ask: criteriaResult(criteria, "stuck_to_one_ask"),
    eval_invented_nothing: criteriaResult(criteria, "invented_nothing"),
    eval_no_guilt: criteriaResult(criteria, "no_guilt"),

    // Kept whole, so a field added to an agent tomorrow is not lost between then
    // and the migration that gives it a column.
    analysis,
  });

  if (error) {
    console.error("Failed to update call_records:", error);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
