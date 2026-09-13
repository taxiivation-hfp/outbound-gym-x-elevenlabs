#!/usr/bin/env node
/**
 * The eval runner.
 *
 *   npm run evals            # guards + all fifteen conversations
 *   npm run evals -- --guards-only
 *   npm run evals -- --only renewal-one-save-only,ai-question-admitted
 *   npm run evals -- --label "before the guardrail fix"
 *   npm run evals -- --rescore 2026-09-13T12-21-51-649Z   # no calls: re-apply today's
 *                                                         # assertions to a committed run's transcripts
 *
 * How it works:
 *
 * 1. Every scenario's dynamic variables are built by `lib/compileVariables.ts` —
 *    the same compiler the live call route uses — so the suite tests the real
 *    payload rather than a hand-written approximation of it.
 * 2. Each scenario becomes an ElevenLabs simulation test: a scripted member
 *    persona, those variables, and the scenario's `llm` conditions as the test's
 *    success criteria. Tests are matched by name and updated in place, so
 *    re-running does not litter the workspace.
 * 3. `run-tests` plays the conversation against the real agent and returns the
 *    transcript. The local regex assertions run here, on that transcript.
 * 4. Results are written to `evals/results/` — one timestamped file per run plus
 *    `latest.json`, both committed. The dashboard reads `latest.json`.
 *
 * A scenario passes only if every local assertion and every LLM condition
 * passes. Both are reported separately, because when a scenario fails it matters
 * a great deal which half failed: a local failure is a fact about the
 * transcript, a judge failure is an opinion about it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuards, type GuardResult } from "./guards";
import { assertionsFor, scenarios, scenarioVariables, type Scenario } from "./scenarios";
import type { AssertionResult, Turn } from "./assertions";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RESULTS_DIR = join(HERE, "results");
const API = "https://api.elevenlabs.io/v1";

// --- env --------------------------------------------------------------------

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

loadEnvLocal();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_IDS: Record<string, string | undefined> = {
  renewal: process.env.ELEVENLABS_AGENT_ID_RENEWAL,
  reengagement: process.env.ELEVENLABS_AGENT_ID_REENGAGEMENT,
  winback: process.env.ELEVENLABS_AGENT_ID_WINBACK,
  cancellation: process.env.ELEVENLABS_AGENT_ID_CANCELLATION,
};

// --- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const GUARDS_ONLY = args.includes("--guards-only");
function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const ONLY = argValue("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const LABEL = argValue("--label");
/**
 * Re-score a committed run: its transcripts and its judge verdicts, held to
 * the assertions as they are now. No call is made. Written when an assertion
 * is added, so the committed score says what the transcripts we already had
 * look like under it, rather than waiting for a live run to happen to show it.
 */
const RESCORE = argValue("--rescore");

// --- http -------------------------------------------------------------------

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": API_KEY!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text.slice(0, 1500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- tests ------------------------------------------------------------------

const TEST_NAME_PREFIX = "charlie-eval";
const INVOCATION_TIMEOUT_MINUTES = 20;

function testName(scenario: Scenario): string {
  return `${TEST_NAME_PREFIX}/${scenario.id}`;
}

function testBody(scenario: Scenario) {
  const { variables } = scenarioVariables(scenario);
  return {
    type: "simulation" as const,
    name: testName(scenario),
    dynamic_variables: variables,
    success_conditions: scenario.llm,
    simulation_scenario: scenario.persona,
    simulation_max_turns: scenario.maxTurns,
    // Mock every tool. `send_text` points at the deployed endpoint, which sends
    // a real SMS; an eval suite that texts a real handset every time it runs is
    // a suite people stop running. The assertions care that the agent *reached
    // for* the tool, which a mocked call records just as well.
    tool_mock_config: {
      mocking_strategy: "all",
      fallback_strategy: "raise_error",
    },
  };
}

interface TestSummary {
  id?: string;
  test_id?: string;
  name?: string;
}

async function listTests(): Promise<TestSummary[]> {
  const out: TestSummary[] = [];
  let cursor: string | null = null;
  do {
    const page: { tests?: TestSummary[]; next_cursor?: string | null } = await call(
      "GET",
      `/convai/agent-testing?page_size=100${cursor ? `&cursor=${cursor}` : ""}`
    );
    out.push(...(page.tests ?? []));
    cursor = page.next_cursor ?? null;
  } while (cursor);
  return out;
}

async function ensureTest(scenario: Scenario, existing: Map<string, string>): Promise<string> {
  const body = testBody(scenario);
  const known = existing.get(body.name);
  if (known) {
    await call("PUT", `/convai/agent-testing/${known}`, body);
    return known;
  }
  const created = await call<TestSummary>("POST", "/convai/agent-testing/create", body);
  const id = created.id ?? created.test_id;
  if (!id) throw new Error(`created test for ${scenario.id} but got no id back`);
  return id;
}

// --- running ----------------------------------------------------------------

interface TestRun {
  test_run_id: string;
  test_id: string;
  status: "pending" | "passed" | "failed";
  agent_responses?: Array<{ role: "user" | "agent"; message?: string | null }>;
  /**
   * The judge's verdict. `rationale` arrives either as a string or as
   * `{ summary, messages[] }` depending on how many conditions were evaluated,
   * so it is normalised before it is stored.
   */
  condition_result?: {
    result?: string;
    rationale?: string | { summary?: string; messages?: string[] } | null;
  } | null;
}

interface Invocation {
  id: string;
  test_runs: TestRun[];
}

async function runAgentTests(agentId: string, testIds: string[]): Promise<Invocation> {
  const invocation = await call<Invocation>("POST", `/convai/agents/${agentId}/run-tests`, {
    tests: testIds.map((test_id) => ({ test_id })),
  });

  // The cancellation agent carries the largest group (sixteen scenarios), and
  // the platform runs an invocation's tests with limited concurrency.
  const deadline = Date.now() + INVOCATION_TIMEOUT_MINUTES * 60 * 1000;
  let current = invocation;
  while (Date.now() < deadline) {
    const pending = current.test_runs.filter((r) => r.status === "pending").length;
    if (pending === 0) return current;
    process.stdout.write(`    ${pending} of ${current.test_runs.length} still running…\r`);
    await sleep(5000);
    current = await call<Invocation>("GET", `/convai/test-invocations/${current.id}`);
  }
  throw new Error(`invocation ${current.id} did not finish within ${INVOCATION_TIMEOUT_MINUTES} minutes`);
}

function toTurns(run: TestRun): Turn[] {
  return (run.agent_responses ?? [])
    .filter((t) => typeof t.message === "string" && t.message.trim().length > 0)
    .map((t) => ({ role: t.role, message: t.message as string }));
}

// --- results ----------------------------------------------------------------

interface ScenarioResult {
  id: string;
  brief_item: number | null;
  name: string;
  call_type: string;
  gym_id: string;
  why: string;
  passed: boolean;
  /**
   * Not passed, but not the agent's failure either: the platform cut the
   * conversation off (a judge timeout, or a local check that never got the
   * turn it needed). Counted as a failure in the totals — a truncated call is
   * no evidence — and labelled so a reader doesn't chase a behaviour that
   * wasn't there.
   */
  inconclusive: boolean;
  local: AssertionResult[];
  llm: { conditions: string[]; result: string | null; rationale: string | null; passed: boolean };
  turns: Turn[];
  error: string | null;
}

interface RunFile {
  run_at: string;
  label: string | null;
  /** Set on a re-score: the committed run whose transcripts and verdicts were re-scored. */
  rescored_from?: string;
  guards: { passed: number; total: number; results: GuardResult[] };
  conversations: {
    passed: number;
    total: number;
    /** Of the failures, how many the platform cut off before they could be judged. */
    inconclusive: number;
    by_agent: Record<string, { passed: number; total: number }>;
    results: ScenarioResult[];
  };
}

type Rationale = string | { summary?: string; messages?: string[] } | null | undefined;

function normaliseRationale(rationale: Rationale): string | null {
  if (!rationale) return null;
  if (typeof rationale === "string") return rationale;
  const messages = rationale.messages ?? [];
  const joined = messages.join(" ").trim();
  return joined || rationale.summary || null;
}

function summariseScenario(scenario: Scenario, run: TestRun | undefined): ScenarioResult {
  const base = {
    id: scenario.id,
    brief_item: scenario.briefItem,
    name: scenario.name,
    call_type: scenario.callType,
    gym_id: scenario.gymId,
    why: scenario.why,
  };

  if (!run) {
    return {
      ...base,
      passed: false,
      inconclusive: false,
      local: [],
      llm: { conditions: scenario.llm, result: null, rationale: null, passed: false },
      turns: [],
      error: "no test run came back for this scenario",
    };
  }

  const turns = toTurns(run);
  const judgeResult = run.condition_result?.result ?? (run.status === "passed" ? "success" : "failure");
  return scoreTranscript(base, scenario, turns, judgeResult, normaliseRationale(run.condition_result?.rationale));
}

function scoreTranscript(
  base: Pick<ScenarioResult, "id" | "brief_item" | "name" | "call_type" | "gym_id" | "why">,
  scenario: Scenario,
  turns: Turn[],
  judgeResult: string,
  rationale: string | null
): ScenarioResult {
  const local = assertionsFor(scenario).map((assert) => assert(turns));
  const llmPassed = judgeResult === "success";
  const passed = local.every((l) => l.passed) && llmPassed;
  // The platform's own words for a conversation it cut off, or a local check
  // that reported the same shape. Only a non-pass can be inconclusive.
  const truncated = /timed out/i.test(rationale ?? "") || local.some((l) => l.inconclusive);
  const behaviourFailed = local.some((l) => !l.passed && !l.inconclusive) || (!llmPassed && !/timed out/i.test(rationale ?? ""));

  return {
    ...base,
    passed,
    inconclusive: !passed && truncated && !behaviourFailed,
    local,
    llm: {
      conditions: scenario.llm,
      result: judgeResult,
      rationale,
      passed: llmPassed,
    },
    turns,
    error: null,
  };
}

function writeResults(file: RunFile) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = file.run_at.replace(/[:.]/g, "-");
  writeFileSync(join(RESULTS_DIR, `${stamp}.json`), JSON.stringify(file, null, 2));
  writeFileSync(join(RESULTS_DIR, "latest.json"), JSON.stringify(file, null, 2));
  writeFileSync(join(RESULTS_DIR, "latest.md"), markdown(file));
}

function markdown(file: RunFile): string {
  const lines: string[] = [];
  lines.push(`# Eval results`);
  lines.push("");
  lines.push(`Run ${file.run_at}${file.label ? ` — ${file.label}` : ""}.`);
  lines.push("");
  lines.push(
    `**Routing guards: ${file.guards.passed}/${file.guards.total}.** ` +
      `**Conversations: ${file.conversations.passed}/${file.conversations.total}.**` +
      (file.conversations.inconclusive > 0 ? ` ${file.conversations.inconclusive} of the rest inconclusive — cut off by the platform before they could be judged.` : "")
  );
  lines.push("");
  lines.push("## Routing guards");
  lines.push("");
  lines.push("| | Guard | Detail |");
  lines.push("|---|---|---|");
  for (const g of file.guards.results) {
    lines.push(`| ${g.passed ? "pass" : "**FAIL**"} | ${g.name} | ${g.detail.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## Conversations");
  lines.push("");
  for (const r of file.conversations.results) {
    lines.push(`### ${r.passed ? "pass" : r.inconclusive ? "**INCONCLUSIVE**" : "**FAIL**"} — ${r.name}`);
    lines.push("");
    lines.push(`\`${r.id}\` · ${r.call_type} agent · ${r.gym_id}${r.brief_item ? ` · brief item ${r.brief_item}` : ""}`);
    lines.push("");
    lines.push(r.why);
    lines.push("");
    if (r.error) lines.push(`- error: ${r.error}`);
    for (const l of r.local) lines.push(`- ${l.passed ? "pass" : l.inconclusive ? "**inconclusive**" : "**FAIL**"} (local) ${l.name} — ${l.detail}`);
    lines.push(
      `- ${r.llm.passed ? "pass" : "**FAIL**"} (judge) ${r.llm.conditions.join(" / ")}` +
        (r.llm.rationale ? ` — ${r.llm.rationale}` : "")
    );
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// --- main -------------------------------------------------------------------

async function main() {
  const runAt = new Date().toISOString();
  console.log(`Charlie evals — ${runAt}${LABEL ? ` (${LABEL})` : ""}\n`);

  console.log("Routing guards (no model, no network):");
  const guards = await runGuards();
  for (const g of guards) {
    console.log(`  ${g.passed ? "pass" : "FAIL"}  ${g.name}`);
    if (!g.passed) console.log(`        ${g.detail}`);
  }
  const guardsPassed = guards.filter((g) => g.passed).length;
  console.log(`  ${guardsPassed}/${guards.length}\n`);

  const selected = scenarios.filter((s) => !ONLY || ONLY.includes(s.id));
  const results: ScenarioResult[] = [];

  if (RESCORE) {
    const source = JSON.parse(readFileSync(join(RESULTS_DIR, `${RESCORE.replace(/.json$/, "")}.json`), "utf8")) as RunFile;
    console.log(`Re-scoring ${RESCORE} (${source.label ?? "no label"}) — no calls.`);
    for (const old of source.conversations.results) {
      const scenario = scenarios.find((s) => s.id === old.id);
      if (!scenario) throw new Error(`${old.id} is in ${RESCORE} but is no longer a scenario`);
      const base = { id: old.id, brief_item: old.brief_item, name: old.name, call_type: old.call_type, gym_id: old.gym_id, why: old.why };
      const result = old.error
        ? old
        : scoreTranscript(base, scenario, old.turns, old.llm.result ?? "failure", old.llm.rationale);
      results.push(result);
      if (old.passed !== result.passed) {
        console.log(`    ${old.passed ? "pass" : "FAIL"} -> ${result.passed ? "pass" : "FAIL"}  ${result.name}`);
        for (const l of result.local.filter((x) => !x.passed)) console.log(`          local: ${l.name} — ${l.detail}`);
      }
    }
  } else if (!GUARDS_ONLY) {
    if (!API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");
    for (const [callType, id] of Object.entries(AGENT_IDS)) {
      if (!id && selected.some((s) => s.callType === callType)) {
        throw new Error(`No agent id for ${callType}. Run: node scripts/sync-agents.mjs`);
      }
    }

    console.log(`Syncing ${selected.length} simulation test${selected.length === 1 ? "" : "s"}…`);
    const existing = new Map(
      (await listTests())
        .filter((t) => t.name?.startsWith(`${TEST_NAME_PREFIX}/`))
        .map((t) => [t.name as string, (t.id ?? t.test_id) as string])
    );
    const testIdByScenario = new Map<string, string>();
    for (const scenario of selected) {
      testIdByScenario.set(scenario.id, await ensureTest(scenario, existing));
    }

    const byAgent = new Map<string, Scenario[]>();
    for (const scenario of selected) {
      const list = byAgent.get(scenario.callType) ?? [];
      list.push(scenario);
      byAgent.set(scenario.callType, list);
    }

    for (const [callType, group] of byAgent) {
      console.log(`\n  ${callType} agent — ${group.length} scenario${group.length === 1 ? "" : "s"}`);
      const ids = group.map((s) => testIdByScenario.get(s.id)!);
      const invocation = await runAgentTests(AGENT_IDS[callType]!, ids);
      const runByTestId = new Map(invocation.test_runs.map((r) => [r.test_id, r]));
      for (const scenario of group) {
        const result = summariseScenario(scenario, runByTestId.get(testIdByScenario.get(scenario.id)!));
        results.push(result);
        console.log(`    ${result.passed ? "pass" : result.inconclusive ? "INCONCLUSIVE" : "FAIL"}  ${result.name}`);
        for (const l of result.local.filter((x) => !x.passed)) {
          console.log(`          local${l.inconclusive ? " (inconclusive)" : ""}: ${l.name} — ${l.detail}`);
        }
        if (!result.llm.passed) {
          console.log(`          judge: ${result.llm.rationale ?? result.llm.result}`);
        }
      }
    }
  }

  const byAgentCounts: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    const bucket = (byAgentCounts[r.call_type] ??= { passed: 0, total: 0 });
    bucket.total += 1;
    if (r.passed) bucket.passed += 1;
  }

  const file: RunFile = {
    run_at: runAt,
    label: LABEL,
    ...(RESCORE ? { rescored_from: RESCORE.replace(/.json$/, "") } : {}),
    guards: { passed: guardsPassed, total: guards.length, results: guards },
    conversations: {
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      inconclusive: results.filter((r) => r.inconclusive).length,
      by_agent: byAgentCounts,
      results,
    },
  };

  if (!GUARDS_ONLY) writeResults(file);

  console.log(
    `\nGuards ${guardsPassed}/${guards.length} · Conversations ${file.conversations.passed}/${file.conversations.total}` +
      (file.conversations.inconclusive > 0 ? ` (${file.conversations.inconclusive} inconclusive: cut off by the platform)` : "")
  );
  if (!GUARDS_ONLY) console.log(`Written to evals/results/latest.json and latest.md`);

  const failed = guardsPassed !== guards.length || file.conversations.passed !== file.conversations.total;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
