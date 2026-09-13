/**
 * Turns an ElevenLabs conversation payload — `data` from a `post_call_transcription`
 * webhook, or the body of `GET /v1/convai/conversations/{id}` once its `status`
 * is `"done"` — into the `call_records` patch. Both shapes carry the same
 * `transcript` array and `analysis` object, so the extraction lives once here
 * and is used by the webhook (`app/api/webhook/route.ts`) and by
 * `lib/reconcileStaleCalls.ts`, which asks ElevenLabs directly for a call that
 * never got a webhook.
 *
 * The field names mirror `DATA_COLLECTION` in `scripts/agentConfig.mjs` exactly
 * — if one is renamed there, this is the other place to change.
 */

interface TranscriptTurn {
  role?: string;
  message?: string;
}

export function extractTranscript(data: { transcript?: unknown }): string | null {
  if (!Array.isArray(data.transcript)) return null;
  return (data.transcript as TranscriptTurn[])
    .map((t) => `${t.role ?? "?"}: ${t.message ?? ""}`)
    .join("\n");
}

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

export function buildCompletedPatch(data: {
  transcript?: unknown;
  analysis?: Record<string, unknown>;
}): Record<string, unknown> {
  const analysis = data.analysis ?? {};
  const collected = analysis.data_collection_results as Results;
  const criteria = analysis.evaluation_criteria_results as
    | Record<string, CriteriaResult>
    | undefined;

  return {
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
  };
}
