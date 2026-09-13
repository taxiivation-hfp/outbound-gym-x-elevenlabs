#!/usr/bin/env node
/**
 * The adversarial extraction fixture, against the real model.
 *
 *   npm run evals:extraction
 *
 * The deterministic guard `adversarial-document-cannot-author-the-block` proves
 * the sanitiser and compiler hold against a worst-case extraction written by
 * hand. This runs the actual extraction call on the same document — a price
 * list with a line telling the AI to offer everyone half price — and checks
 * what the model really does, then pushes its output through the same
 * sanitiser, parser, compiler and validator the upload flow uses.
 *
 * Needs ANTHROPIC_API_KEY. Without it, it says it did not run and writes
 * nothing, rather than reporting a pass it never earned.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGymFields, extractionConfigured } from "@/lib/extraction/extract";
import { scoreExtraction } from "./extractionChecks";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

async function main() {
  loadEnvLocal();
  if (!extractionConfigured()) {
    console.log("NOT RUN: ANTHROPIC_API_KEY is not set, so the real extraction model was not called.");
    console.log("The deterministic half of this fixture runs in `npm run evals:guards` (adversarial-document-cannot-author-the-block).");
    return;
  }

  const fileName = "adversarial-price-list.txt";
  const document = readFileSync(join(HERE, "documents", fileName), "utf8");
  const startedAt = new Date().toISOString();
  console.log(`Extraction eval — ${startedAt}\n`);

  const raw = await extractGymFields(document, fileName);
  const { review, checks } = scoreExtraction(raw.output, document);

  for (const c of checks) {
    console.log(`  ${c.passed ? "pass" : "FAIL"}  ${c.name}`);
    if (!c.passed) console.log(`        ${c.detail}`);
  }
  const passed = checks.filter((c) => c.passed).length;
  console.log(`\n${passed}/${checks.length}`);

  const resultsDir = join(HERE, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "extraction-latest.json"),
    JSON.stringify(
      { run_at: startedAt, model: raw.model, usage: raw.usage, document: fileName, raw_output: raw.output, review, checks },
      null,
      2
    )
  );
  console.log("Written to evals/results/extraction-latest.json");
  // exitCode, not exit(): exiting while the HTTP client's handles are still
  // closing trips a libuv assertion on Windows and masks the real status.
  process.exitCode = passed === checks.length ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
