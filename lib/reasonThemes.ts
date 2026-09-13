/**
 * Owns: which reason_detail rows count, checking model-returned themes, and reading the stored summary.
 * Not here: the nightly model call that produces the themes lives in lib/reasonThemesSummary.ts.
 */
import type { MemberSource } from "@/lib/memberSource";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Why members say they left, in themes — the reading side.
 *
 * The enum breakdown on the intelligence page says "time: 14". What members
 * actually said is richer than that ("the 6pm crowd", "can't find a park"), and
 * the free-text `reason_detail` each call records is where it lives. Once a
 * night, the recompute has a small model group those sentences into themes
 * with counts (`lib/reasonThemesSummary.ts`) and stores the result on the run.
 * This module decides which rows count, checks what the model returned, and
 * reads the stored result back for the page.
 *
 * **Direction of travel.** Everything else in this product that a model writes
 * is kept away from prompts, because a model must never author what an agent
 * reads. This goes the other way: a model reads what members said and writes
 * for a person looking at a screen. The summary is never read when a call is
 * built — no compiled variable, no incentives block, no prompt — and a guard
 * checks that nothing on the call path imports this module or its column.
 */

/** Below this many stated reasons the page shows the enum breakdown alone. */
export const MIN_REASON_DETAILS = 10;
/** The most recent statements sent to the model. More would not change the themes of a single gym's week. */
export const MAX_REASON_DETAILS = 200;
const MAX_DETAIL_CHARS = 300;
export const MAX_THEMES = 8;
const MAX_THEME_CHARS = 80;

export interface ReasonRow {
  status?: string | null;
  reached_member?: boolean | null;
  outcome?: string | null;
  reason_detail?: string | null;
  created_at?: string | null;
}

/**
 * The member's own words from completed calls that reached them, newest first.
 * The same filter the page uses to decide whether there is enough to summarise,
 * so the page and the nightly run count the same sentences.
 */
export function reasonDetails(rows: ReasonRow[]): string[] {
  return rows
    .filter((r) => r.status === "completed")
    .filter((r) => r.reached_member === true || (r.reached_member == null && Boolean(r.outcome)))
    .filter((r) => typeof r.reason_detail === "string" && r.reason_detail.trim().length > 0)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, MAX_REASON_DETAILS)
    .map((r) => (r.reason_detail as string).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS));
}

export interface ReasonTheme {
  theme: string;
  count: number;
}

export type StoredReasonThemes =
  | { status: "summarised"; model: string; statements: number; themes: ReasonTheme[]; unthemed: number; generated_at: string }
  | { status: "insufficient"; statements: number; generated_at: string }
  | { status: "unavailable"; statements: number; reason: string; generated_at: string };

/**
 * What the model returned, made into something safe to count and display.
 *
 * The model is asked to list which statements belong to each theme, not to
 * state a count, so the counts shown are counted here: every statement number
 * must be real, and a statement already claimed by an earlier theme isn't
 * counted twice. A theme left with fewer than two statements is dropped. Theme
 * names are plain, short and single-line; anything else is refused whole
 * rather than trimmed into shape.
 */
export function checkThemes(raw: unknown, statements: number): { ok: true; themes: ReasonTheme[]; unthemed: number } | { ok: false; reason: string } {
  const list = (raw as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(list)) return { ok: false, reason: "The summary didn't come back as a list of themes." };
  const claimed = new Set<number>();
  const themes: ReasonTheme[] = [];
  for (const entry of list.slice(0, MAX_THEMES)) {
    const e = entry as { theme?: unknown; statement_numbers?: unknown };
    if (typeof e.theme !== "string" || !Array.isArray(e.statement_numbers)) {
      return { ok: false, reason: "A theme came back without a name or its statements." };
    }
    const name = e.theme.normalize("NFKC").trim();
    if (!name || name.length > MAX_THEME_CHARS || /[<>{}]/.test(name) || [...name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 0x2028 || ch.charCodeAt(0) === 0x2029)) {
      return { ok: false, reason: "A theme name wasn't a short plain phrase." };
    }
    let count = 0;
    for (const n of e.statement_numbers) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > statements || claimed.has(n)) continue;
      claimed.add(n);
      count += 1;
    }
    if (count >= 2) themes.push({ theme: name, count });
  }
  themes.sort((a, b) => b.count - a.count);
  const counted = themes.reduce((sum, t) => sum + t.count, 0);
  return { ok: true, themes, unthemed: statements - counted };
}

const MIGRATION = "supabase/migrations/20260915000000_gym_health.sql";

/** The latest stored summary for this member source, or why there isn't one. */
export async function latestReasonThemes(
  source: MemberSource
): Promise<{ themes: StoredReasonThemes | null; ran_at: string | null; notice: string | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { themes: null, ran_at: null, notice: "Supabase isn't configured, so no nightly summary can be read." };
  }
  try {
    let query = supabaseAdmin
      .from("queue_runs")
      .select("ran_at, reason_themes")
      .eq("member_source", source.kind)
      .not("reason_themes", "is", null)
      .order("ran_at", { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));
    query = source.kind === "supabase" ? query.eq("gym_id", source.gymId) : query.is("gym_id", null);
    const { data, error } = await query;
    if (error) {
      const missing = error.code === "42703" || /column .*reason_themes|could not find the table/i.test(error.message);
      return { themes: null, ran_at: null, notice: missing ? `No summary can be stored until ${MIGRATION} is applied.` : `The nightly summary couldn't be read: ${error.message}` };
    }
    const row = (data?.[0] as { ran_at: string; reason_themes: StoredReasonThemes } | undefined) ?? null;
    return row
      ? { themes: row.reason_themes, ran_at: row.ran_at, notice: null }
      : { themes: null, ran_at: null, notice: "The nightly recompute hasn't produced a summary yet." };
  } catch (err) {
    return { themes: null, ran_at: null, notice: `The nightly summary couldn't be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}
