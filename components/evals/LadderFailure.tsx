import type { EvalsData, LadderCall } from "@/components/evals/data";
import { Badge, Section } from "@/components/evals/ui";

/**
 * The cancellation agent's ladder: a second offer after a flat "no thanks", in
 * the first run, and the same scenario after the stop rule was inverted. Both
 * transcripts and the four-scenario count are read from the run files; the
 * diagnosis and the rule are PASS_TWO_REPORT.md's words.
 */
export default function LadderFailure({ ladder }: { ladder: EvalsData["ladder"] }) {
  const { before, after, scenarios } = ladder;
  return (
    <Section
      title="It kept offering after “no thanks”"
      sub="The cancellation agent’s first run."
      lead
      aside={
        scenarios && (
          <Badge tone={scenarios.afterPassed === scenarios.total ? "pass" : "fail"} className="text-[11px]">
            Ladder scenarios {scenarios.beforePassed}/{scenarios.total} → {scenarios.afterPassed}/{scenarios.total}
          </Badge>
        )
      }
    >
      <p className="m-0 max-w-[80ch] text-[13.5px] leading-[1.6] text-ink-2 text-pretty">
        The member said “No thanks”. The agent made a second offer anyway.
      </p>

      <div className="mt-4 grid items-start gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))" }}>
        {before ? <Transcript call={before} heading="Before: the first run" /> : <Missing what="the first run’s transcript" />}
        {after ? <Transcript call={after} heading="After: the stop rule inverted" /> : <Missing what="the latest run’s transcript" />}
      </div>

      <p className="m-0 mt-4 max-w-[80ch] text-[13px] leading-[1.6] text-ink-2 text-pretty">
        The fix: we inverted the rule to <em>“Any decline ends the offers.”</em>
      </p>
    </Section>
  );
}

function Transcript({ call, heading }: { call: LadderCall; heading: string }) {
  const failed = call.checks.filter((c) => !c.passed);
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-canvas p-3.5">
      <figcaption className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink">{heading}</span>
        <Badge tone={call.passed ? "pass" : "fail"}>{call.passed ? "Pass" : "Fail"}</Badge>
        <span className="w-full text-[11.5px] text-dim">
          {call.when}
          {call.label ? ` — ${call.label}` : ""} · <span className="font-mono text-[11px]">{call.scenario}</span>
        </span>
      </figcaption>
      <div className="flex flex-col gap-2">
        {call.turns.map((turn, i) => {
          const agent = turn.role === "agent";
          return (
            <div key={i} className="grid grid-cols-[62px_minmax(0,1fr)] items-start gap-3">
              <span className={`pt-0.5 text-[11.5px] font-bold ${agent ? "text-dim" : "text-accent-ink"}`}>{agent ? "Agent" : "Member"}</span>
              <span className="whitespace-pre-wrap text-[13px] leading-normal text-ink-2 text-pretty">{turn.message.trim()}</span>
            </div>
          );
        })}
      </div>
      <p className="m-0 border-t border-line pt-2 text-[12px] leading-snug text-muted text-pretty">
        {failed.length === 0
          ? `Every local check passed; the judge ${call.judge.passed ? "passed" : "failed"} it.`
          : `Failed: ${failed.map((c) => `“${c.name}”`).join(", ")}; the judge ${call.judge.passed ? "passed" : "failed"} it.`}
      </p>
    </figure>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <p className="m-0 rounded-[10px] border border-flag bg-flag-wash px-3 py-2 text-[12.5px] text-ink-2">
      {what[0].toUpperCase() + what.slice(1)} couldn’t be found in the committed run files.
    </p>
  );
}
