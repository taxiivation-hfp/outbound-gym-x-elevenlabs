/**
 * Owns: the app's notion of today (the frozen dataset date unless DATASET_CLOCK=live) and day arithmetic.
 * Not here: writing that date, which pipeline/build_scores.py emits and scripts/copy-pipeline-output.mjs
 * copies into data/dataset_meta.json.
 */
import datasetMeta from "@/data/dataset_meta.json";

/**
 * The dataset's reference date.
 *
 * Every check-in, tenure and expiry in `members_scored.json` was generated
 * relative to a single frozen instant (`pipeline/build_scores.py`'s `TODAY`),
 * and that instant is written into `data/dataset_meta.json` by the pipeline so
 * there is one source of truth for it.
 *
 * Anything that answers "how long until this membership ends" has to measure
 * from that instant, not from the wall clock, or the demo rots: a member who
 * was twelve days from expiry when the data was generated would quietly become
 * expired a fortnight later, and the renewal call type would empty out.
 *
 * The trade-off is explicit: the app's sense of "today" is the dataset's, not
 * the world's. Nothing the agent says aloud is a wall-clock claim — it says
 * "twelve days" and "the fourteenth of March", both of which are true of the
 * dataset — and re-running the pipeline moves the reference date forward. On a
 * real gym feed this module returns `new Date()` instead, which is what
 * `DATASET_CLOCK=live` does.
 */
export const DATA_AS_OF = new Date(`${datasetMeta.as_of}T00:00:00Z`);

export function today(): Date {
  return process.env.DATASET_CLOCK === "live" ? new Date() : DATA_AS_OF;
}

/** Whole days from the reference date to an ISO date. Negative = in the past. */
export function daysUntil(isoDate: string, from: Date = today()): number {
  const target = new Date(`${isoDate}T00:00:00Z`);
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((target.getTime() - fromUtc) / 86_400_000);
}
