import type { CallType } from "@/lib/callType";
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

/**
 * Columns added after the analysis migration. A deployment one migration behind
 * loses only these, not the gym, call type and attempt number the analysis
 * migration added.
 */
const LATER_COLUMNS = ["offers_available"];

function stripLater(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !LATER_COLUMNS.includes(k)));
}

export async function insertCallRecord(row: Row) {
  const { error } = await supabaseAdmin.from("call_records").insert(row);
  if (!error || !isUnknownColumn(error)) return { error };

  if (LATER_COLUMNS.some((k) => k in row)) {
    const withoutLater = await supabaseAdmin.from("call_records").insert(stripLater(row));
    if (!withoutLater.error || !isUnknownColumn(withoutLater.error)) {
      console.warn(
        "call_records has no offers_available column — apply supabase/migrations/20260915010000_offer_schedule.sql. " +
          "This call's offers weren't recorded, so the next call's cooldowns count every offer its call type can carry."
      );
      return { error: withoutLater.error, degraded: true as const };
    }
  }

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
 * Every call record, newest first, as the intelligence page and the nightly
 * recompute read them. `select("*")` for the same reason as call history: a
 * column one migration behind shouldn't turn a report into an error.
 */
export async function readAllCallRows<T = Record<string, unknown>>(): Promise<{ rows: T[]; error: string | null }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("call_records")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []) as T[], error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** A call placed this long ago can no longer be the one asking to send a text. */
const RECENT_CALL_WINDOW_MS = 30 * 60 * 1000;

/**
 * The gym a member's in-progress call was placed for.
 *
 * The agent's `send_text` tool knows the member, not the gym, and the tool
 * config lives on ElevenLabs. `/api/call` writes `gym_id` on the call record
 * before the phone rings, so the most recent record for this member — placed in
 * the last half hour — is the call the agent is on.
 */
export async function gymOfRecentCall(
  memberId: string
): Promise<{ ok: true; gymId: string; callType: CallType | null; offersAvailable: string[] | null } | { ok: false; error: string }> {
  try {
    // Wall clock, not lib/clock.ts: call records are stamped with real time.
    const since = new Date(Date.now() - RECENT_CALL_WINDOW_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from("call_records")
      // Every column: offers_available arrives in a later migration, and naming
      // it here would refuse every text on a deployment without it.
      .select("*")
      .eq("member_id", memberId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));
    if (error) return { ok: false, error: `call record read failed: ${error.message}` };
    const row = data?.[0] as { gym_id?: string | null; call_type?: string | null; offers_available?: unknown } | undefined;
    const gymId = row?.gym_id;
    if (typeof gymId !== "string" || gymId.trim() === "") {
      return { ok: false, error: "no call placed to this member in the last 30 minutes records a gym" };
    }
    const callType =
      row?.call_type === "renewal" || row?.call_type === "reengagement" || row?.call_type === "winback" || row?.call_type === "cancellation"
        ? row.call_type
        : null;
    const offersAvailable = Array.isArray(row?.offers_available) ? (row.offers_available as unknown[]).filter((o): o is string => typeof o === "string") : null;
    return { ok: true, gymId, callType, offersAvailable };
  } catch (err) {
    return { ok: false, error: `call record read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
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
