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
import { activityFromRows, summariseCheckins } from "../lib/gymHealth";
import { countVisits } from "../lib/memberData";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = [
  "20260913000000_create_call_records.sql",
  "20260913120000_call_records_analysis.sql",
  "20260914000000_create_gyms.sql",
  "20260914010000_member_data.sql",
  "20260914020000_queue_runs.sql",
  "20260915000000_gym_health.sql",
  "20260915010000_offer_schedule.sql",
  "20260915020000_other_offers.sql",
  "20260915030000_cancellation_requests.sql",
  "20260915040000_freeze_and_cancellation_call.sql",
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
    "an invisible combining mark that NFKC keeps is refused",
    await rejects(db, `insert into gyms (gym_id, gym_name, quiet_hours, created_via) values ('x7', 'X', 'ig${String.fromCharCode(0x34f)}nore rules', 'manual')`)
  );
  check(
    "small-capital look-alike letters are refused",
    await rejects(db, `insert into gyms (gym_id, gym_name, created_via) values ('x8', '${String.fromCharCode(0x26a, 0x262, 0x274)} Gym', 'manual')`)
  );
  const accented = await rejects(db, "insert into gyms (gym_id, gym_name, other_locations, created_via) values ('cafe-creme', 'Café Crème Fitness', array['St. Kilda East'], 'manual')");
  check("accented Latin names and abbreviations are accepted", !accented);
  check(
    "a site list longer than one fact is refused",
    await rejects(db, "insert into gyms (gym_id, gym_name, other_locations, created_via) values ('x6', 'X', array[repeat('a', 60), repeat('b', 60), repeat('c', 60)], 'manual')")
  );

  console.log("\nOffer schedule");
  const scheduled = await rejects(db, `update gyms set offer_schedule = '{"guest_pass": "quarterly", "free_pt_session": "never"}' where gym_id = 'southbank'`);
  check("a schedule of known offers and periods is stored", !scheduled);
  check("an offer the schedule doesn't know is refused", await rejects(db, `update gyms set offer_schedule = '{"free_month": "yearly"}' where gym_id = 'southbank'`));
  check("a period that isn't one of the choices is refused", await rejects(db, `update gyms set offer_schedule = '{"guest_pass": "fortnightly"}' where gym_id = 'southbank'`));
  check("a schedule that isn't an object is refused", await rejects(db, `update gyms set offer_schedule = '["guest_pass"]' where gym_id = 'southbank'`));
  const offersColumn = await rejects(db, "insert into call_records (id, member_id, status, offers_available) values (gen_random_uuid(), 'M1', 'initiated', array['guest_pass'])");
  check("a call record stores the offers its block granted", !offersColumn);
  await db.exec("update gyms set offer_schedule = null where gym_id = 'southbank'; delete from call_records;");

  console.log("\nOther offers");
  const other = await rejects(db, "insert into gyms (gym_id, gym_name, reengagement_perk, reengagement_other_label, reengagement_other_delivery, offer_schedule, created_via) values ('shake-gym', 'Shake Gym', 'other', 'protein shake', 'link', '{\"reengagement_other\": \"quarterly\"}', 'manual')");
  check("an \"other\" perk with its label, delivery and a schedule is stored", !other);
  check("a label without \"other\" chosen is refused", await rejects(db, "insert into gyms (gym_id, gym_name, winback_other_label, winback_other_delivery, created_via) values ('x9', 'X', 'towel', 'link', 'manual')"));
  check("\"other\" without a delivery is refused", await rejects(db, "insert into gyms (gym_id, gym_name, winback_offer, winback_other_label, created_via) values ('x10', 'X', 'other', 'towel', 'manual')"));
  check("a label with digits is refused", await rejects(db, "insert into gyms (gym_id, gym_name, winback_offer, winback_other_label, winback_other_delivery, created_via) values ('x11', 'X', 'other', '50 percent', 'link', 'manual')"));
  check("an unknown delivery is refused", await rejects(db, "insert into gyms (gym_id, gym_name, winback_offer, winback_other_label, winback_other_delivery, created_via) values ('x12', 'X', 'other', 'towel', 'post', 'manual')"));

  console.log("\nMembership freeze");
  const paidFreeze = await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, freeze_weekly_fee, created_via) values ('freeze-gym', 'Freeze Gym', 8, 5, 'manual')");
  check("a freeze of 8 weeks at $5 a week is stored", !paidFreeze);
  const freeFreeze = await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, freeze_weekly_fee, created_via) values ('free-freeze-gym', 'Free Freeze Gym', 4, 0, 'manual')");
  check("a free freeze (fee 0) is stored — null and 0 are different answers", !freeFreeze);
  check("weeks without a fee is refused", await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, created_via) values ('x13', 'X', 8, 'manual')"));
  check("a fee without weeks is refused", await rejects(db, "insert into gyms (gym_id, gym_name, freeze_weekly_fee, created_via) values ('x14', 'X', 5, 'manual')"));
  check("a 27-week freeze is refused", await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, freeze_weekly_fee, created_via) values ('x15', 'X', 27, 5, 'manual')"));
  check("a $51-a-week freeze is refused", await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, freeze_weekly_fee, created_via) values ('x16', 'X', 8, 51, 'manual')"));
  check("a 0-week freeze is refused", await rejects(db, "insert into gyms (gym_id, gym_name, freeze_max_weeks, freeze_weekly_fee, created_via) values ('x17', 'X', 0, 5, 'manual')"));

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

  // Everything below goes through the import functions the app calls, as the
  // service role, with rows shaped as lib/memberStore.ts sends them.
  type Counts = { first: number; second: number };
  const importRows = async (fn: string, rows: unknown[], extra = ""): Promise<Counts> => {
    const result = await db.query(`select * from ${fn}('southbank', $1::jsonb${extra})`, [JSON.stringify(rows)]);
    const row = result.rows[0] as Record<string, unknown>;
    const [first, second] = Object.values(row).map(Number);
    return { first, second };
  };
  const memberRows = members.map((m) => [m.memberid, m.name, m.phone || null, m.joindate, m.cancellationrequested || null]);
  const contractRow = (c: Record<string, string>, autoRenew = c.autorenew === "True") => [
    c.memberid,
    c.contracttype,
    autoRenew,
    c.startdate,
    c.expirydate,
    Number(c.monthlyfee),
    c.renewalfee ? Number(c.renewalfee) : null,
  ];
  /** Microseconds since the epoch: a Date would round to milliseconds. */
  const lastSeen = async (c: Record<string, string>, autoRenew: boolean): Promise<number> =>
    Number(
      (
        (
          await db.query(
            "select (extract(epoch from last_seen_at) * 1000000)::bigint as us from contracts where gym_id = 'southbank' and member_id = $1 and start_date = $2 and auto_renew = $3",
            [c.memberid, c.startdate, autoRenew]
          )
        ).rows[0] as { us: unknown }
      ).us
    );

  await db.exec("set role service_role");
  const membersIn = await importRows("import_members", memberRows, ", true");
  check("import_members writes every member", membersIn.first === members.length, `${membersIn.first} inserted`);
  const requested = members.filter((m) => m.cancellationrequested);
  const storedRequests = (
    await db.query("select member_id, to_char(cancellation_requested, 'YYYY-MM-DD\"T\"HH24:MI:SS') as at from members where gym_id = 'southbank' and cancellation_requested is not null")
  ).rows as Array<{ member_id: string; at: string }>;
  check(
    "import_members stores each cancellation request as its local time",
    requested.length > 0 && storedRequests.length === requested.length && requested.every((m) => storedRequests.some((r) => r.member_id === m.memberid && r.at === m.cancellationrequested)),
    `${storedRequests.length} of ${requested.length} requests`
  );
  const contractsIn = await importRows("import_contracts", contracts.map((c) => contractRow(c)));
  check("import_contracts writes every term", contractsIn.first === contracts.length, `${contractsIn.first} inserted`);
  const checkinsIn = await importRows("import_checkins", checkins.map((v) => [v.memberid, v.timestamp]));
  check("import_checkins writes each distinct visit once", checkinsIn.first + checkinsIn.second === checkins.length, `${checkinsIn.first} inserted, ${checkinsIn.second} duplicates ignored`);

  const first = contracts[0];
  const auto = first.autorenew === "True";
  const seenBefore = await lastSeen(first, auto);
  await db.exec("select pg_sleep(0.01)");
  const again = await importRows("import_contracts", contracts.slice(0, 50).map((c) => contractRow(c)));
  check(
    "re-importing the same contracts inserts nothing and marks them seen again",
    again.first === 0 && again.second === 50 && (await lastSeen(first, auto)) !== seenBefore,
    `${again.first} new, ${again.second} seen again`
  );
  const flipped = await importRows("import_contracts", [contractRow(first, !auto)]);
  check("the same term with auto-renew changed becomes a new row", flipped.first === 1);
  await db.exec("select pg_sleep(0.01)");
  const flippedBack = await importRows("import_contracts", [contractRow(first, auto)]);
  check(
    "switching it back adds no row but makes the original the most recently seen",
    flippedBack.first === 0 && (await lastSeen(first, auto)) > (await lastSeen(first, !auto))
  );

  const bad = contracts.slice(1, 4).map((c) => contractRow(c, c.autorenew !== "True"));
  bad.push([first.memberid, first.contracttype, null, first.startdate, first.expirydate, 79, 79]);
  const countBefore = Number(((await db.query("select count(*) as n from contracts")).rows[0] as { n: unknown }).n);
  const badImport = await rejects(db, `select * from import_contracts('southbank', '${JSON.stringify(bad).replace(/'/g, "''")}'::jsonb)`);
  const countAfter = Number(((await db.query("select count(*) as n from contracts")).rows[0] as { n: unknown }).n);
  check("a file with one bad row writes none of its rows", badImport && countAfter === countBefore, `${countAfter - countBefore} rows written`);

  const withNumber = members.find((m) => m.phone);
  if (!withNumber) throw new Error("no member with a phone number in the synthetic data");
  await importRows("import_members", [[withNumber.memberid, withNumber.name, null, withNumber.joindate]], ", false");
  const kept = (await db.query("select mobile from members where gym_id = 'southbank' and member_id = $1", [withNumber.memberid])).rows[0] as { mobile: string | null };
  check("a members file with no mobile column leaves stored numbers alone", kept.mobile === withNumber.phone);
  const flagged = requested[0];
  await importRows("import_members", [[flagged.memberid, flagged.name, flagged.phone || null, flagged.joindate]], ", true");
  const cleared = (await db.query("select cancellation_requested from members where gym_id = 'southbank' and member_id = $1", [flagged.memberid])).rows[0] as { cancellation_requested: unknown };
  check("a members file without the cancellation column means no request, not the old one", cleared.cancellation_requested === null);

  const dupVisit = await importRows("import_checkins", [[checkins[0].memberid, checkins[0].timestamp]]);
  check("a check-in already stored is ignored", dupVisit.first === 0 && dupVisit.second === 1);
  await db.exec("reset role");

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

  await db.exec("set role service_role");
  const weekly = (await db.query("select * from checkin_weekly('southbank', '2026-09-12')")).rows as Array<{ weeks_ago: number; visits: number }>;
  const hourly = (await db.query("select * from checkin_hourly('southbank', '2026-09-12')")).rows as Array<{ weekday: number; hour: number; visits: number }>;
  await db.exec("reset role");
  const fromSql = activityFromRows(asOf, weekly, hourly);
  const distinctVisits = [...visits.values()].flat();
  check(
    "checkin_weekly and checkin_hourly match summariseCheckins for the synthetic dataset",
    JSON.stringify(fromSql) === JSON.stringify(summariseCheckins(distinctVisits, asOf)),
    `${weekly.length} weeks, ${hourly.length} weekday-hour cells`
  );

  await db.exec("set role anon");
  const anonDenied = await rejects(db, "select * from member_visit_counts('southbank', '2026-09-12')");
  const anonImportDenied = await rejects(db, "select * from import_contracts('southbank', '[]'::jsonb)");
  const anonActivityDenied = await rejects(db, "select * from checkin_hourly('southbank', '2026-09-12')");
  await db.exec("reset role");
  check("the anonymous role cannot read visit counts", anonDenied);
  check("the anonymous role cannot call the import functions", anonImportDenied);
  check("the anonymous role cannot read check-in activity", anonActivityDenied);

  console.log("\nQueue runs");
  const run = (await db.query("insert into queue_runs (as_of, clock, member_source, counts) values ('2026-09-12', 'frozen', 'dataset', '{}') returning id")).rows[0] as { id: string };
  check("a run records with a generated id", typeof run.id === "string" && run.id.length > 0);
  await db.query("update queue_runs set reason_themes = $1::jsonb where id = $2", [JSON.stringify({ status: "insufficient", statements: 3, generated_at: "2026-09-12T16:00:00Z" }), run.id]);
  const stored = (await db.query("select reason_themes from queue_runs where id = $1", [run.id])).rows[0] as { reason_themes: { status: string } };
  check("a run stores its themed summary", stored.reason_themes?.status === "insufficient");
  check("an unknown clock is refused", await rejects(db, "insert into queue_runs (as_of, clock, member_source, counts) values ('2026-09-12', 'sometimes', 'dataset', '{}')"));
  check(
    "an unknown call type is refused",
    await rejects(db, `insert into queue_run_entries (run_id, member_id, call_type) values ('${run.id}', 'M1', 'upsell')`)
  );
  check(
    "a cancellation call is a recorded call type",
    !(await rejects(db, `insert into queue_run_entries (run_id, member_id, call_type) values ('${run.id}', 'M2', 'cancellation')`))
  );

  console.log(failures === 0 ? "\nAll migration checks passed." : `\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
