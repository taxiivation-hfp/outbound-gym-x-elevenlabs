#!/usr/bin/env node
/**
 * Checks `lib/memberData.ts` against the offline pipeline, member by member.
 *
 *   npm run data:verify-port
 *
 * Uploaded member data is routed from Supabase through a TypeScript port of
 * `pipeline/build_scores.py`. If the port drifted, an uploaded gym and the
 * synthetic demo gym would route the same member differently, and nobody would
 * notice until a call went to the wrong person. So this rebuilds every member
 * from the pipeline's raw CSVs with the TypeScript code and compares the result
 * to `data/members_scored.json`, which the Python produced from the same files.
 *
 * Exits non-zero on any difference. No network, no database.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, normaliseHeader } from "../lib/csv";
import { buildMember, countVisits, type ContractRecord, type MemberRecord } from "../lib/memberData";
import type { Member } from "../lib/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function table(path: string): Array<Record<string, string>> {
  const parsed = parseCsv(read(path));
  if (parsed.errors.length > 0) {
    throw new Error(`${path}: ${parsed.errors.slice(0, 3).map((e) => `line ${e.line}: ${e.message}`).join("; ")}`);
  }
  const keys = parsed.header.map(normaliseHeader);
  return parsed.rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row.cells[i] ?? ""])));
}

const asOf = new Date(`${JSON.parse(read("data/dataset_meta.json")).as_of}T00:00:00Z`);
const expected = JSON.parse(read("data/members_scored.json")) as Member[];

const members = table("pipeline/data/members.csv");
const contracts = table("pipeline/data/contracts.csv");
const checkins = table("pipeline/data/checkins.csv");

const contractsByMember = new Map<string, ContractRecord[]>();
for (const c of contracts) {
  const list = contractsByMember.get(c.memberid) ?? [];
  list.push({
    member_id: c.memberid,
    contract_type: c.contracttype,
    auto_renew: c.autorenew === "True",
    start_date: c.startdate,
    end_date: c.expirydate,
    monthly_fee: Number(c.monthlyfee),
    renewal_fee: Number(c.renewalfee),
    last_seen_at: "2026-09-12T00:00:00Z",
  });
  contractsByMember.set(c.memberid, list);
}

const visitsByMember = new Map<string, string[]>();
for (const v of checkins) {
  const list = visitsByMember.get(v.memberid) ?? [];
  list.push(v.timestamp);
  visitsByMember.set(v.memberid, list);
}

const expectedById = new Map(expected.map((m) => [m.member_id, m]));
const differences: string[] = [];

for (const row of members) {
  const record: MemberRecord = {
    member_id: row.memberid,
    name: row.name,
    mobile: row.phone || null,
    join_date: row.joindate,
    cancellation_requested: row.cancellationrequested || null,
  };
  const built = buildMember(
    record,
    contractsByMember.get(record.member_id) ?? [],
    countVisits(visitsByMember.get(record.member_id) ?? [], asOf),
    asOf
  );
  const want = expectedById.get(record.member_id);
  if (!want) {
    differences.push(`${record.member_id}: not in members_scored.json`);
    continue;
  }
  if (!built.ok) {
    differences.push(`${record.member_id}: ${built.reason}`);
    continue;
  }
  const got = built.member;
  for (const key of Object.keys(want) as Array<keyof Member>) {
    const a = JSON.stringify(key === "phone" ? want.phone : want[key]);
    const b = JSON.stringify(got[key]);
    if (a !== b) differences.push(`${record.member_id}.${key}: pipeline ${a} vs port ${b}`);
  }
}

if (differences.length > 0) {
  console.error(`${differences.length} difference${differences.length === 1 ? "" : "s"} between the port and the pipeline:`);
  for (const d of differences.slice(0, 40)) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`lib/memberData.ts reproduces pipeline/build_scores.py exactly for all ${members.length} members.`);
