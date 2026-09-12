#!/usr/bin/env node
/**
 * Copy the pipeline's output into `data/`, which is what the app imports.
 *
 * The pipeline writes to `pipeline/output/` so a re-run can be inspected before
 * it becomes the app's dataset. This is the one step that promotes it.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["members_scored.json", "dataset_meta.json"];

mkdirSync(join(ROOT, "data"), { recursive: true });
for (const file of files) {
  copyFileSync(join(ROOT, "pipeline", "output", file), join(ROOT, "data", file));
  console.log(`data/${file}`);
}
