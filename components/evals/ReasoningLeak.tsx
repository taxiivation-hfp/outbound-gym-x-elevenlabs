import type { EvalsData, LeakExample } from "@/components/evals/data";
import { Badge, Code, Section } from "@/components/evals/ui";

/**
 * The reasoning leak, shown from the committed transcripts it happened in. The
 * frequency and the fix are README.md's words; which run and which scenario, and
 * how the check does in the latest run, are read from the run files.
 *
 * The badge reports the check, not a cure: a transcript on this same page
 * (UNCAUGHT_LEAK, listed under Still broken) leaks scaffolding and passed it.
 */
export default function ReasoningLeak({ leak }: { leak: EvalsData["leak"] }) {
  const everyCall = leak.check && leak.check.asserted === leak.check.total;
  const held = leak.check && leak.check.passed === leak.check.asserted;
  const chip = everyCall ? "every call" : `${leak.check?.asserted} of ${leak.check?.total} calls`;
  return (
    <Section
      title="It read its thinking out loud"
      sub="About one call in eight, on the first model."
      lead
      aside={
        leak.check && (
          <Badge
            tone={held ? "neutral" : "fail"}
            tip={`This run: ${leak.check.passed} of ${leak.check.asserted} passed. Not a cure: see Still broken.`}
            className="text-[11px]"
          >
            {held ? `Check passes on ${chip} — not fully fixed` : `Check failing on ${chip}`}
          </Badge>
        )
      }
    >
      <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">What the member heard</span>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[min(360px,100%)] flex-1">
          {leak.first ? (
            <Quote example={leak.first} large />
          ) : (
            <p className="m-0 mt-2.5 text-[13px] text-dim">The transcript this came from couldn’t be found in the committed run files.</p>
          )}
        </div>
        <aside className="mt-2.5 w-[220px] flex-none -rotate-1 rounded-xl border border-accent-line bg-accent-wash px-3.5 py-3 text-[13px] leading-snug text-ink-2">
          <p className="m-0 italic">Yes, apparently this is real. I didn’t believe it either but this happened</p>
          <p className="m-0 mt-1.5 text-right font-semibold not-italic text-accent-ink">— Dan</p>
        </aside>
      </div>

      {leak.after && (
        <>
          <span className="mt-5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">After the prompt instruction, it came back</span>
          <Quote example={leak.after} />
        </>
      )}

      <p className="m-0 mt-4 text-[12.5px] leading-[1.55] text-muted text-pretty">
        A prompt instruction didn’t stop it, so we changed the model: <Code>gemini-2.5-flash</Code> → <Code>gemini-3.5-flash</Code>.
      </p>
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
