"use client";

import type { KeyboardEvent } from "react";
import { CALL_TYPE_TINT } from "@/components/calls/format";
import type { CallRow, EvalsData } from "@/components/evals/data";
import { INCONCLUSIVE_TIP, STATE_LABEL, stateTone } from "@/components/evals/format";
import { Badge, Empty, Field, Section } from "@/components/evals/ui";
import type { CallType } from "@/lib/callType";

const ROW_GRID = "112px minmax(0,1fr) 118px 118px";

function tint(agent: string) {
  return CALL_TYPE_TINT[agent as CallType] ?? { bg: "bg-off-bg", ink: "text-off-ink", border: "border-line" };
}

export default function TestCalls({
  calls,
  agent,
  onAgent,
  onlyFailures,
  open,
  onToggle,
}: {
  calls: EvalsData["calls"];
  agent: string;
  onAgent: (agent: string) => void;
  onlyFailures: boolean;
  open: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const rows = calls.rows.filter((r) => (agent === "all" || r.agent === agent) && (!onlyFailures || r.state !== "pass"));

  return (
    <Section
      title={`${calls.total} test calls`}
      sub="Real agents. Simulated members. Regex checks, and one judged condition each."
      aside={
        <span className="flex items-baseline gap-2.5" title="The member and the judge are models. Expect drift.">
          <span className="cursor-help font-display text-[22px] font-bold tabular-nums tracking-[-0.03em] text-ink underline decoration-line-strong decoration-dotted underline-offset-4">
            {calls.passed} / {calls.total}
          </span>
          <span className="text-[11.5px] text-dim">
            passed{calls.inconclusive > 0 ? ` · ${calls.inconclusive} inconclusive` : ""}
          </span>
        </span>
      }
    >
      <div className="mb-[18px] grid gap-[11px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {calls.agents.map((a) => {
          const on = agent === a.key;
          const t = tint(a.key);
          // Red only for a real fail; a gap made of inconclusive calls alone isn't the agent's.
          const fails = calls.rows.filter((r) => r.agent === a.key && r.state === "fail").length;
          const inconclusive = calls.rows.filter((r) => r.agent === a.key && r.state === "inconclusive").length;
          return (
            <button
              key={a.key}
              type="button"
              aria-pressed={on}
              onClick={() => onAgent(on ? "all" : a.key)}
              title={on ? "Show every agent" : `Show only ${a.label.toLowerCase()} calls`}
              className={`flex flex-col items-start gap-[9px] rounded-xl border p-[13px] text-left transition-colors ${
                on ? "border-accent-line bg-control" : "border-line bg-canvas hover:border-line-strong"
              }`}
            >
              <span className={`rounded-md px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.11em] ${t.bg} ${t.ink}`}>{a.label}</span>
              <span className="flex items-baseline gap-2">
                <span
                  className={`font-display text-[21px] font-bold tabular-nums tracking-[-0.03em] ${
                    fails > 0 ? "text-flag-ink" : a.passed < a.total ? "text-muted" : "text-ink"
                  }`}
                >
                  {a.passed}/{a.total}
                </span>
                {inconclusive > 0 && <span className="text-[11px] text-dim">{inconclusive} inconclusive</span>}
              </span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing matches this filter.</Empty>
      ) : (
        <div role="list" className="flex flex-col">
          {rows.map((row) => (
            <CallLine key={row.id} row={row} open={Boolean(open[row.id])} onToggle={() => onToggle(row.id)} />
          ))}
        </div>
      )}
    </Section>
  );
}

function CallLine({ row, open, onToggle }: { row: CallRow; open: boolean; onToggle: () => void }) {
  const t = tint(row.agent);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <div role="listitem" id={`call-${row.id}`} className="scroll-mt-24">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${row.name}: ${STATE_LABEL[row.state]}`}
        onClick={onToggle}
        onKeyDown={onKey}
        className={`grid cursor-pointer select-none items-center gap-3 border-b border-row-line px-1.5 py-[9px] transition-colors hover:bg-row-hover ${
          open ? "bg-row-open shadow-[inset_3px_0_0_var(--bar)]" : ""
        }`}
        style={{ gridTemplateColumns: ROW_GRID }}
      >
        <span className={`justify-self-start whitespace-nowrap rounded-md px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.09em] ${t.bg} ${t.ink}`}>
          {row.agentLabel}
        </span>
        <span className="min-w-0 text-[12.5px] leading-[1.45] text-ink-2 text-pretty">{row.name}</span>
        <Badge tone={stateTone(row.state)} tip={row.state === "inconclusive" ? INCONCLUSIVE_TIP : undefined}>
          {STATE_LABEL[row.state]}
        </Badge>
        <span className="justify-self-end">
          <span
            aria-hidden="true"
            className={`inline-flex h-[27px] items-center whitespace-nowrap rounded-lg border px-[11px] text-[11.5px] font-semibold ${
              open ? "border-line-strong text-ink" : row.state === "pass" ? "border-control-line text-dim" : "border-control-line text-muted"
            }`}
          >
            {open ? "Close transcript" : "Open transcript"}
          </span>
        </span>
      </div>

      {open && (
        <div
          role="region"
          aria-label={`${row.name}: transcript and checks`}
          className="panel-in grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] rounded-b-[10px] border-b border-line-strong bg-panel shadow-[inset_3px_0_0_var(--bar),inset_0_1px_0_var(--panel-edge)]"
        >
          <div className="min-w-0 border-r border-cell-line py-[13px] pl-4 pr-4">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-accent-ink">Transcript</span>
              <span className="text-[11.5px] text-dim">
                {row.turns.length} turns · {row.gym}
                {row.briefItem ? ` · brief item ${row.briefItem}` : ""}
              </span>
            </div>
            {row.turns.length === 0 ? (
              <p className="text-[13px] text-dim">No turns were recorded for this call.</p>
            ) : (
              <div className="flex flex-col gap-2 pr-3">
                {row.turns.map((turn, i) => (
                  <div key={i} className="line-in grid grid-cols-[62px_minmax(0,1fr)] items-start gap-3" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
                    <span className={`pt-0.5 text-[11.5px] font-bold ${turn.role === "agent" ? "text-dim" : "text-accent-ink"}`}>
                      {turn.role === "agent" ? "Agent" : "Member"}
                    </span>
                    <span className="whitespace-pre-wrap text-[13px] leading-normal text-ink-2 text-pretty">{turn.message.trim()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3.5 py-[13px] pl-4 pr-4">
            <Field label="What it tests">{row.why}</Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-dim">Local checks</span>
              {row.local.map((l) => (
                <div key={l.name} className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2.5">
                  <Badge tone={stateTone(l.state)} tip={l.state === "inconclusive" ? INCONCLUSIVE_TIP : undefined}>
                    {STATE_LABEL[l.state]}
                  </Badge>
                  <span className="min-w-0 text-[12.5px] leading-snug text-ink-2">
                    {l.name}
                    <span className="mt-0.5 block break-words font-mono text-[10.5px] leading-snug text-faint">{l.detail}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-dim">Judged</span>
              {row.judge.conditions.map((c) => (
                <div key={c} className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2.5">
                  {row.judge.passed ? (
                    <Badge tone="pass">Pass</Badge>
                  ) : row.state === "inconclusive" ? (
                    <Badge tone="neutral" tip={INCONCLUSIVE_TIP}>
                      Inconclusive
                    </Badge>
                  ) : (
                    <Badge tone="fail">Fail</Badge>
                  )}
                  <span className="min-w-0 text-[12.5px] leading-snug text-ink-2">
                    {c}
                    {row.judge.rationale && <span className="mt-1 block text-[12px] leading-snug text-dim">Judge: {row.judge.rationale}</span>}
                  </span>
                </div>
              ))}
            </div>
            {row.error && (
              <p className="rounded-lg border border-flag bg-flag-wash px-2.5 py-1.5 text-[12px] text-ink-2">
                <strong className="text-flag-ink">Error.</strong> {row.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
