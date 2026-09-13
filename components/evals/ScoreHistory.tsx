"use client";

import { useState } from "react";
import type { HistoryRun } from "@/components/evals/data";
import { Section } from "@/components/evals/ui";

const BAR_MAX = 132;

/**
 * Every committed conversation run as a bar. Suites of different sizes sit side
 * by side, so a bar's height is the share passed, and the fraction is printed on
 * it; runs of the same suite size are bracketed together underneath.
 */
export default function ScoreHistory({ runs, error }: { runs: HistoryRun[]; error: string | null }) {
  const [showLogic, setShowLogic] = useState(false);

  if (error || runs.length === 0) {
    return (
      <Section title="The score moves" lead>
        <p className="m-0 rounded-[10px] border border-flag bg-flag-wash px-3 py-2 text-[12.5px] text-ink-2">
          The committed run files couldn’t be read on this deployment{error ? ` (${error})` : ""}. They’re in <code className="font-mono">evals/results/</code>.
        </p>
      </Section>
    );
  }

  // Consecutive runs of the same suite size, for the bracket under the bars.
  const spans: Array<{ total: number; count: number }> = [];
  for (const run of runs) {
    const last = spans[spans.length - 1];
    if (last && last.total === run.total) last.count += 1;
    else spans.push({ total: run.total, count: 1 });
  }

  const shortRuns = runs.filter((r) => r.guardsPassed < r.guardsTotal);
  const grid = { display: "grid", gridTemplateColumns: `repeat(${runs.length}, minmax(0, 1fr))`, columnGap: 9 } as const;

  return (
    <Section
      title="The score moves"
      sub={`${runs.length} committed runs.`}
      lead
      aside={
        <button
          type="button"
          onClick={() => setShowLogic((s) => !s)}
          aria-pressed={showLogic}
          className={`h-[30px] whitespace-nowrap rounded-[9px] border px-3 text-[12px] transition-colors ${
            showLogic ? "border-accent-line bg-accent-wash font-bold text-accent-ink" : "border-control-line font-semibold text-muted hover:text-ink"
          }`}
        >
          Show logic checks
        </button>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="items-end" style={grid}>
            {runs.map((run) => {
              const share = run.passed / run.total;
              const full = run.passed === run.total;
              return (
                <div key={run.stamp} className="flex min-w-0 flex-col items-center justify-end gap-[7px]">
                  <span className={`font-display text-[14px] font-bold tabular-nums tracking-[-0.02em] ${full ? "text-accent-ink" : "text-ink"}`}>
                    {run.passed}/{run.total}
                  </span>
                  <div
                    className="w-full rounded-t-md rounded-b-[3px] transition-[height] duration-500"
                    style={{
                      height: Math.max(4, Math.round(share * BAR_MAX)),
                      background: full ? "var(--bar)" : "var(--off-ink)",
                      boxShadow: run.latest ? "0 0 0 2px var(--surface), 0 0 0 3px var(--accent-line)" : undefined,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {showLogic && (
            <div className="panel-in mt-2" style={grid} aria-label="Logic checks per run">
              {runs.map((run) => {
                const clean = run.guardsPassed === run.guardsTotal;
                return (
                  <span
                    key={run.stamp}
                    className={`rounded-md py-1 text-center text-[11px] font-bold tabular-nums ${clean ? "bg-accent-wash text-accent-ink" : "bg-flag-wash text-flag-ink"}`}
                    title={`Logic checks: ${run.guardsPassed} of ${run.guardsTotal}`}
                  >
                    {run.guardsPassed}/{run.guardsTotal}
                  </span>
                );
              })}
            </div>
          )}

          <div className="mt-2" style={grid}>
            {runs.map((run) => (
              <div key={run.stamp} className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                <span className={`whitespace-nowrap text-[10.5px] font-semibold ${run.latest ? "text-ink" : "text-dim"}`}>{run.when.replace(" UTC", "")}</span>
                <span className="break-words text-[10px] leading-tight text-faint text-pretty">
                  {run.latest ? "latest · " : ""}
                  {run.label ?? "no label"}
                </span>
                {run.inconclusive > 0 && <span className="text-[10px] leading-tight text-dim">{run.inconclusive} inconclusive</span>}
              </div>
            ))}
          </div>

          <div className="mt-2.5" style={grid} aria-hidden="true">
            {spans.map((span, i) => (
              <div key={i} className="flex flex-col items-center gap-1" style={{ gridColumn: `span ${span.count}` }}>
                <span className="h-1.5 w-full rounded-b border-x border-b border-line-strong" />
                <span className="text-[10.5px] text-dim">{span.total} calls per run</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="m-0 mt-4 border-t border-line pt-3.5 text-[12.5px] leading-[1.55] text-muted text-pretty">
        Logic checks{" "}
        {shortRuns.length === 0
          ? "passed in full on every run"
          : `passed in full on every run but ${shortRuns
              .map((r) => `${r.when} (${r.guardsPassed}/${r.guardsTotal}${r.label ? `, ${r.label}` : ""})`)
              .join(" and ")}`}
        . The conversation score drifts: the member and the judge are both models.
      </p>
    </Section>
  );
}
