import latest from "@/evals/results/latest.json";

/**
 * What the latest committed eval run says about each commitment on the About
 * page. Nothing here is typed in: every status is read out of
 * `evals/results/latest.json`, the same file `/evals` renders, so the page
 * cannot claim a check passed that the run file says failed.
 */

interface LocalAssertion {
  passed: boolean;
}

interface ScenarioRow {
  id: string;
  name: string;
  passed: boolean;
  inconclusive?: boolean;
  local: LocalAssertion[];
  llm: { passed: boolean };
}

interface GuardRow {
  id: string;
  name: string;
  passed: boolean;
}

const run = latest as unknown as {
  run_at: string;
  guards: { results: GuardRow[] };
  conversations: { results: ScenarioRow[] };
};

export const LATEST_RUN_AT = run.run_at;

export interface CheckResult {
  id: string;
  name: string;
  kind: "scenario" | "guard";
  passed: boolean;
  /** The call was cut off mid-turn: the platform, not the agent. */
  inconclusive: boolean;
  /** Every regex assertion passed and only the judge failed it. */
  judgeOnly: boolean;
}

export interface Evidence {
  checks: CheckResult[];
  /** Ids named for this commitment that the latest run does not contain. */
  missing: string[];
}

export function evidenceFor(ids: { scenarios: string[]; guards: string[] }): Evidence {
  const checks: CheckResult[] = [];
  const missing: string[] = [];

  for (const id of ids.scenarios) {
    const row = run.conversations.results.find((r) => r.id === id);
    if (!row) {
      missing.push(id);
      continue;
    }
    checks.push({
      id,
      name: row.name,
      kind: "scenario",
      passed: row.passed,
      inconclusive: Boolean(row.inconclusive),
      judgeOnly: !row.passed && row.local.every((a) => a.passed) && !row.llm.passed,
    });
  }

  for (const id of ids.guards) {
    const row = run.guards.results.find((r) => r.id === id);
    if (!row) {
      missing.push(id);
      continue;
    }
    checks.push({ id, name: row.name, kind: "guard", passed: row.passed, inconclusive: false, judgeOnly: false });
  }

  if (missing.length > 0) {
    console.error(`About page: eval ids not found in evals/results/latest.json: ${missing.join(", ")}`);
  }

  return { checks, missing };
}
