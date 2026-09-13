"use client";

/**
 * Four named stages — Upload, Read, Extract, Check — each advanced only by the
 * request behind it actually finishing. The upload bar is byte-accurate (it is
 * driven by the browser's upload progress events); the other stages have no
 * percentage to report, so they say "Working" and, for the model call, how long
 * it has been working. Nothing here moves on a timer.
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
      <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((stage, index) => (
          <li
            key={stage.key}
            aria-current={stage.status === "working" ? "step" : undefined}
            className="relative bg-black px-4 py-3.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="whitespace-nowrap text-sm font-semibold text-white">
                <span className="mr-1.5 tabular-nums text-zinc-400">{index + 1}</span>
                {stage.label}
              </p>
              <StatusWord status={stage.status} elapsed={stage.elapsed} />
            </div>
            <p className="mt-1 min-h-[1.25rem] text-xs leading-snug text-zinc-400 wrap-anywhere">{stage.fact ?? " "}</p>
            <StageTrack stage={stage} />
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcementFor(stages, failureMessage)}
      </p>
    </div>
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
  const track = "mt-2 h-1 overflow-hidden rounded-full bg-zinc-900";

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
          className="h-full origin-left rounded-full bg-zinc-300 transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    );
  }

  return (
    <div className={track} aria-hidden="true">
      {stage.status === "working" && <div className="stage-sweep h-full w-1/3 rounded-full bg-zinc-500" />}
      {stage.status === "done" && <div className="h-full w-full rounded-full bg-zinc-300" />}
    </div>
  );
}

function StatusWord({ status, elapsed }: { status: StageStatus; elapsed?: number }) {
  const color =
    status === "done"
      ? "text-signal"
      : status === "failed"
        ? "text-red-300"
        : status === "working"
          ? "text-white"
          : "text-zinc-400";
  return (
    <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${color}`}>
      {STATUS_WORD[status]}
      {status === "working" && elapsed !== undefined && elapsed >= 1 ? ` · ${elapsed}s` : ""}
    </span>
  );
}
