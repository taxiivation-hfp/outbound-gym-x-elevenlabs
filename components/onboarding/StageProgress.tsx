"use client";

/**
 * Four named stages — Upload, Read, Extract, Check — each advanced only by the
 * request behind it actually finishing. The upload bar is byte-accurate (it is
 * driven by the browser's upload progress events); the other stages have no
 * percentage to report, so their track sweeps while they work and, for the
 * model call, the label says how long it has been working. Nothing here moves
 * on a timer.
 */

export type StageKey = "upload" | "read" | "extract" | "check";
export type StageStatus = "waiting" | "working" | "done" | "failed";

export interface StageState {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** A fact learned at this stage: "3 pages · 4,210 characters". */
  fact?: string;
  /** Upload only: bytes sent over bytes total, 0–1. */
  progress?: number;
  /** Seconds this stage has been working, when worth showing. */
  elapsed?: number;
}

const STATUS_WORD: Record<StageStatus, string> = {
  waiting: "Waiting",
  working: "Working",
  done: "Done",
  failed: "Failed",
};

/**
 * What a screen reader hears: status changes only. Byte counts and the elapsed
 * timer change every second and would queue an announcement each time, so
 * facts are read out only once a stage has finished.
 */
function announcementFor(stages: StageState[], failureMessage?: string | null): string {
  const failed = stages.find((s) => s.status === "failed");
  if (failed) return `${failed.label} failed.${failureMessage ? ` ${failureMessage}` : ""}`;
  const working = stages.find((s) => s.status === "working");
  if (working) return `${working.label}: working.`;
  const done = [...stages].reverse().find((s) => s.status === "done");
  if (done) return `${done.label}: done.${done.fact ? ` ${done.fact}.` : ""}`;
  return "";
}

export default function StageProgress({ stages, failureMessage }: { stages: StageState[]; failureMessage?: string | null }) {
  return (
    <div>
      <ol className="m-0 grid list-none grid-cols-2 gap-x-2.5 gap-y-4 p-0 @xl:grid-cols-4">
        {stages.map((stage, index) => (
          <li key={stage.key} aria-current={stage.status === "working" ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <StageDot status={stage.status} index={index + 1} />
              <span className={`text-[12px] font-bold ${stage.status === "waiting" ? "text-dim" : "text-ink"}`}>{stage.label}</span>
              <span className="sr-only">
                {" "}
                {STATUS_WORD[stage.status]}
              </span>
              {stage.status === "working" && stage.elapsed !== undefined && stage.elapsed >= 1 && (
                <span className="ml-auto text-[11px] font-semibold tabular-nums text-dim" aria-hidden="true">
                  {stage.elapsed}s
                </span>
              )}
            </div>
            <StageTrack stage={stage} />
            <span className={`min-h-[15px] text-[11px] leading-snug wrap-anywhere ${stage.status === "failed" ? "font-semibold text-flag-ink" : "text-dim"}`}>
              {stage.status === "failed" ? `Failed${stage.fact ? ` · ${stage.fact}` : ""}` : (stage.fact ?? " ")}
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcementFor(stages, failureMessage)}
      </p>
    </div>
  );
}

function StageDot({ status, index }: { status: StageStatus; index: number }) {
  const look =
    status === "done"
      ? "border-accent-line bg-accent text-on-accent"
      : status === "working"
        ? "border-accent-line bg-accent-wash text-accent-ink"
        : status === "failed"
          ? "border-flag bg-flag-wash text-flag-ink"
          : "border-line bg-control text-dim";
  return (
    <span aria-hidden="true" className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[10.5px] font-bold ${look}`}>
      {status === "done" ? "✓" : status === "failed" ? "!" : index}
    </span>
  );
}

/**
 * Every stage keeps its track from the start, so a stage finishing never changes
 * the row's height under the button that appears next. Waiting is an empty
 * track; working is the sweep (or, for the upload, the bytes sent); done is a
 * full one. A failed stage keeps whatever it reached, which for the upload is
 * how far the bytes got and for the rest is nothing.
 */
function StageTrack({ stage }: { stage: StageState }) {
  const track = "h-1 overflow-hidden rounded-[3px] bg-row-line";

  if (stage.key === "upload") {
    const progress = stage.status === "waiting" ? 0 : (stage.progress ?? 0);
    return (
      <div
        className={track}
        role="progressbar"
        aria-label="Upload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        {/* Progress events land about every 50ms. An eased transition restarts
            fast-then-slow on each one and the bar pulses; a linear one about two
            events long carries it between them at a constant speed. */}
        <div
          className="h-full origin-left rounded-[3px] transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress})`, background: "var(--bar)" }}
        />
      </div>
    );
  }

  return (
    <div className={track} aria-hidden="true">
      {stage.status === "working" && <div className="stage-sweep h-full w-1/3 rounded-[3px]" style={{ background: "var(--bar)", opacity: 0.7 }} />}
      {stage.status === "done" && <div className="h-full w-full rounded-[3px]" style={{ background: "var(--bar)" }} />}
    </div>
  );
}
