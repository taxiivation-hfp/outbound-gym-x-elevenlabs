import {
  buildMember,
  type ContractRecord,
  type MemberRecord,
  type VisitCounts,
} from "@/lib/memberData";
import type { CheckinRecord, ContractRow, ImportKind } from "@/lib/memberImport";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Member } from "@/lib/types";

/**
 * Uploaded member data in Supabase: writing an import, and reading members back
 * in the shape the router reads.
 *
 * Server-only. The per-table sync rules live in the migration's import
 * functions: members are upserted, contracts and check-ins are inserted and
 * never rewritten, and a re-upload of the same export adds nothing. Each file is
 * one function call, so one transaction — imported whole or not at all. Nothing
 * time-relative is stored — `days_since_visit` and contract status are derived
 * on every read, so a member read at dial time is current as of that moment.
 */

const MIGRATION = "supabase/migrations/20260914010000_member_data.sql";
const PAGE = 1000;
const TIMEOUT_MS = 15_000;
/** One file is one statement; leave the route's 60 seconds room to answer. */
const IMPORT_TIMEOUT_MS = 50_000;

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01", "PGRST202"]);

type DbError = { code?: string; message?: string } | null;

function isMissing(error: DbError): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /could not find the (table|function)|relation .* does not exist/i.test(error.message ?? "");
}

export const MEMBER_TABLES_MISSING =
  `The member data tables haven't been created yet, so nothing can be imported or read. Apply ${MIGRATION}.`;

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class MemberStoreError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "MemberStoreError";
    this.status = status;
  }
}

function fail(error: DbError, doing: string): never {
  if (isMissing(error)) throw new MemberStoreError(MEMBER_TABLES_MISSING, 503);
  throw new MemberStoreError(`Couldn't ${doing}: ${error?.message ?? "unknown database error"}`, 502);
}

function requireSupabase() {
  if (!supabaseConfigured()) {
    throw new MemberStoreError(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so member data can't be stored or read.",
      503
    );
  }
}

/**
 * Reads every row a paged query returns. It stops only on an empty page, not a
 * short one: a project whose API row limit is below the page size returns short
 * pages that are not the end, and stopping early would silently drop the
 * newest contracts — the renewals and auto-renew switches.
 */
async function readAll<T>(
  doing: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(error, doing);
    const rows = (Array.isArray(data) ? data : []) as T[];
    if (rows.length === 0) return out;
    out.push(...rows);
    from += rows.length;
  }
}

// --- Writing -------------------------------------------------------------------------

export interface ImportOutcome {
  kind: ImportKind;
  /** New rows: members added, or contracts and check-ins inserted. */
  written: number;
  /**
   * Rows already stored from an earlier import: members updated with the file's
   * name and number, contracts marked as still listed, check-ins left as they were.
   */
  alreadyPresent: number;
}

/** Member ids already imported for this gym. */
export async function existingMemberIds(gymId: string): Promise<Set<string>> {
  requireSupabase();
  const rows = await readAll<{ member_id: string }>("read the gym's members", (from, to) =>
    supabaseAdmin.from("members").select("member_id").eq("gym_id", gymId).order("member_id").range(from, to).abortSignal(AbortSignal.timeout(TIMEOUT_MS))
  );
  return new Set(rows.map((r) => r.member_id));
}

/** Calls one import function: the whole file in one statement. */
async function importFile(
  kind: ImportKind,
  fn: "import_members" | "import_contracts" | "import_checkins",
  existingColumn: "updated" | "seen_again" | "already_present",
  args: Record<string, unknown>
): Promise<ImportOutcome> {
  requireSupabase();
  const { data, error } = await supabaseAdmin.rpc(fn, args).abortSignal(AbortSignal.timeout(IMPORT_TIMEOUT_MS));
  if (error) fail(error, `import the ${kind} file, so nothing from it was written`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, number | string | null> | undefined;
  if (!row || row.inserted === undefined || row[existingColumn] === undefined) {
    throw new MemberStoreError(`The ${kind} import returned no result, so it can't be confirmed. Re-uploading the same file is safe.`, 502);
  }
  return { kind, written: Number(row.inserted), alreadyPresent: Number(row[existingColumn]) };
}

export function importMembers(gymId: string, rows: MemberRecord[], hasMobileColumn: boolean): Promise<ImportOutcome> {
  return importFile("members", "import_members", "updated", {
    p_gym_id: gymId,
    p_rows: rows.map((r) => [r.member_id, r.name, r.mobile, r.join_date, r.cancellation_requested]),
    p_has_mobile: hasMobileColumn,
  });
}

export function importContracts(gymId: string, rows: ContractRow[]): Promise<ImportOutcome> {
  return importFile("contracts", "import_contracts", "seen_again", {
    p_gym_id: gymId,
    p_rows: rows.map((r) => [r.member_id, r.contract_type, r.auto_renew, r.start_date, r.end_date, r.monthly_fee, r.renewal_fee]),
  });
}

export function importCheckins(gymId: string, rows: CheckinRecord[]): Promise<ImportOutcome> {
  return importFile("checkins", "import_checkins", "already_present", {
    p_gym_id: gymId,
    p_rows: rows.map((r) => [r.member_id, r.visited_at]),
  });
}

// --- Reading -------------------------------------------------------------------------

export interface MemberDataCounts {
  members: number;
  contracts: number;
  checkins: number;
}

export async function memberDataCounts(gymId: string): Promise<MemberDataCounts> {
  requireSupabase();
  const count = async (table: string) => {
    const { count: n, error } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("gym_id", gymId)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) fail(error, `count ${table}`);
    return n ?? 0;
  };
  const [members, contracts, checkins] = await Promise.all([count("members"), count("contracts"), count("checkins")]);
  return { members, contracts, checkins };
}

interface RawContract {
  id: number;
  member_id: string;
  contract_type: string;
  auto_renew: boolean;
  start_date: string;
  end_date: string;
  monthly_fee: number | string;
  renewal_fee: number | string | null;
  last_seen_at: string;
}

function toContract(row: RawContract): ContractRecord {
  return {
    id: row.id,
    member_id: row.member_id,
    contract_type: row.contract_type,
    auto_renew: row.auto_renew,
    start_date: row.start_date,
    end_date: row.end_date,
    monthly_fee: Number(row.monthly_fee),
    renewal_fee: row.renewal_fee === null ? null : Number(row.renewal_fee),
    last_seen_at: row.last_seen_at,
  };
}

interface RawVisitCounts {
  member_id: string;
  last_visit_at: string | null;
  visits_last_4wk: number | string;
  visits_prior_4wk: number | string;
  visits_90d: number | string;
  visits_before_4wk: number | string;
}

const NO_VISITS: VisitCounts = {
  last_visit_at: null,
  visits_last_4wk: 0,
  visits_prior_4wk: 0,
  visits_90d: 0,
  visits_before_4wk: 0,
};

function toCounts(row: RawVisitCounts): VisitCounts {
  return {
    last_visit_at: row.last_visit_at,
    visits_last_4wk: Number(row.visits_last_4wk),
    visits_prior_4wk: Number(row.visits_prior_4wk),
    visits_90d: Number(row.visits_90d),
    visits_before_4wk: Number(row.visits_before_4wk),
  };
}

function isoDate(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}

async function visitCounts(gymId: string, asOf: Date, memberId?: string): Promise<Map<string, VisitCounts>> {
  const rows = await readAll<RawVisitCounts>("count check-ins", (from, to) => {
    const query = supabaseAdmin.rpc("member_visit_counts", { p_gym_id: gymId, p_as_of: isoDate(asOf) });
    return (memberId ? query.eq("member_id", memberId) : query)
      .order("member_id")
      .range(from, to)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  });
  return new Map(rows.map((row) => [row.member_id, toCounts(row)]));
}

/**
 * A members row. Read with every column so the cancellation column, added by a
 * later migration, reads as "no request" on a database without it rather than
 * failing every member read.
 */
interface RawMember {
  member_id: string;
  name: string;
  mobile: string | null;
  join_date: string;
  cancellation_requested?: string | null;
}

function toMemberRecord(row: RawMember): MemberRecord {
  const requested = row.cancellation_requested;
  return {
    member_id: row.member_id,
    name: row.name,
    mobile: row.mobile,
    join_date: row.join_date,
    // PostgREST returns a timestamp without time zone as "2026-09-05T15:29:00".
    cancellation_requested: typeof requested === "string" && requested ? requested.slice(0, 19) : null,
  };
}

export interface LoadedMembers {
  members: Member[];
  /** Members that could not be routed, and why — a member with no contract, for instance. */
  unrouted: Array<{ member_id: string; reason: string }>;
}

export async function loadGymMembers(gymId: string, asOf: Date): Promise<LoadedMembers> {
  requireSupabase();
  const [records, contracts, visits] = await Promise.all([
    readAll<RawMember>("read members", (from, to) =>
      supabaseAdmin
        .from("members")
        .select("*")
        .eq("gym_id", gymId)
        .order("member_id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    ),
    readAll<RawContract>("read contracts", (from, to) =>
      supabaseAdmin
        .from("contracts")
        .select("id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee, renewal_fee, last_seen_at")
        .eq("gym_id", gymId)
        .order("id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    ),
    visitCounts(gymId, asOf),
  ]);

  const contractsByMember = new Map<string, ContractRecord[]>();
  for (const row of contracts) {
    const list = contractsByMember.get(row.member_id) ?? [];
    list.push(toContract(row));
    contractsByMember.set(row.member_id, list);
  }

  const members: Member[] = [];
  const unrouted: LoadedMembers["unrouted"] = [];
  for (const raw of records) {
    const record = toMemberRecord(raw);
    const built = buildMember(record, contractsByMember.get(record.member_id) ?? [], visits.get(record.member_id) ?? NO_VISITS, asOf);
    if (built.ok) members.push(built.member);
    else unrouted.push({ member_id: built.member_id, reason: built.reason });
  }
  return { members, unrouted };
}

/**
 * One member, read fresh. This is the dial-time read: the queue was computed
 * earlier, and between then and the button being pressed a member can renew,
 * switch to auto-renew or walk in. Whatever the latest import says now is what
 * the call decision is made on.
 */
export async function loadGymMember(
  gymId: string,
  memberId: string,
  asOf: Date
): Promise<{ member: Member | null; unroutedReason: string | null }> {
  requireSupabase();
  const [recordRes, contractRes, visits] = await Promise.all([
    supabaseAdmin
      .from("members")
      .select("*")
      .eq("gym_id", gymId)
      .eq("member_id", memberId)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      .maybeSingle(),
    supabaseAdmin
      .from("contracts")
      .select("id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee, renewal_fee, last_seen_at")
      .eq("gym_id", gymId)
      .eq("member_id", memberId)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS)),
    visitCounts(gymId, asOf, memberId),
  ]);
  if (recordRes.error) fail(recordRes.error, "read the member");
  if (contractRes.error) fail(contractRes.error, "read the member's contracts");
  if (!recordRes.data) return { member: null, unroutedReason: null };

  const built = buildMember(
    toMemberRecord(recordRes.data as RawMember),
    ((contractRes.data ?? []) as RawContract[]).map(toContract),
    visits.get(memberId) ?? NO_VISITS,
    asOf
  );
  return built.ok ? { member: built.member, unroutedReason: null } : { member: null, unroutedReason: built.reason };
}
