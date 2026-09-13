#!/usr/bin/env node
/**
 * Keeps the `gyms` migration's seed rows in step with `data/gyms.json`.
 *
 *   npm run gyms:seed-sql     # rewrite the seed block in the migration
 *   npm run gyms:seed-check   # exit 1 if the migration's seed drifts from the JSON
 *
 * `data/gyms.json` defines the two original gyms: the guards and scenarios
 * compile against it offline, and the migration seeds a fresh `gyms` table from
 * it. Two copies of one config is how they drift apart, so the migration's copy
 * is generated from the JSON and checked against it.
 *
 * Scope: this keeps the repo consistent with itself. Once the migration has
 * been applied, the table is the runtime source of truth (`lib/gymStore.ts`),
 * the seed insert never overwrites an existing row, and changing a live gym is
 * a reviewed edit to that row, not a regenerated seed block.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_PATH = join(ROOT, "data", "gyms.json");
const MIGRATION_PATH = join(ROOT, "supabase", "migrations", "20260914000000_create_gyms.sql");

const COLUMNS = [
  ["gym_id", "text"],
  ["gym_name", "text"],
  ["opening_hours", "text"],
  ["quiet_hours", "text"],
  ["other_locations", "text[]"],
  ["has_online", "boolean"],
  ["books_classes", "boolean"],
  ["renewal_discount_percent", "integer"],
  ["reengagement_perk", "text"],
  ["winback_offer", "text"],
  ["cheaper_tier_name", "text"],
  ["cheaper_tier_price", "numeric"],
];

const BEGIN = "-- BEGIN SEED (regenerate with: npm run gyms:seed-sql)";
const END = "-- END SEED";

function seedBlock(gyms) {
  const rows = gyms.map((gym) => Object.fromEntries(COLUMNS.map(([name]) => [name, gym[name] ?? null])));
  const json = JSON.stringify(rows, null, 2);
  if (json.includes("$seed$")) throw new Error("gyms.json contains the dollar-quote tag $seed$");
  return [
    BEGIN,
    "insert into gyms (",
    "  gym_id, gym_name, opening_hours, quiet_hours, other_locations, has_online,",
    "  books_classes, renewal_discount_percent, reengagement_perk, winback_offer,",
    "  cheaper_tier_name, cheaper_tier_price, created_via",
    ")",
    "select",
    "  gym_id, gym_name, opening_hours, quiet_hours, other_locations, has_online,",
    "  books_classes, renewal_discount_percent, reengagement_perk, winback_offer,",
    "  cheaper_tier_name, cheaper_tier_price, 'seed'",
    `from jsonb_to_recordset($seed$${json}$seed$::jsonb) as seed (`,
    COLUMNS.map(([name, type]) => `  ${name} ${type}`).join(",\n"),
    ")",
    "on conflict (gym_id) do nothing;",
    END,
  ].join("\n");
}

const gyms = JSON.parse(readFileSync(JSON_PATH, "utf8")).gyms;
const migration = readFileSync(MIGRATION_PATH, "utf8");
const start = migration.indexOf(BEGIN);
const end = migration.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  console.error(`Seed markers not found in ${MIGRATION_PATH}.`);
  process.exit(1);
}

const current = migration.slice(start, end + END.length);
const expected = seedBlock(gyms);

if (process.argv.includes("--check")) {
  const match = /\$seed\$([\s\S]*)\$seed\$/.exec(current);
  let embedded = null;
  try {
    embedded = match ? JSON.parse(match[1]) : null;
  } catch {
    embedded = null;
  }
  const wanted = gyms.map((gym) => Object.fromEntries(COLUMNS.map(([name]) => [name, gym[name] ?? null])));
  if (JSON.stringify(embedded) !== JSON.stringify(wanted)) {
    console.error("The gyms migration's seed rows do not match data/gyms.json. Run: npm run gyms:seed-sql");
    process.exit(1);
  }
  // The rows can match while the SQL around them was edited by hand.
  if (current.replace(/\r\n/g, "\n") !== expected) {
    console.error("The gyms migration's seed SQL was edited by hand (column list, types or ON CONFLICT). Run: npm run gyms:seed-sql");
    process.exit(1);
  }
  console.log(`gyms migration seed matches data/gyms.json (${gyms.length} gyms)`);
} else {
  writeFileSync(MIGRATION_PATH, migration.slice(0, start) + expected + migration.slice(end + END.length));
  console.log(`Rewrote the seed block in ${MIGRATION_PATH} from data/gyms.json (${gyms.length} gyms)`);
}
