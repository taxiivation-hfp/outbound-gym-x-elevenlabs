"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import { isTypingTarget } from "@/components/shell/theme";
import { latestResultsJson } from "@/components/evals/actions";
import type { EvalsData } from "@/components/evals/data";
import LadderFailure from "@/components/evals/LadderFailure";
import LogicChecks from "@/components/evals/LogicChecks";
import PriceListAttack from "@/components/evals/PriceListAttack";
import ReasoningLeak from "@/components/evals/ReasoningLeak";
import ScoreHistory from "@/components/evals/ScoreHistory";
import StillBroken from "@/components/evals/StillBroken";
import TestCalls from "@/components/evals/TestCalls";
import WithdrawnNumber from "@/components/evals/WithdrawnNumber";
import { Code } from "@/components/evals/ui";

/**
 * The build journey. Written for someone judging how the product was built, not
 * for the gym manager who uses it: the decisions and what broke come first, and
 * the logic checks and test calls follow as the evidence for them.
 *
 * Everything it shows arrives from `loadEvalsData` on the server; the browser
 * only filters, expands rows, copies the run id and downloads the committed
 * results. It cannot run the suite: that costs real ElevenLabs calls, so the
 * toolbar shows the command instead of a button.
 */

type Transient = "idle" | "busy" | "done" | "failed";

/** The story beats, in page order. Each id is the anchor its section sits under. */
const CHAPTERS = [
  { id: "leak", title: "It read its thinking out loud", decision: "the conversation model changed" },
  { id: "ladder", title: "It kept offering after “no thanks”", decision: "the stop rule inverted" },
  { id: "withdrawn", title: "We deleted our best number", decision: "structure, not accuracy" },
  { id: "attack", title: "A price list tried to rewrite the agent", decision: "no model writes prompt text" },
] as const;

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

  const firstRun = data.history.runs[0];

  return (
    <AppShell
      current="evals"
      title="Retention Router"
      eyebrow="Build journey"
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
            <h2 className="m-0 font-display text-[30px] font-bold tracking-[-0.035em] text-balance">How it was built, and what broke</h2>
            <p className="m-0 max-w-[80ch] text-[14.5px] leading-[1.55] text-ink-2 text-pretty">
              <strong className="text-ink">This page is for judges, not gym managers.</strong> A gym manager never needs to open it: the call
              queue and the configuration are the product. This is the record of how that product was built — the decisions, the things that
              broke, and what each fix was measured against.
            </p>
            <p className="m-0 max-w-[80ch] text-[13.5px] leading-[1.55] text-muted text-pretty">
              The first run scored {firstRun ? `${firstRun.passed}/${firstRun.total}` : "below full marks"}. Every run is committed, failures
              included — a suite that passed everything first time would only prove its assertions too weak to catch anything. The{" "}
              {data.guards.total} logic checks and {data.calls.total} test calls sit at the end, as the evidence for the story above them. The
              full account is in <Code>evals/README.md</Code> and <Code>docs/build-log/</Code>.
            </p>
            <nav aria-label="On this page" className="mt-2">
              <ol className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
                {CHAPTERS.map((c, i) => (
                  <li key={c.id}>
                    <a
                      href={`#${c.id}`}
                      className="flex h-full flex-col gap-0.5 rounded-xl border border-line bg-surface px-3 py-2.5 no-underline transition-colors hover:border-accent-line"
                    >
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">
                        {String(i + 1).padStart(2, "0")} · what broke
                      </span>
                      <span className="text-[13px] font-semibold leading-snug text-ink text-pretty">{c.title}</span>
                      <span className="text-[12px] leading-snug text-muted">→ {c.decision}</span>
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href="#evidence"
                    className="flex h-full flex-col gap-0.5 rounded-xl border border-dashed border-line-strong bg-canvas px-3 py-2.5 no-underline transition-colors hover:border-accent-line"
                  >
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-dim">The evidence</span>
                    <span className="text-[13px] font-semibold leading-snug text-ink text-pretty">
                      {data.guards.total} logic checks, {data.calls.total} test calls
                    </span>
                    <span className="text-[12px] leading-snug text-muted">every transcript, every run</span>
                  </a>
                </li>
              </ol>
            </nav>
          </div>

          <Chapter id="leak" index={1}>
            <ReasoningLeak leak={data.leak} />
          </Chapter>

          <Chapter id="ladder" index={2}>
            <LadderFailure ladder={data.ladder} />
          </Chapter>

          <Chapter id="withdrawn" index={3}>
            <WithdrawnNumber />
          </Chapter>

          <Chapter id="attack" index={4}>
            <PriceListAttack attack={data.attack} />
          </Chapter>

          <div id="evidence" className="mt-4 flex scroll-mt-4 flex-col gap-[7px] border-t border-line-strong px-0.5 pt-6">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">The evidence</span>
            <h2 className="m-0 font-display text-[24px] font-bold tracking-[-0.03em] text-balance">
              {data.guards.total} logic checks and {data.calls.total} test calls
            </h2>
            <p className="m-0 max-w-[80ch] text-[13.5px] leading-[1.55] text-muted text-pretty">
              What the story above rests on. The logic checks involve no model and give the same answer every time. The test calls are real
              agents talking to simulated members; open any one to read the whole conversation, which is where the branching shows — what the
              member said, and which way the agent went because of it.
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

          <TestCalls
            calls={data.calls}
            agent={agent}
            onAgent={setAgent}
            onlyFailures={onlyFailures}
            open={open}
            onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))}
          />

          <LogicChecks passed={data.guards.passed} total={data.guards.total} groups={data.guards.groups} onlyFailures={onlyFailures} />

          <ScoreHistory runs={data.history.runs} error={data.history.error} />

          <StillBroken rows={data.broken} onOpen={openCall} />

          <div aria-hidden="true" className="h-1.5" />
        </div>
      </div>
    </AppShell>
  );
}

/** One story beat: its number above the panel, and the anchor the index links to. */
function Chapter({ id, index, children }: { id: string; index: number; children: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-4 flex-col gap-2">
      <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">
        {String(index).padStart(2, "0")} · {CHAPTERS[index - 1].decision}
      </span>
      {children}
    </div>
  );
}
