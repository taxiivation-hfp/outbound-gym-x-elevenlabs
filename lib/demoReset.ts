/**
 * Owns: emptying the demo's Supabase tables so the next visitor starts from a first run.
 * Not here: the button and its warning (components/onboarding/DemoReset.tsx), the route
 * (app/api/demo/reset), and anything on disk — evals/ run files are evidence and are never touched.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Every table the demo writes, children before parents, with a column that is
 * never null in it. PostgREST refuses a delete without a filter, so "is not
 * null" on a primary-key column is how "every row" is said. Deleting in this
 * order satisfies the members/contracts/check-ins foreign keys (on delete
 * restrict); queue_run_entries go with their run (on delete cascade).
 *
 * The seed gyms go too. The reset exists to put the app back at the start of
 * its own story — no gym, no members — so the next person onboards one.
 */
export const RESET_TABLES = [
  { table: "checkins", column: "gym_id" },
  { table: "contracts", column: "gym_id" },
  { table: "members", column: "gym_id" },
  { table: "call_records", column: "id" },
  { table: "queue_runs", column: "id" },
  { table: "gyms", column: "gym_id" },
] as const;

export type ResetTable = (typeof RESET_TABLES)[number]["table"];

export type ResetOutcome =
  | { ok: true; deleted: Partial<Record<ResetTable, number>>; missing: ResetTable[] }
  | { ok: false; status: number; error: string; deleted: Partial<Record<ResetTable, number>>; missing: ResetTable[] };

const TIMEOUT_MS = 20_000;

/** PostgREST "table not in schema cache" / Postgres "undefined table". */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

export async function resetDemoData(client: Pick<SupabaseClient, "from"> = supabaseAdmin): Promise<ResetOutcome> {
  const deleted: Partial<Record<ResetTable, number>> = {};
  const missing: ResetTable[] = [];
  for (const { table, column } of RESET_TABLES) {
    let result: { error: { code?: string; message?: string } | null; count: number | null };
    try {
      result = await client
        .from(table)
        .delete({ count: "exact" })
        .not(column, "is", null)
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    } catch (err) {
      return { ok: false, status: 502, error: `Couldn't clear ${table}: ${err instanceof Error ? err.message : String(err)}`, deleted, missing };
    }
    if (result.error) {
      // A table whose migration was never applied has nothing in it to clear.
      if (isMissingTable(result.error)) {
        missing.push(table);
        continue;
      }
      // Stopping here leaves the tables before this one already empty and the
      // rest untouched; pressing reset again finishes the job.
      return { ok: false, status: 502, error: `Couldn't clear ${table}: ${result.error.message ?? "unknown database error"}`, deleted, missing };
    }
    deleted[table] = result.count ?? 0;
  }
  return { ok: true, deleted, missing };
}
