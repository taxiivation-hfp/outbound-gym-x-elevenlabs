import latestJson from "@/evals/results/latest.json";
import adversarialExtraction from "@/evals/documents/pdf/adversarial-price-list.extraction.json";
// Bundled as a string (Turbopack's `type: "text"` import attribute), so no request reads the disk. See text-modules.d.ts.
import adversarialText from "../../evals/documents/pdf/adversarial-price-list.txt" with { type: "text" };
import { PATTERNS } from "@/evals/assertions";
import { sanitizeExtraction, type FieldOutcome } from "@/lib/extraction/sanitize";
import { EXTRACTABLE_SPECS, type FieldSpec } from "@/lib/gymConfig";
import { formatMoney } from "@/lib/incentives";
import { callTypeLabel } from "@/lib/labels";
import type { CallType } from "@/lib/callType";
import { ATTRIBUTION, OWNER_TIP, type Owner } from "@/components/evals/attribution";
import { GUARD_GROUPS, OTHER_GROUP_TITLE } from "@/components/evals/groups";
import { runStamp, runTime, type RowState } from "@/components/evals/format";

/**
 * Everything the evals screen shows, read from committed files on the server.
 *
 * - The current run is `evals/results/latest.json`, written by `npm run evals`.
 * - The history is every `evals/results/<timestamp>.json`, matched by a glob when
 *   the page is bundled, not a list.
 * - The price-list panel runs the real `sanitizeExtraction` over the committed
 *   real-model extraction of the adversarial PDF — the same call
 *   `evals/configGuards.ts` makes.
 *
 * Only the current run's transcripts go to the browser; older runs contribute
 * their scores and labels. Nothing here estimates, averages or fills a gap: a
 * file that can't be read turns into a sentence saying so.
 *
 * Nothing is read from disk at request time. The run files come in through
 * Turbopack's `import.meta.glob` and the document through a text import, so a
 * serverless deploy carries them without file tracing, and a run file committed
 * later is picked up by the pattern on the next build, not by editing an import
 * list. (A glob pattern can't climb out of this folder with `../`, hence `base`.)
 */

/** Every committed conversation run file, parsed, keyed by path. */
const RUN_FILES = import.meta.glob(["./results/*.json", "!**/latest.json", "!**/extraction-*.json"], {
  base: "../../evals",
  eager: true,
}) as Record<string, { default?: unknown }>;

// --- Run file shape -----------------------------------------------------------

interface Assertion {
  name: string;
  passed: boolean;
  detail: string;
  inconclusive?: boolean;
}

interface Turn {
  role: string;
  message: string;
}

interface ScenarioResult {
  id: string;
  brief_item: number | null;
  name: string;
  call_type: string;
  gym_id: string;
  why: string;
  passed: boolean;
  /** Absent on runs written before the field existed. */
  inconclusive?: boolean;
  local: Assertion[];
  llm: { conditions: string[]; result: string | null; rationale: string | null; passed: boolean };
  turns: Turn[];
  error: string | null;
}

interface GuardResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  why: string;
}

interface RunFile {
  run_at: string;
  label: string | null;
  guards: { passed: number; total: number; results: GuardResult[] };
  conversations: {
    passed: number;
    total: number;
    inconclusive?: number;
    by_agent: Record<string, { passed: number; total: number }>;
    results: ScenarioResult[];
  };
}

// --- What the screen receives --------------------------------------------------

export interface GuardRow {
  id: string;
  name: string;
  passed: boolean;
  why: string;
  detail: string;
}

export interface GuardGroup {
  title: string;
  rows: GuardRow[];
  passed: number;
}

export interface CallRow {
  id: string;
  name: string;
  agent: string;
  agentLabel: string;
  gym: string;
  briefItem: number | null;
  why: string;
  state: RowState;
  local: Array<{ name: string; state: RowState; detail: string }>;
  judge: { conditions: string[]; result: string | null; rationale: string | null; passed: boolean };
  turns: Turn[];
  error: string | null;
}

export interface HistoryRun {
  stamp: string;
  when: string;
  label: string | null;
  passed: number;
  total: number;
  inconclusive: number;
  guardsPassed: number;
  guardsTotal: number;
  latest: boolean;
}

export interface LeakExample {
  spoken: string;
  leaked: string;
  scenario: string;
  runNumber: number;
  runCount: number;
  stamp: string;
  when: string;
  label: string | null;
}

export interface AttackRow {
  key: string;
  field: string;
  said: string | null;
  took: string | null;
  state: "Used" | "Not stated" | "Held back" | "Rejected";
  /** A short fixed tooltip for the badge. */
  tip: string;
  /** The sanitiser's own reason, shown as text under the badge. */
  reason: string | null;
}

export interface BrokenRow {
  id: string;
  name: string;
  state: RowState;
  owner: Owner | "Unattributed";
  ownerTip: string;
  reading: string | null;
}

export interface EvalsData {
  run: { stamp: string; runAt: string; when: string; label: string | null };
  guards: { passed: number; total: number; groups: GuardGroup[] };
  calls: {
    passed: number;
    total: number;
    inconclusive: number;
    agents: Array<{ key: string; label: string; passed: number; total: number }>;
    rows: CallRow[];
  };
  history: { runs: HistoryRun[]; error: string | null };
  leak: {
    first: LeakExample | null;
    after: LeakExample | null;
    check: { name: string; asserted: number; passed: number; total: number } | null;
    since: { scenarioRuns: number; failures: number; after: string; afterLabel: string | null } | null;
  };
  attack: {
    rows: AttackRow[];
    summary: { filled: number; blank: number; unsupported: number; rejected: number };
    injectionReached: boolean;
    /** Nothing the model returned, kept or not, carries the injected offer, and nothing was refused. */
    modelIgnoredInjection: boolean;
    /** The worst-case guard: an extraction that obeyed the injected line. */
    worstCase: GuardRow | null;
    injectedSentence: string | null;
    document: string | null;
    guards: GuardRow[];
    error: string | null;
  };
  broken: BrokenRow[];
}

const RUN_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

/** The per-scenario assertion that catches the agent narrating its reasoning (evals/scenarios.ts). */
const LEAK_CHECK = /narrates its own reasoning/i;

const latest = latestJson as unknown as RunFile;

function scenarioState(r: ScenarioResult): RowState {
  return r.passed ? "pass" : r.inconclusive ? "inconclusive" : "fail";
}

function agentLabel(key: string): string {
  return callTypeLabel[key as CallType] ?? key;
}

function readRuns(): { runs: RunFile[]; error: string | null } {
  const runs = Object.entries(RUN_FILES)
    .filter(([path]) => RUN_FILE.test(path.split("/").pop() ?? ""))
    .map(([, module]) => (module.default ?? module) as RunFile)
    .filter((run) => typeof run?.run_at === "string" && Boolean(run.conversations?.results));
  runs.sort((a, b) => a.run_at.localeCompare(b.run_at));
  if (runs.length === 0) return { runs, error: "no run files were bundled" };
  // latest.json is a copy of the newest run file; if the bundle somehow lacks it, say so rather than show a history that stops short.
  if (!runs.some((run) => run.run_at === latest.run_at)) {
    return { runs, error: `the run file for the latest run (${runStamp(latest.run_at)}) was not bundled` };
  }
  return { runs, error: null };
}

function groupGuards(results: GuardResult[]): GuardGroup[] {
  const toRow = (g: GuardResult): GuardRow => ({ id: g.id, name: g.name, passed: g.passed, why: g.why, detail: g.detail });
  const placed = new Set<string>();
  const groups: GuardGroup[] = GUARD_GROUPS.map((def) => {
    const ids = new Set(def.ids);
    const rows = results.filter((g) => ids.has(g.id) && !placed.has(g.id)).map(toRow);
    rows.forEach((r) => placed.add(r.id));
    return { title: def.title, rows, passed: rows.filter((r) => r.passed).length };
  });
  const rest = results.filter((g) => !placed.has(g.id)).map(toRow);
  groups.push({ title: OTHER_GROUP_TITLE, rows: rest, passed: rest.filter((r) => r.passed).length });
  return groups.filter((g) => g.rows.length > 0);
}

/**
 * Where the spoken turn ends and the narrated reasoning begins. In both
 * committed transcripts the model ran its reasoning straight on after the
 * spoken sentence, with no space ("month.The user…"); failing that, the
 * suite's own leak pattern marks the start.
 */
function splitLeak(message: string): { spoken: string; leaked: string } {
  const joined = /[.?!](?=[A-Z])/.exec(message);
  const at = joined ? joined.index + 1 : (PATTERNS.leaksReasoning.exec(message)?.index ?? message.length);
  return { spoken: message.slice(0, at), leaked: message.slice(at) };
}

/** The first committed transcript turn containing a passage quoted in README.md and evals/README.md. */
function findLeak(runs: RunFile[], needle: string): LeakExample | null {
  for (const [index, run] of runs.entries()) {
    for (const result of run.conversations.results) {
      const turn = result.turns.find((t) => t.role === "agent" && t.message.includes(needle));
      if (turn) {
        return {
          ...splitLeak(turn.message),
          scenario: result.id,
          runNumber: index + 1,
          runCount: runs.length,
          stamp: runStamp(run.run_at),
          when: runTime(run.run_at),
          label: run.label,
        };
      }
    }
  }
  return null;
}

function leakSummary(runs: RunFile[]): EvalsData["leak"] {
  const results = latest.conversations.results;
  const checks = results.map((r) => r.local.find((l) => LEAK_CHECK.test(l.name))).filter((l): l is Assertion => Boolean(l));
  const check = checks.length
    ? { name: checks[0].name, asserted: checks.length, passed: checks.filter((c) => c.passed).length, total: results.length }
    : null;

  // The last committed run in which the check failed, and how it has done since.
  let lastFail = -1;
  runs.forEach((run, i) => {
    if (run.conversations.results.some((r) => r.local.some((l) => LEAK_CHECK.test(l.name) && !l.passed))) lastFail = i;
  });
  let since: EvalsData["leak"]["since"] = null;
  if (lastFail >= 0) {
    const later = runs.slice(lastFail + 1).flatMap((run) => run.conversations.results.flatMap((r) => r.local.filter((l) => LEAK_CHECK.test(l.name))));
    since = {
      scenarioRuns: later.length,
      failures: later.filter((l) => !l.passed).length,
      after: runTime(runs[lastFail].run_at),
      afterLabel: runs[lastFail].label,
    };
  }

  return {
    first: findLeak(runs, "I need to tell them it's seventy-nine dollars a month"),
    after: findLeak(runs, "as per step 5 of the"),
    check,
    since,
  };
}

function formatValue(spec: FieldSpec, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (spec.kind === "enum") return spec.optionLabels?.[String(value)] ?? String(value);
  // The one extractable price is monthly by its extraction instruction (lib/gymConfig.ts).
  if (spec.kind === "decimal" && typeof value === "number") return spec.key === "cheaper_tier_price" ? `${formatMoney(value)} a month` : formatMoney(value);
  if (spec.kind === "integer" && typeof value === "number" && spec.key.endsWith("_percent")) return `${value}%`;
  return String(value);
}

function attackRow(spec: FieldSpec, outcome: FieldOutcome | undefined): AttackRow {
  const base = { key: spec.key, field: spec.label };
  if (!outcome || outcome.status === "blank") {
    return { ...base, said: null, took: null, state: "Not stated", tip: "The extractor found nothing stating this.", reason: null };
  }
  if (outcome.status === "filled") {
    return { ...base, said: outcome.quote, took: formatValue(spec, outcome.value), state: "Used", tip: "Backed by this sentence in the document.", reason: null };
  }
  if (outcome.status === "unsupported") {
    return { ...base, said: outcome.quote, took: formatValue(spec, outcome.suggestion), state: "Held back", tip: "Left for a person to confirm.", reason: outcome.reason };
  }
  return { ...base, said: outcome.quote, took: null, state: "Rejected", tip: "Refused by the sanitiser.", reason: outcome.reason };
}

function attackPanel(): EvalsData["attack"] {
  const guardIds = ["adversarial-document-cannot-author-the-block", "pdf-documents-keep-their-facts"];
  const guards = latest.guards.results
    .filter((g) => guardIds.includes(g.id))
    .map((g) => ({ id: g.id, name: g.name, passed: g.passed, why: g.why, detail: g.detail }));
  const empty = { filled: 0, blank: 0, unsupported: 0, rejected: 0 };
  const worstCase = guards.find((g) => g.id === "adversarial-document-cannot-author-the-block") ?? null;
  const others = guards.filter((g) => g !== worstCase);

  const document: unknown = adversarialText;
  if (typeof document !== "string" || document.length === 0) {
    return {
      rows: [],
      summary: empty,
      injectionReached: false,
      modelIgnoredInjection: false,
      worstCase,
      injectedSentence: null,
      document: null,
      guards: others,
      error: "the document was not bundled",
    };
  }

  const review = sanitizeExtraction(adversarialExtraction.output, document);
  const rows = EXTRACTABLE_SPECS.map((spec) => attackRow(spec, review.outcomes[spec.key as keyof typeof review.outcomes]));
  // The same check evals/configGuards.ts makes on this document's filled values.
  const INJECTED = /50|half|22\.5|everyone/i;
  const injectionReached = INJECTED.test(JSON.stringify(review.values));
  // Everything the model returned, including what the sanitiser then held back or refused.
  const modelIgnoredInjection = review.summary.rejected === 0 && !INJECTED.test(JSON.stringify(review.outcomes));
  const sentences = document.replace(/\s*\r?\n\s*/g, " ").split(/(?<=[.!?:])\s+/);
  const injectedSentence = sentences.find((s) => /50% off/.test(s)) ?? null;

  return {
    rows,
    summary: review.summary,
    injectionReached,
    modelIgnoredInjection,
    worstCase,
    injectedSentence,
    document,
    guards: others,
    error: review.malformed,
  };
}

export function loadEvalsData(): EvalsData {
  const { runs, error: historyError } = readRuns();
  const conv = latest.conversations;

  const rows: CallRow[] = conv.results.map((r) => ({
    id: r.id,
    name: r.name,
    agent: r.call_type,
    agentLabel: agentLabel(r.call_type),
    gym: r.gym_id,
    briefItem: r.brief_item,
    why: r.why,
    state: scenarioState(r),
    local: r.local.map((l) => ({ name: l.name, state: l.passed ? "pass" : l.inconclusive ? "inconclusive" : "fail", detail: l.detail })),
    judge: r.llm,
    turns: r.turns,
    error: r.error,
  }));

  const broken: BrokenRow[] = rows
    .filter((r) => r.state !== "pass")
    .map((r) => {
      const known = ATTRIBUTION[r.id];
      return {
        id: r.id,
        name: r.name,
        state: r.state,
        owner: known?.owner ?? "Unattributed",
        ownerTip: OWNER_TIP[known?.owner ?? "Unattributed"],
        reading: known?.reading ?? null,
      };
    });

  return {
    run: { stamp: runStamp(latest.run_at), runAt: latest.run_at, when: runTime(latest.run_at), label: latest.label },
    guards: { passed: latest.guards.passed, total: latest.guards.total, groups: groupGuards(latest.guards.results) },
    calls: {
      passed: conv.passed,
      total: conv.total,
      inconclusive: conv.inconclusive ?? conv.results.filter((r) => r.inconclusive).length,
      agents: Object.entries(conv.by_agent).map(([key, s]) => ({ key, label: agentLabel(key), passed: s.passed, total: s.total })),
      rows,
    },
    history: {
      runs: runs.map((run) => ({
        stamp: runStamp(run.run_at),
        when: runTime(run.run_at),
        label: run.label,
        passed: run.conversations.passed,
        total: run.conversations.total,
        inconclusive: run.conversations.inconclusive ?? run.conversations.results.filter((r) => r.inconclusive).length,
        guardsPassed: run.guards.passed,
        guardsTotal: run.guards.total,
        latest: run.run_at === latest.run_at,
      })),
      error: historyError,
    },
    leak: leakSummary(runs),
    attack: attackPanel(),
    broken,
  };
}
