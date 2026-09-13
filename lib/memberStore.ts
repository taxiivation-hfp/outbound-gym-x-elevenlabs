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
 * Server-only. The per-table sync rules live in the migration and are kept
 * here: members are upserted, contracts and check-ins are inserted and never
 * updated, and a re-upload of the same export changes nothing. Nothing
 * time-relative is stored — `days_since_visit` and contract status are derived
 * on every read, so a member read at dial time is current as of that moment.
 */

const MIGRATION = "supabase/migrations/20260914010000_member_data.sql";
const BATCH = 500;
const PAGE = 1000;
const TIMEOUT_MS = 15_000;

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

/** Reads every row a paged query returns, a page at a time. */
async function readAll<T>(
  doing: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(error, doing);
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// --- Writing -------------------------------------------------------------------------

export interface ImportOutcome {
  kind: ImportKind;
  /** Rows written: new or updated members, or newly inserted contracts and check-ins. */
  written: number;
  /** Rows already present from an earlier import, left untouched. */
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

export async function importMembers(gymId: string, rows: MemberRecord[]): Promise<ImportOutcome> {
  requireSupabase();
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      gym_id: gymId,
      member_id: r.member_id,
      name: r.name,
      mobile: r.mobile,
      join_date: r.join_date,
      last_imported_at: now,
    }));
    // Upsert: a member's name and number change, and the latest export wins.
    // `first_imported_at` is left to its default on insert and never sent.
    const { error, count } = await supabaseAdmin
      .from("members")
      .upsert(batch, { onConflict: "gym_id,member_id", count: "exact" })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) {
      fail(error, `write members ${i + 1}–${i + batch.length} (${i} were written before this)`);
    }
    written += count ?? batch.length;
  }
  return { kind: "members", written, alreadyPresent: 0 };
}

async function insertOnly<T extends object>(
  table: "contracts" | "checkins",
  onConflict: string,
  gymId: string,
  rows: T[],
  kind: ImportKind
): Promise<ImportOutcome> {
  requireSupabase();
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({ gym_id: gymId, ...r }));
    // Insert only: a row that matches one already stored is ignored, never
    // updated, so re-uploading an export is harmless.
    const { error, count } = await supabaseAdmin
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: true, count: "exact" })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) {
      fail(error, `write ${table} rows ${i + 1}–${i + batch.length} (${written} new rows were written before this; re-uploading is safe)`);
    }
    written += count ?? 0;
  }
  return { kind, written, alreadyPresent: rows.length - written };
}

export function importContracts(gymId: string, rows: ContractRow[]): Promise<ImportOutcome> {
  return insertOnly(
    "contracts",
    "gym_id,member_id,start_date,end_date,auto_renew,contract_type,monthly_fee,renewal_fee",
    gymId,
    rows,
    "contracts"
  );
}

export function importCheckins(gymId: string, rows: CheckinRecord[]): Promise<ImportOutcome> {
  return insertOnly("checkins", "gym_id,member_id,visited_at", gymId, rows, "checkins");
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
  imported_at: string;
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
    imported_at: row.imported_at,
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

export interface LoadedMembers {
  members: Member[];
  /** Members that could not be routed, and why — a member with no contract, for instance. */
  unrouted: Array<{ member_id: string; reason: string }>;
}

export async function loadGymMembers(gymId: string, asOf: Date): Promise<LoadedMembers> {
  requireSupabase();
  const [records, contracts, visits] = await Promise.all([
    readAll<MemberRecord>("read members", (from, to) =>
      supabaseAdmin
        .from("members")
        .select("member_id, name, mobile, join_date")
        .eq("gym_id", gymId)
        .order("member_id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    ),
    readAll<RawContract>("read contracts", (from, to) =>
      supabaseAdmin
        .from("contracts")
        .select("id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee, renewal_fee, imported_at")
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
  for (const record of records) {
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
      .select("member_id, name, mobile, join_date")
      .eq("gym_id", gymId)
      .eq("member_id", memberId)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      .maybeSingle(),
    supabaseAdmin
      .from("contracts")
      .select("id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee, renewal_fee, imported_at")
      .eq("gym_id", gymId)
      .eq("member_id", memberId)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS)),
    visitCounts(gymId, asOf, memberId),
  ]);
  if (recordRes.error) fail(recordRes.error, "read the member");
  if (contractRes.error) fail(contractRes.error, "read the member's contracts");
  if (!recordRes.data) return { member: null, unroutedReason: null };

  const built = buildMember(
    recordRes.data as MemberRecord,
    ((contractRes.data ?? []) as RawContract[]).map(toContract),
    visits.get(memberId) ?? NO_VISITS,
    asOf
  );
  return built.ok ? { member: built.member, unroutedReason: null } : { member: null, unroutedReason: built.reason };
}
