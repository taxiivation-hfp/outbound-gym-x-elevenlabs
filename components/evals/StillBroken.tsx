"use client";

import { ATTRIBUTION_SOURCE, OWNER_TIP, PASSED_WHILE_LEAKING, UNTESTED_RISK } from "@/components/evals/attribution";
import type { BrokenRow } from "@/components/evals/data";
import { INCONCLUSIVE_TIP, STATE_LABEL, stateTone } from "@/components/evals/format";
import { Badge, Section, Source } from "@/components/evals/ui";

const GRID = "minmax(0,1fr) 92px";

/**
 * The latest run's non-passes, each with whose problem it is, a call that
 * passed its checks while leaking, and the one risk no scenario covers. Clicking a scenario
 * opens its row in the test calls.
 */
export default function StillBroken({ rows, onOpen }: { rows: BrokenRow[]; onOpen: (id: string) => void }) {
  return (
    <Section title="Still broken" sub="Listed here so nobody has to find it.">
      <div className="flex flex-col">
        {rows.map((row) => (
          <div key={row.id} className="grid items-start gap-3 border-b border-row-line py-2.5" style={{ gridTemplateColumns: GRID }}>
            <div className="flex min-w-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                title="Open this call’s transcript"
                className="self-start text-left text-[12.5px] font-semibold leading-[1.45] text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-accent-line"
              >
                {row.name}
              </button>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={stateTone(row.state)} tip={row.state === "inconclusive" ? INCONCLUSIVE_TIP : undefined}>
                  {STATE_LABEL[row.state]}
                </Badge>
              </span>
              <span className="text-[12px] leading-snug text-muted text-pretty">{row.reading ?? "No reading of this transcript yet."}</span>
            </div>
            <Badge tone={row.owner === "Agent" ? "fail" : "neutral"} tip={row.ownerTip}>
              {row.owner === "Unattributed" ? "Unread" : row.owner}
            </Badge>
          </div>
        ))}

        <div className="grid items-start gap-3 border-b border-row-line py-2.5" style={{ gridTemplateColumns: GRID }}>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px] font-semibold leading-[1.45] text-ink text-pretty">{PASSED_WHILE_LEAKING.title}</span>
            <span className="flex">
              <Badge tone="neutral" tip="Every check passed, and the transcript still showed the leak.">
                Passed while leaking
              </Badge>
            </span>
            <span className="text-[12px] leading-snug text-muted text-pretty">{PASSED_WHILE_LEAKING.reading}</span>
          </div>
          <Badge tone="fail" tip="Our checks passed a call that leaked.">
            Suite
          </Badge>
        </div>

        <div className="grid items-start gap-3 py-2.5" style={{ gridTemplateColumns: GRID }}>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px] font-semibold leading-[1.45] text-ink text-pretty">{UNTESTED_RISK.title}</span>
            <span className="flex">
              <Badge tone="neutral" tip="No scenario covers this yet.">
                Untested
              </Badge>
            </span>
            <span className="text-[12px] leading-snug text-muted text-pretty">{UNTESTED_RISK.reading}</span>
          </div>
          <Badge tone="fail" tip={OWNER_TIP.Agent}>
            Agent
          </Badge>
        </div>
      </div>
      <Source>
        which calls didn’t pass, the latest run file; whose problem each is, {ATTRIBUTION_SOURCE}; the call that passed while leaking, {PASSED_WHILE_LEAKING.source}; the untested risk, {UNTESTED_RISK.source}.
      </Source>
    </Section>
  );
}
