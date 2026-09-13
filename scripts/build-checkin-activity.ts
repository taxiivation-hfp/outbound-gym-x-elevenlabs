#!/usr/bin/env node
/**
 * Summarise the synthetic dataset's check-ins for the gym-health screen.
 *
 *   npx tsx scripts/build-checkin-activity.ts          (part of npm run data:build)
 *   npx tsx scripts/build-checkin-activity.ts --check  (fails if data/ is stale)
 *
 * `members_scored.json` carries per-member counts, not timestamps, and shipping
 * all 37,000 check-ins to a page render would cost load time for two small
 * charts. So this writes the weekly totals and the weekday × hour grid, computed
 * by `summariseCheckins` in lib/gymHealth.ts — the same function the uploaded
 * data path is checked against — to `data/checkin_activity.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseHeader, parseCsv } from "../lib/csv";
import { summariseCheckins } from "../lib/gymHealth";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const asOfIso = JSON.parse(readFileSync(join(ROOT, "data", "dataset_meta.json"), "utf8")).as_of as string;
const csv = parseCsv(readFileSync(join(ROOT, "pipeline", "data", "checkins.csv"), "utf8"));
const column = csv.header.map(normaliseHeader).indexOf("timestamp");
if (column < 0) throw new Error("pipeline/data/checkins.csv has no timestamp column");

const timestamps = csv.rows.map((row) => row.cells[column] ?? "");
const activity = { as_of: asOfIso, ...summariseCheckins(timestamps, new Date(`${asOfIso}T00:00:00Z`)) };
const out = `${JSON.stringify(activity, null, 2)}\n`;
const path = join(ROOT, "data", "checkin_activity.json");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (current !== out) {
    console.error("data/checkin_activity.json is stale. Run: npx tsx scripts/build-checkin-activity.ts");
    process.exit(1);
  }
  console.log("data/checkin_activity.json matches pipeline/data/checkins.csv");
} else {
  writeFileSync(path, out);
  console.log(`data/checkin_activity.json (${timestamps.length} check-ins, as of ${asOfIso})`);
}
