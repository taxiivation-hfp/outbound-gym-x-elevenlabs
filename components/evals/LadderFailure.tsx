import type { EvalsData, LadderCall } from "@/components/evals/data";
import { Badge, Code, Section, Source } from "@/components/evals/ui";

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
      sub="The cancellation agent’s first run. The one behaviour the plan said must never happen."
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
        A member who asked to cancel gets at most two offers, and the second only when they say the first doesn’t fit. The first prompt said
        <em> if the offer doesn’t fit you may make the second one; if they refuse, stop</em>. Offering was the default and refusal the
        exception, so the model offered and went looking for permission — and made it up itself, saying “If a pause doesn’t help…” to a member
        who had said “No thanks” and nothing else. Three transcripts out of three.
      </p>

      <div className="mt-4 grid items-start gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))" }}>
        {before ? <Transcript call={before} heading="Before: the first run" /> : <Missing what="the first run’s transcript" />}
        {after ? <Transcript call={after} heading="After: the stop rule inverted" /> : <Missing what="the latest run’s transcript" />}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-canvas px-4 py-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">The decision</span>
        <p className="m-0 mt-1.5 max-w-[80ch] text-[13px] leading-[1.6] text-ink-2 text-pretty">
          The rule was turned around rather than reworded: <em>“Any decline ends the offers.”</em> “No thanks”, “I don’t think so” and “I’ve
          decided” are named as endings, and the second offer is allowed only when the objection is the member’s own, in their words — “Never
          supply it for them”. A prompt change to the cancellation agent alone, made from the first run’s diagnosis before the second run, and
          pinned by a logic check. Nothing was tuned to chase the number.
        </p>
      </div>

      <p className="m-0 mt-4 text-[12.5px] leading-[1.55] text-muted text-pretty">
        Two runs is evidence, not proof: the simulated member says exactly what its persona tells it. A real member who says “no thanks… well,
        what else have you got?” has no transcript yet, which is why it is listed under <em>Still broken</em> below.
      </p>
      <Source>
        the diagnosis and the rule, docs/build-log/PASS_TWO_REPORT.md, “What the run says about the agent” and addendum §1; the transcripts and
        counts, <Code>{ladderSource(before, after)}</Code>.
      </Source>
    </Section>
  );
}

function ladderSource(before: LadderCall | null, after: LadderCall | null): string {
  return [before, after]
    .filter((c): c is LadderCall => Boolean(c))
    .map((c) => `evals/results/${c.stamp}.json`)
    .join(", ");
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
