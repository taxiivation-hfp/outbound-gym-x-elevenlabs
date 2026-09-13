/**
 * Presentation helpers for the evals screen. They reshape values the run files
 * already hold — a timestamp, a pass flag — and decide nothing.
 */

export type RowState = "pass" | "fail" | "inconclusive";

export const STATE_LABEL: Record<RowState, string> = {
  pass: "Pass",
  fail: "Fail",
  inconclusive: "Inconclusive",
};

/** The one tooltip the third row state carries. */
export const INCONCLUSIVE_TIP = "The call was cut off mid-turn.";

/** "13 Sep, 12:21 UTC" — in UTC so the server's string and the reader's agree. */
export function runTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

/** The committed file's name for a run, exactly as evals/run.ts writes it. */
export function runStamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

export const BADGE_TONE = {
  pass: "bg-accent-wash text-accent-ink",
  fail: "bg-flag-wash text-flag-ink",
  neutral: "bg-control text-muted",
} as const;

export function stateTone(state: RowState): keyof typeof BADGE_TONE {
  return state === "pass" ? "pass" : state === "fail" ? "fail" : "neutral";
}
