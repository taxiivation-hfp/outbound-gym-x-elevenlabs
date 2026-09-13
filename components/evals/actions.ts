"use server";

import latest from "@/evals/results/latest.json";

/**
 * The committed `evals/results/latest.json`, for "Download results".
 *
 * Serialised exactly as `evals/run.ts` writes it (`JSON.stringify(file, null,
 * 2)`), so the download is the file in the repo, not a summary of it. It takes
 * no input and returns only what the page already renders.
 */
export async function latestResultsJson(): Promise<string> {
  return JSON.stringify(latest, null, 2);
}
