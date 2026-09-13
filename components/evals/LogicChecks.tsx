"use client";

import { useState, type KeyboardEvent } from "react";
import type { GuardGroup, GuardRow } from "@/components/evals/data";
import { Badge, Empty, Field, Section } from "@/components/evals/ui";

/** Rows a group shows before "Show all". */
const PREVIEW_ROWS = 4;

export default function LogicChecks({
  passed,
  total,
  groups,
  onlyFailures,
}: {
  passed: number;
  total: number;
  groups: GuardGroup[];
  onlyFailures: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const clean = passed === total;

  const visible = groups
    .map((g) => ({ ...g, shown: onlyFailures ? g.rows.filter((r) => !r.passed) : g.rows }))
    .filter((g) => g.shown.length > 0);

  return (
    <Section
      title={`${total} logic checks`}
      sub="No model. No network. Same answer every time."
      aside={
        <Badge tone={clean ? "pass" : "fail"} className="text-[11px]">
          {passed} / {total} pass
        </Badge>
      }
    >
      {visible.length === 0 ? (
        <Empty>Every logic check passed in this run. Nothing to filter.</Empty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((group) => {
            const all = onlyFailures || expanded[group.title];
            const rows = all ? group.shown : group.shown.slice(0, PREVIEW_ROWS);
            const hidden = group.shown.length - rows.length;
            const failing = group.rows.length - group.passed;
            return (
              <div key={group.title} className="flex flex-col rounded-xl border border-line bg-canvas px-[15px] pb-2 pt-3.5">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
                  <h3 className="m-0 flex-1 text-[13.5px] font-bold text-ink">{group.title}</h3>
                  <span className="text-[11.5px] tabular-nums text-dim">
                    {group.rows.length} {group.rows.length === 1 ? "check" : "checks"}
                  </span>
                  <Badge tone={failing === 0 ? "pass" : "fail"}>{failing === 0 ? "Pass" : `${failing} failing`}</Badge>
                </div>
                {rows.map((row) => (
                  <GuardLine
                    key={row.id}
                    row={row}
                    open={Boolean(open[row.id])}
                    onToggle={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
                  />
                ))}
                {(hidden > 0 || (expanded[group.title] && !onlyFailures && group.shown.length > PREVIEW_ROWS)) && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [group.title]: !e[group.title] }))}
                    className="mt-1 self-start rounded-[7px] px-1.5 py-1 text-[12px] font-semibold text-accent-ink hover:text-ink"
                  >
                    {hidden > 0 ? `Show ${hidden} more` : "Show fewer"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function GuardLine({ row, open, onToggle }: { row: GuardRow; open: boolean; onToggle: () => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={onKey}
        className={`grid cursor-pointer select-none grid-cols-[minmax(0,1fr)_64px] items-center gap-3 border-t border-row-line px-1 py-1.5 transition-colors hover:bg-row-hover ${
          open ? "bg-row-open shadow-[inset_3px_0_0_var(--bar)]" : ""
        }`}
      >
        <span className="min-w-0 pl-1 text-[12.5px] leading-[1.45] text-ink-2 text-pretty">{row.name}</span>
        <Badge tone={row.passed ? "pass" : "fail"}>{row.passed ? "Pass" : "Fail"}</Badge>
      </div>
      {open && (
        <div className="panel-in mb-1 flex flex-col gap-2.5 rounded-b-[10px] bg-panel px-3.5 py-3 shadow-[inset_3px_0_0_var(--bar),inset_0_1px_0_var(--panel-edge)]">
          <Field label="Why it exists">{row.why}</Field>
          <Field label="This run" tone={row.passed ? "ink" : "flag"}>
            <span className="font-mono text-[11.5px] leading-relaxed">{row.detail}</span>
          </Field>
          <span className="font-mono text-[10.5px] text-faint">{row.id}</span>
        </div>
      )}
    </>
  );
}
