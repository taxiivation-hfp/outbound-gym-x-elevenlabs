#!/usr/bin/env node
/**
 * Runs every onboarding migration against a real Postgres, in-process.
 *
 *   npm run db:verify
 *
 * The migrations in supabase/migrations/ can only be applied to the live
 * project by someone with database access, so this checks them the next best
 * way: PGlite (Postgres compiled to WebAssembly) with Supabase's three roles.
 * It checks that each migration runs, and runs again without error; that the
 * constraints refuse what the app refuses; that the sync rules hold (contracts
 * and check-ins insert-only and idempotent, a changed term becomes a new row);
 * that the check-in counting function matches `countVisits` in
 * lib/memberData.ts for every member of the synthetic dataset; and that the
 * anonymous role cannot call it.
 *
 * No network. Exits non-zero on the first failed check.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseHeader, parseCsv } from "../lib/csv";
import { countVisits } from "../lib/memberData";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = [
  "20260914000000_create_gyms.sql",
  "20260914010000_member_data.sql",
];

let failures = 0;
function check(name: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "pass" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function rejects(db: PGlite, sql: string): Promise<boolean> {
  try {
    await db.exec(sql);
    return false;
  } catch {
    return true;
  }
}

function table(path: string): Array<Record<string, string>> {
  const parsed = parseCsv(readFileSync(join(ROOT, path), "utf8"));
  const keys = parsed.header.map(normaliseHeader);
  return parsed.rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row.cells[i] ?? ""])));
}

/** A `timestamp without time zone` as PGlite hands it back: a Date in local time. */
function localIso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function main() {
  const db = new PGlite();
  // Supabase's roles, with the grants and the RLS bypass Supabase gives them.
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");

  console.log("Migrations");
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(ROOT, "supabase", "migrations", file), "utf8");
    let error = "";
    try {
      await db.exec(sql);
      await db.exec(sql);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    check(`${file} runs, and runs again`, error === "", error);
  }
  await db.exec(
    "grant usage on schema public to anon, authenticated, service_role; " +
      "grant select, insert, update on all tables in schema public to anon, authenticated, service_role;"
  );

  console.log("\nGym config");
  const seeds = (await db.query("select gym_id, other_locations, renewal_discount_percent, created_via from gyms order by gym_id")).rows as Array<Record<string, unknown>>;
  check(
    "the two seed gyms are inserted from data/gyms.json",
    seeds.length === 2 && seeds.every((g) => g.created_via === "seed") && JSON.stringify(seeds[1].other_locations) === JSON.stringify(["Brisbane CBD", "Fortitude Valley"])
  );
  const blank = (await db.query("insert into gyms (gym_id, gym_name, created_via) values ('blank-gym', 'Blank Gym', 'manual') returning *")).rows[0] as Record<string, unknown>;
  check(
    "a gym with only a name stores every config column as null",
    ["opening_hours", "quiet_hours", "other_locations", "has_online", "books_classes", "renewal_discount_percent", "reengagement_perk", "winback_offer", "cheaper_tier_name", "cheaper_tier_price"].every((k) => blank[k] === null)
  );
  check("a 0% discount is refused", await rejects(db, "insert into gyms (gym_id, gym_name, renewal_discount_percent, created_via) values ('x1', 'X', 0, 'manual')"));
  check("a 51% discount is refused", await rejects(db, "insert into gyms (gym_id, gym_name, renewal_discount_percent, created_via) values ('x2', 'X', 51, 'manual')"));
  check("half a cheaper tier is refused", await rejects(db, "insert into gyms (gym_id, gym_name, cheaper_tier_name, created_via) values ('x3', 'X', 'off-peak membership', 'manual')"));
  check("an unknown perk is refused", await rejects(db, "insert into gyms (gym_id, gym_name, reengagement_perk, created_via) values ('x4', 'X', 'half_price', 'manual')"));
  check("text that isn't NFKC-normalised is refused", await rejects(db, "insert into gyms (gym_id, gym_name, created_via) values ('x5', 'ＡＢＣ Gym', 'manual')"));
  check(
    "a site list longer than one fact is refused",
    await rejects(db, "insert into gyms (gym_id, gym_name, other_locations, created_via) values ('x6', 'X', array[repeat('a', 60), repeat('b', 60), repeat('c', 60)], 'manual')")
  );

  console.log("\nMember data");
  check(
    "a contract that doesn't say whether it auto-renews is refused",
    await rejects(
      db,
      "insert into members (gym_id, member_id, name, join_date) values ('southbank', 'Z1', 'Z', '2026-01-01'); " +
        "insert into contracts (gym_id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee) values ('southbank', 'Z1', '12-month', null, '2026-01-01', '2026-12-31', 79)"
    )
  );

  const members = table("pipeline/data/members.csv");
  const contracts = table("pipeline/data/contracts.csv");
  const checkins = table("pipeline/data/checkins.csv");
  await db.exec("begin");
  for (const m of members) {
    await db.query(
      "insert into members (gym_id, member_id, name, mobile, join_date) values ('southbank', $1, $2, $3, $4) on conflict (gym_id, member_id) do update set name = excluded.name, mobile = excluded.mobile",
      [m.memberid, m.name, m.phone || null, m.joindate]
    );
  }
  const insertContract = (c: Record<string, string>, autoRenew = c.autorenew === "True") =>
    db.query(
      "insert into contracts (gym_id, member_id, contract_type, auto_renew, start_date, end_date, monthly_fee, renewal_fee) values ('southbank', $1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id",
      [c.memberid, c.contracttype, autoRenew, c.startdate, c.expirydate, c.monthlyfee, c.renewalfee || null]
    );
  for (const c of contracts) await insertContract(c);
  for (const v of checkins) {
    await db.query("insert into checkins (gym_id, member_id, visited_at) values ('southbank', $1, $2) on conflict do nothing", [v.memberid, v.timestamp]);
  }
  await db.exec("commit");

  let reinserted = 0;
  for (const c of contracts.slice(0, 50)) reinserted += (await insertContract(c)).rows.length;
  check("re-importing the same contracts inserts nothing", reinserted === 0, `${reinserted} new rows`);
  const flipped = await insertContract(contracts[0], contracts[0].autorenew !== "True");
  check("the same term with auto-renew changed becomes a new row", flipped.rows.length === 1);
  const dupVisit = await db.query("insert into checkins (gym_id, member_id, visited_at) values ('southbank', $1, $2) on conflict do nothing returning 1", [checkins[0].memberid, checkins[0].timestamp]);
  check("a check-in already stored is ignored", dupVisit.rows.length === 0);

  await db.exec("set role service_role");
  const counted = (await db.query("select * from member_visit_counts('southbank', '2026-09-12')")).rows as Array<Record<string, unknown>>;
  await db.exec("reset role");
  const asOf = new Date("2026-09-12T00:00:00Z");
  const visits = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const v of checkins) {
    const key = `${v.memberid}|${v.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = visits.get(v.memberid) ?? [];
    list.push(v.timestamp);
    visits.set(v.memberid, list);
  }
  let differences = 0;
  for (const row of counted) {
    const ts = countVisits(visits.get(String(row.member_id)) ?? [], asOf);
    for (const k of ["visits_last_4wk", "visits_prior_4wk", "visits_90d", "visits_before_4wk"] as const) {
      if (Number(row[k]) !== ts[k]) differences += 1;
    }
    if (localIso(row.last_visit_at) !== (ts.last_visit_at ? ts.last_visit_at.slice(0, 19) : null)) differences += 1;
  }
  check(
    "member_visit_counts matches countVisits for every member",
    counted.length === visits.size && differences === 0,
    `${counted.length} members, ${differences} differences`
  );

  await db.exec("set role anon");
  const anonDenied = await rejects(db, "select * from member_visit_counts('southbank', '2026-09-12')");
  await db.exec("reset role");
  check("the anonymous role cannot read visit counts", anonDenied);

  console.log(failures === 0 ? "\nAll migration checks passed." : `\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
