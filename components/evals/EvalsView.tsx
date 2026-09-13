"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/shell/AppShell";
import { isTypingTarget } from "@/components/shell/theme";
import { latestResultsJson } from "@/components/evals/actions";
import type { EvalsData } from "@/components/evals/data";
import LogicChecks from "@/components/evals/LogicChecks";
import PriceListAttack from "@/components/evals/PriceListAttack";
import ReasoningLeak from "@/components/evals/ReasoningLeak";
import ScoreHistory from "@/components/evals/ScoreHistory";
import StillBroken from "@/components/evals/StillBroken";
import TestCalls from "@/components/evals/TestCalls";
import { Code, Section, Source } from "@/components/evals/ui";

/**
 * The evals screen. Everything it shows arrives from `loadEvalsData` on the
 * server; the browser only filters, expands rows, copies the run id and
 * downloads the committed results. It cannot run the suite: that costs real
 * ElevenLabs calls, so the toolbar shows the command instead of a button.
 */

type Transient = "idle" | "busy" | "done" | "failed";

export default function EvalsView({ data }: { data: EvalsData }) {
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [agent, setAgent] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const jumpTo = useRef<string | null>(null);
  const [copy, setCopy] = useState<Transient>("idle");
  const [download, setDownload] = useState<Transient>("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e.target)) setOpen({});
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // After a "Still broken" click has re-rendered with the row open, scroll to it once.
  useEffect(() => {
    const id = jumpTo.current;
    if (!id) return;
    jumpTo.current = null;
    document.getElementById(`call-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const later = (fn: () => void) => {
    timers.current.push(window.setTimeout(fn, 1800));
  };

  const copyRunId = async () => {
    try {
      await navigator.clipboard.writeText(data.run.stamp);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
    later(() => setCopy("idle"));
  };

  const downloadResults = async () => {
    setDownload("busy");
    try {
      const text = await latestResultsJson();
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.run.stamp}.json`;
      a.click();
      later(() => URL.revokeObjectURL(url));
      setDownload("idle");
    } catch {
      setDownload("failed");
      later(() => setDownload("idle"));
    }
  };

  const openCall = (id: string) => {
    const row = data.calls.rows.find((r) => r.id === id);
    if (row && agent !== "all" && agent !== row.agent) setAgent("all");
    if (row && onlyFailures && row.state === "pass") setOnlyFailures(false);
    setOpen((o) => ({ ...o, [id]: true }));
    jumpTo.current = id;
  };

  const ghost =
    "h-7 whitespace-nowrap rounded-lg border border-control-line px-[11px] text-[11.5px] font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60";

  return (
    <AppShell
      current="evals"
      title="Retention Router"
      eyebrow="Evals"
      headerActions={
        <Link
          href="/about"
          className="flex h-[34px] items-center rounded-[10px] border border-line bg-control px-3.5 text-[12.5px] font-bold text-ink no-underline transition-colors hover:border-accent-line"
        >
          Read the thinking
        </Link>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-w-[620px] max-w-[1160px] flex-col gap-4">
          <div className="flex flex-col gap-[9px] px-0.5 pt-1">
            <h2 className="m-0 font-display text-[30px] font-bold tracking-[-0.035em] text-balance">How we know it works</h2>
            <p className="m-0 max-w-[80ch] text-[14.5px] leading-[1.55] text-muted text-pretty">
              Every run, including the bad ones. The first scored{" "}
              {data.history.runs[0] ? `${data.history.runs[0].passed}/${data.history.runs[0].total}` : "below full marks"}: three real
              defects and two bad assertions of ours. Every run is committed, failures included — a suite that passed everything first
              time would only prove its assertions too weak to catch anything. The full account, including what the suite can’t tell you, is in{" "}
              <Code>evals/README.md</Code> in the repository.
            </p>
          </div>

          <div
            role="toolbar"
            aria-label="Filter and export results"
            className="sticky top-0 z-[6] flex flex-wrap items-center gap-[9px] rounded-[13px] border border-line-strong bg-surface px-[13px] py-[11px] shadow-soft"
          >
            <span className="flex items-center gap-2 text-[12px] text-dim" title={`Runs ${data.calls.total} real ElevenLabs calls. Costs money.`}>
              Run it yourself: <Code>npm run evals</Code>
            </span>
            <span aria-hidden="true" className="h-5 w-px bg-line" />
            <button
              type="button"
              aria-pressed={onlyFailures}
              onClick={() => setOnlyFailures((f) => !f)}
              title="Show only fails and inconclusive results"
              className={`h-8 whitespace-nowrap rounded-[9px] border px-[13px] text-[12.5px] transition-colors ${
                onlyFailures ? "border-flag bg-flag-wash font-bold text-flag-ink" : "border-control-line font-semibold text-muted hover:text-ink"
              }`}
            >
              Filter: failures
            </button>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              aria-label="Agent"
              className="h-8 cursor-pointer rounded-[9px] border border-control-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink"
            >
              <option value="all">All agents</option>
              {data.calls.agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <span className="ml-auto flex items-center gap-[9px]">
              <span className="text-[11.5px] tabular-nums text-dim" title={data.run.label ?? undefined}>
                <span className="font-mono text-[11px]">{data.run.stamp}</span> · {data.run.when}
              </span>
              <button type="button" onClick={copyRunId} className={ghost}>
                {copy === "done" ? "Copied" : copy === "failed" ? "Copy blocked" : "Copy run ID"}
              </button>
              <button type="button" onClick={downloadResults} disabled={download === "busy"} className={ghost} title="The committed latest.json">
                {download === "busy" ? "Preparing…" : download === "failed" ? "Download failed" : "Download results"}
              </button>
            </span>
          </div>

          <LogicChecks passed={data.guards.passed} total={data.guards.total} groups={data.guards.groups} onlyFailures={onlyFailures} />

          <TestCalls
            calls={data.calls}
            agent={agent}
            onAgent={setAgent}
            onlyFailures={onlyFailures}
            open={open}
            onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))}
          />

          <ScoreHistory runs={data.history.runs} error={data.history.error} />

          <ReasoningLeak leak={data.leak} />

          <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}>
            <PriceListAttack attack={data.attack} />
            <div className="flex min-w-0 flex-col gap-4">
              <Section title="We deleted our best number" sub="90.4% cohort accuracy, withdrawn.">
                <span className="mb-4 font-display text-[38px] font-bold tracking-[-0.035em] text-dim line-through decoration-flag decoration-[3px]">
                  90.4%
                </span>
                <p className="m-0 max-w-[70ch] text-[13.5px] leading-[1.6] text-ink-2 text-pretty">
                  The answer key came from the same rules the router applies, so the comparison only measured whether two copies of one
                  ruleset agree. Honest status: the router is validated in structure, not in accuracy.
                </p>
                <Source>README.md, “The withdrawn accuracy number”.</Source>
              </Section>
              <StillBroken rows={data.broken} onOpen={openCall} />
            </div>
          </div>

          <div aria-hidden="true" className="h-1.5" />
        </div>
      </div>
    </AppShell>
  );
}
