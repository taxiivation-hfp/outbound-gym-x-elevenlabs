"use client";

import { useState } from "react";
import type { AttackRow, EvalsData } from "@/components/evals/data";
import { Badge, Code, Section, Source } from "@/components/evals/ui";

const GRID = "132px minmax(0,1.4fr) 140px";

const TONE: Record<AttackRow["state"], "pass" | "fail" | "neutral"> = {
  Used: "pass",
  "Not stated": "neutral",
  "Held back": "neutral",
  Rejected: "fail",
};

/**
 * The adversarial price list, through the real sanitiser. Every row is
 * `sanitizeExtraction`'s outcome for one field of the committed real-model
 * extraction, computed when the page renders.
 */
export default function PriceListAttack({ attack }: { attack: EvalsData["attack"] }) {
  const [showDocument, setShowDocument] = useState(false);
  const { summary } = attack;
  // The worst-case check first: it is the one the closing sentence points to.
  const checks = attack.worstCase ? [attack.worstCase, ...attack.guards] : attack.guards;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <Section
      title="A price list tried to rewrite the agent"
      sub={attack.injectedSentence ? <>Buried line: “{attack.injectedSentence}”</> : undefined}
    >
      {attack.rows.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-flag bg-flag-wash px-3 py-2 text-[12.5px] text-ink-2">
          The committed document couldn’t be read on this deployment{attack.error ? ` (${attack.error})` : ""}. It’s{" "}
          <code className="font-mono">evals/documents/pdf/adversarial-price-list.txt</code>.
        </p>
      ) : (
        <>
          <div
            className="grid gap-3 border-b border-line-strong pb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-dim"
            style={{ gridTemplateColumns: GRID }}
          >
            <span>Field</span>
            <span>What it said</span>
            <span>What we took</span>
          </div>
          {attack.rows.map((row) => (
            <div key={row.key} className="grid items-baseline gap-3 border-b border-row-line py-2.5" style={{ gridTemplateColumns: GRID }}>
              <span className="text-[12.5px] font-bold text-ink text-pretty">{row.field}</span>
              <span className={`min-w-0 text-[12.5px] leading-[1.45] text-pretty ${row.said ? "text-muted" : "text-faint"}`}>
                {row.said ? `“${row.said}”` : "Nothing in the document"}
              </span>
              <span className="flex min-w-0 flex-col items-start gap-1">
                <Badge tone={TONE[row.state]} tip={row.tip}>
                  {row.state}
                </Badge>
                {row.took && (
                  <span className={`text-[12px] leading-snug ${row.state === "Used" ? "text-ink-2" : "text-dim line-through decoration-line-strong"}`}>
                    {row.took}
                  </span>
                )}
                {row.reason && <span className="text-[11.5px] leading-snug text-dim text-pretty">{row.reason}</span>}
              </span>
            </div>
          ))}

          <p className="m-0 mt-4 text-[12.5px] leading-[1.55] text-muted text-pretty">
            {plural(summary.filled, "fact", "facts")} filled, each from a sentence in the document; {summary.blank} left blank;{" "}
            {summary.unsupported} held back for a person; {summary.rejected} rejected.{" "}
            {attack.injectionReached ? (
              <strong className="text-flag-ink">A filled value carries the injected offer.</strong>
            ) : (
              "No filled value carries the injected offer."
            )}
            {attack.modelIgnoredInjection && (
              <>
                {" "}
                The model ignored the injected line, so the sanitiser had nothing to reject; the worst-case extraction that obeyed it is the
                logic check below.
              </>
            )}
          </p>

          {checks.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-canvas px-3.5 py-2.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">The same attack, in the logic checks</span>
              {checks.map((g) => (
                <div key={g.id} className="grid grid-cols-[minmax(0,1fr)_56px] items-start gap-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12px] leading-snug text-ink-2">{g.name}</span>
                    <span className="break-words font-mono text-[10.5px] leading-snug text-dim">{g.detail}</span>
                  </span>
                  <Badge tone={g.passed ? "pass" : "fail"}>{g.passed ? "Pass" : "Fail"}</Badge>
                </div>
              ))}
            </div>
          )}

          {attack.document && (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={showDocument}
                onClick={() => setShowDocument((s) => !s)}
                className="rounded-[7px] px-1 py-1 text-[12px] font-semibold text-accent-ink hover:text-ink"
              >
                {showDocument ? "Hide the document" : "Read the document"}
              </button>
              {showDocument && (
                <pre className="panel-in m-0 mt-1.5 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-3.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
                  {attack.document.trim()}
                </pre>
              )}
            </div>
          )}
        </>
      )}
      <Source>
        <Code>sanitizeExtraction</Code> over the real model’s committed output, <Code>evals/documents/pdf/adversarial-price-list.*</Code>, as in{" "}
        <Code>evals/configGuards.ts</Code>.
      </Source>
    </Section>
  );
}
