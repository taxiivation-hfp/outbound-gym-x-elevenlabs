import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Writes to `call_records` that survive the migration not having run yet.
 *
 * `supabase/migrations/20260913120000_call_records_analysis.sql` adds the
 * analysis columns. Until someone applies it, an insert naming those columns
 * fails with PostgREST's "column does not exist", and the call has already been
 * placed by then — losing the row would mean losing the attempt count and the
 * do-not-contact flag the next call depends on.
 *
 * So: try the full row, and if the schema is behind, retry with only the columns
 * that predate the migration and say loudly what is missing. This fallback is
 * temporary scaffolding and should be deleted once the migration is applied
 * everywhere.
 */

/** PostgREST: unknown column in the payload / undefined column in SQL. */
const UNKNOWN_COLUMN_CODES = new Set(["PGRST204", "42703"]);

const PRE_MIGRATION_COLUMNS = new Set([
  "id",
  "member_id",
  "member_name",
  "conversation_id",
  "status",
  "transcript",
  "outcome",
  "created_at",
]);

type Row = Record<string, unknown>;

function stripToLegacy(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => PRE_MIGRATION_COLUMNS.has(k)));
}

function isUnknownColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && UNKNOWN_COLUMN_CODES.has(error.code)) return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

export async function insertCallRecord(row: Row) {
  const { error } = await supabaseAdmin.from("call_records").insert(row);
  if (!error || !isUnknownColumn(error)) return { error };

  console.warn(
    "call_records is missing the analysis columns — apply " +
      "supabase/migrations/20260913120000_call_records_analysis.sql. " +
      "Writing the legacy subset so the attempt count and do-not-contact flag survive."
  );
  const retry = await supabaseAdmin.from("call_records").insert(stripToLegacy(row));
  return { error: retry.error, degraded: true as const };
}

export async function updateCallRecordByConversation(conversationId: string, patch: Row) {
  const { error } = await supabaseAdmin
    .from("call_records")
    .update(patch)
    .eq("conversation_id", conversationId);
  if (!error || !isUnknownColumn(error)) return { error };

  console.warn(
    "call_records is missing the analysis columns — apply " +
      "supabase/migrations/20260913120000_call_records_analysis.sql. " +
      "Saving the transcript and outcome only; the rest of this call's analysis is lost."
  );
  const retry = await supabaseAdmin
    .from("call_records")
    .update(stripToLegacy(patch))
    .eq("conversation_id", conversationId);
  return { error: retry.error, degraded: true as const };
}

/**
 * For a row that never got a `conversation_id` at all — ElevenLabs refused the
 * dial before a conversation existed to key on. `updateCallRecordByConversation`
 * can't reach it (`.eq("conversation_id", null)` never matches in Postgres), so
 * this updates by the row's own id instead.
 */
export async function updateCallRecordById(id: string, patch: Row) {
  const { error } = await supabaseAdmin.from("call_records").update(patch).eq("id", id);
  if (!error || !isUnknownColumn(error)) return { error };

  console.warn(
    "call_records is missing the analysis columns — apply " +
      "supabase/migrations/20260913120000_call_records_analysis.sql. " +
      "Saving the transcript and outcome only; the rest of this call's analysis is lost."
  );
  const retry = await supabaseAdmin
    .from("call_records")
    .update(stripToLegacy(patch))
    .eq("id", id);
  return { error: retry.error, degraded: true as const };
}
