import Link from "next/link";
import { buttonClass, focusRing } from "./ui";

/**
 * The setup path, shown at the top of every setup screen: the gym's settings,
 * its member data, then the call queue. Each step says whether it is done, in a
 * word as well as a mark, and the moment the current step is done the next one
 * is a button here, not somewhere further down the page.
 *
 * "Done" is only what the server read: a gym row that exists, member data rows
 * that exist. Nothing here is marked done on the strength of a click.
 */

export type SetupStep = "gym" | "members" | "queue";

const REPO_SAMPLES = "https://github.com/taxiivation-hfp/outbound-gym-x-elevenlabs#sample-files";

export default function SetupSteps({
  current,
  gymId,
  gymDone,
  membersDone,
  status,
}: {
  current: SetupStep;
  /** The gym these steps belong to; null before one is saved. */
  gymId: string | null;
  gymDone: boolean;
  membersDone: boolean;
  /** One short line on where this step stands. */
  status?: string;
}) {
  const steps: Array<{ key: SetupStep; label: string; href: string | null; done: boolean }> = [
    { key: "gym", label: "Gym settings", href: gymId ? `/onboarding/${gymId}/edit` : "/onboarding", done: gymDone },
    { key: "members", label: "Member data", href: gymId && gymDone ? `/onboarding/${gymId}/members` : null, done: membersDone },
    { key: "queue", label: "Call queue", href: gymDone && membersDone ? "/" : null, done: false },
  ];

  const next =
    current === "gym" && gymDone && gymId
      ? { href: `/onboarding/${gymId}/members`, label: "Next: import members" }
      : current === "members" && membersDone
        ? { href: "/", label: "Next: open the call queue" }
        : null;

  return (
    <nav aria-label="Setup steps" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line-strong bg-surface px-4 py-3 shadow-soft">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-2 p-0">
        {steps.map((step, i) => {
          const isCurrent = step.key === current;
          const state = step.done ? "done" : isCurrent ? "current step" : "not yet";
          const mark = (
            <span
              aria-hidden="true"
              className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[11.5px] font-bold tabular-nums ${
                step.done ? "bg-accent text-on-accent" : isCurrent ? "border-2 border-accent-line text-accent-ink" : "border border-line-strong text-dim"
              }`}
            >
              {step.done ? "✓" : i + 1}
            </span>
          );
          const text = (
            <span className="flex flex-col leading-tight">
              <span className={`text-[12.5px] ${isCurrent ? "font-bold text-ink" : "font-semibold text-ink-2"}`}>{step.label}</span>
              <span className="text-[11px] text-dim">{state}</span>
            </span>
          );
          return (
            <li key={step.key} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className={`mr-1 h-px w-6 ${steps[i - 1].done ? "bg-accent-line" : "bg-line-strong"}`} />}
              {step.href && !isCurrent ? (
                <Link href={step.href} className={`flex items-center gap-2 rounded-lg px-1 py-0.5 no-underline hover:bg-row-hover ${focusRing}`}>
                  {mark}
                  {text}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined} className="flex items-center gap-2 px-1 py-0.5">
                  {mark}
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {status && (
          <p role="status" className="m-0 text-[12.5px] text-ink-2">
            {status}
          </p>
        )}
        {next && (
          <Link href={next.href} className={buttonClass("primary")}>
            {next.label} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

/** Where to find something to upload, for a visitor with no files of their own. */
export function SamplesHint() {
  return (
    <p className="m-0 text-[12.5px] text-muted">
      No files?{" "}
      <a href={REPO_SAMPLES} target="_blank" rel="noreferrer" className={`rounded-sm font-semibold text-accent-ink underline decoration-accent-line underline-offset-2 hover:text-ink ${focusRing}`}>
        Download samples from the repo
      </a>{" "}
      (see the README).
    </p>
  );
}
