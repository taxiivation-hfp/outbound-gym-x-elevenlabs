import type { EvalsData, LeakExample } from "@/components/evals/data";
import { Badge, Code, Section, Source } from "@/components/evals/ui";

/**
 * The reasoning leak, shown from the committed transcripts it happened in. The
 * frequency and the fix are README.md's words; which run and which scenario, and
 * how the check has done since, are read from the run files.
 */
export default function ReasoningLeak({ leak }: { leak: EvalsData["leak"] }) {
  const everyCall = leak.check && leak.check.asserted === leak.check.total;
  const held = leak.check && leak.check.passed === leak.check.asserted;
  const chip = everyCall ? "asserted on every call" : `asserted on ${leak.check?.asserted} of ${leak.check?.total} calls`;
  return (
    <Section
      title="It read its thinking out loud"
      sub="About one call in eight, on the first model. Found by the suite, not by reading the prompt."
      lead
      aside={
        leak.check && (
          <Badge
            tone={held ? "pass" : "fail"}
            tip={`This run: ${leak.check.passed} of ${leak.check.asserted} passed.`}
            className="text-[11px]"
          >
            {held ? `Fixed — ${chip}` : `Failing — ${chip}`}
          </Badge>
        )
      }
    >
      <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">What the member heard</span>
      {leak.first ? (
        <Quote example={leak.first} large />
      ) : (
        <p className="m-0 mt-2.5 text-[13px] text-dim">The transcript this came from couldn’t be found in the committed run files.</p>
      )}

      {leak.after && (
        <>
          <span className="mt-5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">After the prompt instruction, it came back</span>
          <Quote example={leak.after} />
        </>
      )}

      <p className="m-0 mt-4 text-[12.5px] leading-[1.55] text-muted text-pretty">
        A prompt instruction not to narrate reduced it and didn’t remove it, so the conversation model changed from{" "}
        <Code>gemini-2.5-flash</Code> to <Code>gemini-3.5-flash</Code>.
        {leak.since && (
          <>
            {" "}
            The check that catches it has {leak.since.failures === 0 ? "passed" : `failed ${leak.since.failures} times`} in{" "}
            {leak.since.failures === 0 ? "all " : "the "}
            {leak.since.scenarioRuns} scenario-runs committed since {leak.since.after}.
          </>
        )}
        {leak.check && (
          <>
            {" "}
            In this run: {leak.check.passed} of {leak.check.asserted} passed “{leak.check.name}”.
          </>
        )}{" "}
        That is evidence, not a guarantee.
      </p>
      <Source>
        frequency and fix, README.md “Conversation LLM” row, “The numbers, and the runs that failed” and “Known rough edges”; evals/README.md “The
        model change, which the suite forced”; the transcripts, the run files named above.
      </Source>
    </Section>
  );
}

function Quote({ example, large = false }: { example: LeakExample; large?: boolean }) {
  return (
    <figure className="m-0 mt-2.5">
      <blockquote
        className={`m-0 whitespace-pre-wrap rounded-xl border border-l-[3px] border-line border-l-flag bg-canvas px-5 py-[18px] text-ink text-pretty ${
          large ? "font-display text-[17px] font-medium leading-normal tracking-[-0.015em]" : "text-[13.5px] leading-relaxed"
        }`}
      >
        “{example.spoken.trim()}
        <span className="text-flag-ink">{example.leaked}</span>”
      </blockquote>
      <figcaption className="mt-1.5 text-[11.5px] text-dim">
        Run {example.runNumber} of {example.runCount}, {example.when}
        {example.label ? ` — ${example.label}` : ""} · <span className="font-mono text-[11px]">{example.scenario}</span> ·{" "}
        <span className="font-mono text-[11px]">evals/results/{example.stamp}.json</span>
      </figcaption>
    </figure>
  );
}
