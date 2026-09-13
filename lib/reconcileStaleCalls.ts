/**
 * Owns: settling call_records rows stuck "initiated" past ten minutes, by asking ElevenLabs directly.
 * Not here: the normal completion path is the webhook (app/api/webhook/route.ts);
 * row writes are in lib/callRecords.ts.
 */
import { buildCompletedPatch } from "@/lib/callAnalysis";
import { updateCallRecordByConversation, updateCallRecordById } from "@/lib/callRecords";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * A `call_records` row only ever leaves `status: "initiated"` when a webhook
 * arrives keyed on its `conversation_id` (see `app/api/webhook/route.ts`). Two
 * things break that:
 *
 * - ElevenLabs never assigned a `conversation_id` at all — the dial failed
 *   before a conversation existed (the bug fixed in `app/api/call/route.ts`
 *   that let a `success: false` response still write an "initiated" row).
 *   There is no webhook coming for a conversation that never started.
 * - A webhook that ElevenLabs never sent, or that never reached us.
 *
 * Either way the row is stuck showing "In progress" forever. Real calls here
 * run seconds to a few minutes, so anything still "initiated" after this long
 * can no longer plausibly still be ringing — it's asked about directly instead
 * of waited on.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

interface StaleRow {
  id: string;
  conversation_id: string | null;
}

export async function reconcileStaleCalls(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("call_records")
    .select("id, conversation_id")
    .in("member_id", memberIds)
    .eq("status", "initiated")
    .lt("created_at", cutoff);

  if (error || !data || data.length === 0) return;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  await Promise.all((data as StaleRow[]).map((row) => reconcileOne(row, apiKey)));
}

async function reconcileOne(row: StaleRow, apiKey: string | undefined): Promise<void> {
  if (!row.conversation_id) {
    await updateCallRecordById(row.id, {
      status: "failed",
      reached_member: false,
      completed_at: new Date().toISOString(),
      analysis: { event_type: "reconciled_no_conversation_id" },
    });
    return;
  }

  if (!apiKey) return;

  let response: Response;
  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${row.conversation_id}`,
      { headers: { "xi-api-key": apiKey } }
    );
  } catch {
    return; // Network hiccup — leave it for the next read rather than guess.
  }

  if (response.status === 404) {
    await updateCallRecordByConversation(row.conversation_id, {
      status: "failed",
      reached_member: false,
      completed_at: new Date().toISOString(),
      analysis: { event_type: "reconciled_not_found" },
    });
    return;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) return;

  if (data.status === "done") {
    await updateCallRecordByConversation(row.conversation_id, buildCompletedPatch(data));
    return;
  }

  // Still genuinely active per ElevenLabs (e.g. "processing" right after the
  // call ends but before analysis runs) — leave it for the webhook or the next
  // stale check rather than guess at an outcome mid-flight.
}
