import { DEFAULT_GYM_ID, gyms as seedGyms } from "@/lib/gyms";
import { GYM_FIELD_KEYS, parseGymConfig, type GymConfig } from "@/lib/gymConfig";
import { memberSource } from "@/lib/memberSource";
import type { SupabaseClient } from "@supabase/supabase-js";
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

/**
 * Rows are read with every column and narrowed to the config's own keys here,
 * so a column added by a later migration (the offer schedule, for one) that
 * hasn't been applied yet reads as "not set" instead of failing every read —
 * and a gym read is on the path of every live call.
 */
const CONFIG_KEYS = ["gym_id", ...GYM_FIELD_KEYS, "offer_schedule"];

function configColumns(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CONFIG_KEYS.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
}

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
      .select("*")
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
function numericColumn(value: unknown): unknown {
  return typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value) ? Number(value) : value;
}

function normaliseRow(raw: Record<string, unknown>): Record<string, unknown> {
  const row = configColumns(raw);
  const out: Record<string, unknown> = { ...row, cheaper_tier_price: numericColumn(row.cheaper_tier_price) };
  // Absent on a database without the freeze migration: left absent, so the
  // parser reads "not set" rather than a key the row never had.
  if ("freeze_weekly_fee" in row) out.freeze_weekly_fee = numericColumn(row.freeze_weekly_fee);
  return out;
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
  // When the queue is one gym's uploaded members, that gym is the default: its
  // members can only be called as that gym, so any other default would make
  // every call from the dashboard a refusal until someone switched gym.
  let sourceGymId: string | null = null;
  try {
    const source = memberSource();
    sourceGymId = source.kind === "supabase" ? source.gymId : null;
  } catch {
    sourceGymId = null;
  }
  const defaultGymId =
    sourceGymId && valid.some((g) => g.gym_id === sourceGymId)
      ? sourceGymId
      : valid.some((g) => g.gym_id === DEFAULT_GYM_ID)
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

/**
 * Columns added by pass-one migrations. A config that doesn't use them is
 * written without them, so saving an ordinary gym keeps working on a database
 * one migration behind; a config that does use them fails there and names the
 * migration to apply.
 */
const LATER_COLUMNS: Array<{ keys: string[]; migration: string }> = [
  { keys: ["offer_schedule"], migration: "supabase/migrations/20260915010000_offer_schedule.sql" },
  {
    keys: ["reengagement_other_label", "reengagement_other_delivery", "winback_other_label", "winback_other_delivery"],
    migration: "supabase/migrations/20260915020000_other_offers.sql",
  },
  {
    keys: ["freeze_max_weeks", "freeze_weekly_fee"],
    migration: "supabase/migrations/20260915040000_freeze_and_cancellation_call.sql",
  },
];

/** A config as a row, with every later column that holds nothing left out. */
function gymRow(gym: GymConfig): Record<string, unknown> {
  const row: Record<string, unknown> = { ...gym };
  for (const { keys } of LATER_COLUMNS) {
    for (const key of keys) if (row[key] === null || row[key] === undefined) delete row[key];
  }
  return row;
}

function laterColumnProblem(error: { message: string }): string | null {
  const later = LATER_COLUMNS.find(({ keys }) => keys.some((k) => error.message.includes(k)));
  return later ? `This gym uses a setting the gyms table can't store yet. Apply ${later.migration}.` : null;
}

export type WriteClient = Pick<SupabaseClient, "from">;

export type InsertResult =
  | { ok: true; gym: GymConfig }
  | { ok: false; status: 409 | 503 | 500; error: string };

/**
 * Writes a new gym. Insert only: onboarding creates gyms, it does not silently
 * overwrite one that exists. Editing is `updateGym`, a different verb on
 * purpose.
 */
export async function insertGym(gym: GymConfig, createdVia: CreatedVia, client: WriteClient = supabaseAdmin): Promise<InsertResult> {
  if (!supabaseConfigured()) return { ok: false, status: 503, error: SEED_NOTICE_NO_SUPABASE };

  let error: { code?: string; message: string } | null;
  try {
    ({ error } = await client
      .from("gyms")
      .insert({ ...gymRow(gym), created_via: createdVia })
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
  const later = laterColumnProblem(error);
  if (later) return { ok: false, status: 503, error: later };
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

export type UpdateResult =
  | { ok: true; gym: GymConfig }
  | { ok: false; status: 404 | 503 | 500; error: string };

/**
 * Replaces an existing gym's config with one that has already been parsed,
 * compiled and validated. Every config column is written, so a field cleared on
 * the form is cleared in the row — blank stays blank. The id and how the gym
 * was first created don't change. A gym that doesn't exist is a 404: an edit
 * never creates one.
 */
export async function updateGym(gym: GymConfig, client: WriteClient = supabaseAdmin): Promise<UpdateResult> {
  if (!supabaseConfigured()) return { ok: false, status: 503, error: SEED_NOTICE_NO_SUPABASE };

  const { gym_id: gymId, ...config } = gym;
  const full: Record<string, unknown> = Object.fromEntries(GYM_FIELD_KEYS.map((k) => [k, config[k]]));
  full.offer_schedule = gym.offer_schedule ?? null;

  const write = async (row: Record<string, unknown>) => {
    try {
      const { data, error } = await client
        .from("gyms")
        .update(row)
        .eq("gym_id", gymId)
        .select("gym_id")
        .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS * 2));
      return { data: (data ?? []) as unknown[], error: error as { code?: string; message: string } | null, thrown: null as string | null };
    } catch (err) {
      return { data: [] as unknown[], error: null, thrown: err instanceof Error ? err.message : String(err) };
    }
  };

  let result = await write(full);
  // One migration behind and the config doesn't use the missing columns:
  // clearing a column that doesn't exist is the same as leaving it out.
  const usesLater = LATER_COLUMNS.some(({ keys }) => keys.some((k) => k in gymRow(gym)));
  if (result.error && laterColumnProblem(result.error) && !usesLater) {
    const laterKeys = new Set(LATER_COLUMNS.flatMap(({ keys }) => keys));
    result = await write(Object.fromEntries(Object.entries(full).filter(([k]) => !laterKeys.has(k))));
  }

  if (result.thrown) {
    return { ok: false, status: 503, error: `Could not reach the database, so the gym was not saved: ${result.thrown}` };
  }
  const { error } = result;
  if (error) {
    if (isMissingTable(error)) return { ok: false, status: 503, error: SEED_NOTICE_NO_TABLE };
    const later = laterColumnProblem(error);
    if (later) return { ok: false, status: 503, error: later };
    if (error.code === "23514") {
      return { ok: false, status: 500, error: `The database rejected this config against its constraints: ${error.message}` };
    }
    return { ok: false, status: 500, error: `Could not save the gym: ${error.message}` };
  }
  if (result.data.length === 0) return { ok: false, status: 404, error: `There is no gym "${gymId}" to edit.` };
  return { ok: true, gym };
}
