#!/usr/bin/env node
/**
 * Pins the dynamic variables every conversation scenario sends.
 *
 *   npx tsx scripts/snapshot-scenario-payloads.ts            # rewrite evals/payloads/scenarios.json
 *   npx tsx scripts/snapshot-scenario-payloads.ts --check    # exit 1 if any payload differs
 *   npx tsx scripts/snapshot-scenario-payloads.ts --out <file>
 *
 * The committed results in evals/results/ are evidence about the agents only
 * while the payloads the scenarios send are the ones those runs sent. A prompt
 * variable that changes shape — a reworded context sentence, a renamed field —
 * silently turns a 15/15 run into a claim about a different call. This file
 * makes that change deliberate: the guard `scenario-payloads-are-pinned`
 * compares every scenario against this snapshot, and a change to a payload has
 * to be accompanied by regenerating it.
 *
 * The snapshot records the dataset's reference date, because every fixture is
 * expressed as an offset from it: re-anchoring the dataset (`npm run
 * data:build`) moves every date in every payload, and the snapshot has to be
 * regenerated on purpose then too.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_AS_OF } from "../lib/clock";
import { scenarios, scenarioVariables } from "../evals/scenarios";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SNAPSHOT_PATH = join(ROOT, "evals", "payloads", "scenarios.json");

export interface PayloadSnapshot {
  as_of: string;
  payloads: Record<string, { call_type: string; gym_id: string; variables: Record<string, string> }>;
}

export function currentPayloads(): PayloadSnapshot {
  const payloads: PayloadSnapshot["payloads"] = {};
  for (const scenario of scenarios) {
    const { variables } = scenarioVariables(scenario);
    payloads[scenario.id] = { call_type: scenario.callType, gym_id: scenario.gymId, variables };
  }
  return { as_of: DATA_AS_OF.toISOString().slice(0, 10), payloads };
}

/** Scenario ids whose payload differs from the snapshot, plus ids missing on either side. */
export function comparePayloads(snapshot: PayloadSnapshot, current: PayloadSnapshot): string[] {
  const problems: string[] = [];
  if (snapshot.as_of !== current.as_of) {
    problems.push(`the dataset's reference date is ${current.as_of}, the snapshot was taken at ${snapshot.as_of}`);
  }
  for (const id of Object.keys(snapshot.payloads)) {
    if (!(id in current.payloads)) problems.push(`${id}: in the snapshot but no longer a scenario`);
  }
  for (const [id, payload] of Object.entries(current.payloads)) {
    const pinned = snapshot.payloads[id];
    if (!pinned) {
      problems.push(`${id}: not in the snapshot`);
      continue;
    }
    if (JSON.stringify(pinned) !== JSON.stringify(payload)) {
      const keys = Object.keys(payload.variables).filter((k) => pinned.variables[k] !== payload.variables[k]);
      problems.push(`${id}: ${keys.length > 0 ? keys.join(", ") : "call type or gym"} changed`);
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex === -1 ? SNAPSHOT_PATH : args[outIndex + 1];
  const current = currentPayloads();
  if (args.includes("--check")) {
    if (!existsSync(SNAPSHOT_PATH)) {
      console.error(`No snapshot at ${SNAPSHOT_PATH}. Run this script without --check to create one.`);
      process.exit(1);
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as PayloadSnapshot;
    const problems = comparePayloads(snapshot, current);
    if (problems.length > 0) {
      console.error(`Scenario payloads differ from ${SNAPSHOT_PATH}:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`${Object.keys(current.payloads).length} scenario payloads match the snapshot (as of ${current.as_of}).`);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(current, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(current.payloads).length} scenario payloads to ${out} (as of ${current.as_of}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
