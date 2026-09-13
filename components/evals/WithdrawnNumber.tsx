import { Section, Source } from "@/components/evals/ui";

/** The cohort-accuracy number this project removed, and why. README.md's words; nothing here is computed. */
export default function WithdrawnNumber() {
  return (
    <Section title="We deleted our best number" sub="90.4% cohort accuracy, withdrawn." lead>
      <span className="mb-4 font-display text-[38px] font-bold tracking-[-0.035em] text-dim line-through decoration-flag decoration-[3px]">90.4%</span>
      <p className="m-0 max-w-[80ch] text-[13.5px] leading-[1.6] text-ink-2 text-pretty">
        An earlier version reported it against the data generator’s answer key. The answer key came from the same rules the router applies, so
        the comparison only measured whether two copies of one ruleset agree, and tuning thresholds against it was fitting one random seed’s
        noise. Honest status: the router is validated in structure, not in accuracy.
      </p>
      <p className="m-0 mt-3 max-w-[80ch] text-[12.5px] leading-[1.55] text-muted text-pretty">
        The same rule shaped the suite later. A turn-count ceiling for “briefer on the second call” came in at 8 against a limit of 7; the
        condition was deleted rather than raised until it passed.
      </p>
      <Source>README.md, “The withdrawn accuracy number”; evals/README.md, “Runs 2 and 4-9: the suite being wrong”.</Source>
    </Section>
  );
}
