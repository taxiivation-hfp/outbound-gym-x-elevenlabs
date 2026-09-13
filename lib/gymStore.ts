import { DEFAULT_GYM_ID, gyms as seedGyms } from "@/lib/gyms";
import { parseGymConfig, type GymConfig } from "@/lib/gymConfig";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Gym config at runtime: the Supabase `gyms` table, or the repo's seed before
 * that table exists.
 *
 * Server-only. Three states, and each one says which it is rather than looking
 * like the others:
 *
 * - **Table present.** The table is the source of truth. Every row is parsed
 *   with the same validation a form post faces, and a row that fails is left
 *   out of listings and refused for calls — never repaired with a guess.
 * - **Table not created yet** (the migration has not been applied) or Supabase
 *   not configured. The two seed gyms from `data/gyms.json` are served, which is
 *   exactly what the app did before this table existed, and a notice says so.
 *   Saving a new gym fails in this state, loudly, because there is nowhere to
 *   save it.
 * - **Any other database error.** Listings fall back to the seed with the error
 *   attached; the call route refuses, because dialling with config that could
 *   not be read is dialling blind.
 */

export type GymSource = "supabase" | "seed";

const COLUMNS =
  "gym_id, gym_name, opening_hours, quiet_hours, other_locations, has_online, books_classes, " +
  "renewal_discount_percent, reengagement_perk, winback_offer, cheaper_tier_name, cheaper_tier_price";

const MIGRATION = "supabase/migrations/20260914000000_create_gyms.sql";

/** PostgREST "table not in schema cache" / Postgres "undefined table". */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

type DbError = { code?: string; message?: string } | null;

function isMissingTable(error: DbError): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export const SEED_NOTICE_NO_TABLE =
  `The gyms table has not been created yet, so the two seed gyms from data/gyms.json are in use ` +
  `and new gyms cannot be saved. Apply ${MIGRATION}.`;

export const SEED_NOTICE_NO_SUPABASE =
  "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so the two " +
  "seed gyms from data/gyms.json are in use and new gyms cannot be saved.";

export interface GymListing {
  gyms: GymConfig[];
  default_gym_id: string;
  source: GymSource;
  /** Anything an operator should know about where these came from. */
  notice: string | null;
  /** Rows present in the table that failed validation, by id. */
  invalid: Array<{ gym_id: string; errors: Record<string, string> }>;
}

type ReadResult =
  | { state: "table"; rows: Record<string, unknown>[] }
  | { state: "no_table" }
  | { state: "no_supabase" }
  | { state: "error"; message: string };

/**
 * Gym config is read on the path of a live call and of the agent's `send_text`
 * tool, which ElevenLabs abandons after 20 seconds. A slow database has to fail
 * fast and say so, not hang until the tool times out mid-conversation.
 */
const READ_TIMEOUT_MS = 3000;

async function readRows(filterGymId?: string): Promise<ReadResult> {
  if (!supabaseConfigured()) return { state: "no_supabase" };
  try {
    let query = supabaseAdmin
      .from("gyms")
      .select(COLUMNS)
      .order("created_at", { ascending: true })
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
    if (filterGymId) query = query.eq("gym_id", filterGymId);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return { state: "no_table" };
      return { state: "error", message: error.message || String(error.code) };
    }
    return { state: "table", rows: (data ?? []) as unknown as Record<string, unknown>[] };
  } catch (err) {
    // A malformed Supabase URL throws while the client is built, and an abort
    // throws rather than returning an error; both are "could not read".
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** numeric columns can arrive as strings from some PostgREST configurations. */
function normaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  const price = row.cheaper_tier_price;
  return {
    ...row,
    cheaper_tier_price:
      typeof price === "string" && /^\d+(\.\d{1,2})?$/.test(price) ? Number(price) : price,
  };
}

function parseRows(rows: Record<string, unknown>[]) {
  const valid: GymConfig[] = [];
  const invalid: GymListing["invalid"] = [];
  for (const row of rows) {
    const parsed = parseGymConfig(normaliseRow(row));
    if (parsed.ok) valid.push(parsed.value);
    else invalid.push({ gym_id: String(row.gym_id), errors: parsed.errors as Record<string, string> });
  }
  return { valid, invalid };
}

function seedListing(notice: string): GymListing {
  return { gyms: seedGyms, default_gym_id: DEFAULT_GYM_ID, source: "seed", notice, invalid: [] };
}

export async function listGyms(): Promise<GymListing> {
  const result = await readRows();
  if (result.state === "no_supabase") return seedListing(SEED_NOTICE_NO_SUPABASE);
  if (result.state === "no_table") return seedListing(SEED_NOTICE_NO_TABLE);
  if (result.state === "error") {
    return seedListing(
      `Gym config could not be read from Supabase (${result.message}). Showing the seed gyms; ` +
        "calls are refused until the table can be read."
    );
  }

  const { valid, invalid } = parseRows(result.rows);
  const notices: string[] = [];
  if (valid.length === 0) notices.push("The gyms table is empty. Apply the migration's seed or add a gym at /onboarding.");
  if (invalid.length > 0) {
    notices.push(
      `${invalid.length} gym row${invalid.length === 1 ? "" : "s"} failed validation and ` +
        `${invalid.length === 1 ? "is" : "are"} not offered: ${invalid.map((i) => i.gym_id).join(", ")}.`
    );
  }
  const defaultGymId = valid.some((g) => g.gym_id === DEFAULT_GYM_ID)
    ? DEFAULT_GYM_ID
    : (valid[0]?.gym_id ?? DEFAULT_GYM_ID);
  return {
    gyms: valid,
    default_gym_id: defaultGymId,
    source: "supabase",
    notice: notices.length > 0 ? notices.join(" ") : null,
    invalid,
  };
}

export type GymLookup =
  | { ok: true; gym: GymConfig; source: GymSource }
  | { ok: false; status: 400 | 404 | 422 | 503; error: string };

/**
 * The gym a call or a text should use.
 *
 * No gym id means the default gym — the demo's single-gym case, and a setting
 * rather than a guess. A gym id that does not exist is refused: falling back to
 * another gym would put that gym's offers in this gym's mouth.
 */
export async function resolveGym(gymId: string | null | undefined): Promise<GymLookup> {
  if (typeof gymId === "string" && gymId.trim() === "") {
    return { ok: false, status: 400, error: "gym_id is empty. Pass a gym's id, or leave it out for the default gym." };
  }
  const wanted = gymId ?? null;
  const result = await readRows(wanted ?? undefined);

  if (result.state === "no_supabase" || result.state === "no_table") {
    const id = wanted ?? DEFAULT_GYM_ID;
    const gym = seedGyms.find((g) => g.gym_id === id);
    return gym
      ? { ok: true, gym, source: "seed" }
      : { ok: false, status: 404, error: `Unknown gym_id "${id}".` };
  }

  if (result.state === "error") {
    return {
      ok: false,
      status: 503,
      error: `Gym config could not be read, so nothing was placed: ${result.message}`,
    };
  }

  const { valid, invalid } = parseRows(result.rows);
  if (wanted) {
    const gym = valid.find((g) => g.gym_id === wanted);
    if (gym) return { ok: true, gym, source: "supabase" };
    const bad = invalid.find((i) => i.gym_id === wanted);
    if (bad) {
      return {
        ok: false,
        status: 422,
        error: `Gym "${wanted}" failed validation and cannot be used: ${Object.values(bad.errors).join(" ")}`,
      };
    }
    return { ok: false, status: 404, error: `Unknown gym_id "${wanted}".` };
  }

  // The default gym or nothing: never a different gym standing in for it.
  const gym = valid.find((g) => g.gym_id === DEFAULT_GYM_ID);
  if (gym) return { ok: true, gym, source: "supabase" };
  const bad = invalid.find((i) => i.gym_id === DEFAULT_GYM_ID);
  if (bad) {
    return {
      ok: false,
      status: 422,
      error: `The default gym "${DEFAULT_GYM_ID}" failed validation and cannot be used: ${Object.values(bad.errors).join(" ")}`,
    };
  }
  return {
    ok: false,
    status: 503,
    error: `The default gym "${DEFAULT_GYM_ID}" is not in the gyms table. Pass a gym_id explicitly.`,
  };
}

export type CreatedVia = "manual" | "document";

export type InsertResult =
  | { ok: true; gym: GymConfig }
  | { ok: false; status: 409 | 503 | 500; error: string };

/**
 * Writes a new gym. Insert only: onboarding creates gyms, it does not silently
 * overwrite one that exists.
 */
export async function insertGym(gym: GymConfig, createdVia: CreatedVia): Promise<InsertResult> {
  if (!supabaseConfigured()) return { ok: false, status: 503, error: SEED_NOTICE_NO_SUPABASE };

  let error: { code?: string; message: string } | null;
  try {
    ({ error } = await supabaseAdmin
      .from("gyms")
      .insert({ ...gym, created_via: createdVia })
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS * 2)));
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: `Could not reach the database, so the gym was not saved: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!error) return { ok: true, gym };
  if (isMissingTable(error)) return { ok: false, status: 503, error: SEED_NOTICE_NO_TABLE };
  if (error.code === "23505") {
    return {
      ok: false,
      status: 409,
      error: `A gym with the id "${gym.gym_id}" already exists. Use a different gym name.`,
    };
  }
  if (error.code === "23514") {
    return {
      ok: false,
      status: 500,
      error: `The database rejected this config against its constraints: ${error.message}`,
    };
  }
  return { ok: false, status: 500, error: `Could not save the gym: ${error.message}` };
}
