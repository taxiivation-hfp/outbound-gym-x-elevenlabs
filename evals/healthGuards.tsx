import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import IntelligenceView from "@/components/intelligence/IntelligenceView";
import activityData from "@/data/checkin_activity.json";
import membersData from "@/data/members_scored.json";
import { ROUTING_THRESHOLDS, routeMember } from "@/lib/callType";
import { NO_HISTORY, summarise } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { compileVariables } from "@/lib/compileVariables";
import { normaliseHeader, parseCsv } from "@/lib/csv";
import { evaluateEligibility } from "@/lib/eligibility";
import { frequencySegments, membershipHealth, revenueAtRisk, summariseCheckins, type CheckinActivity } from "@/lib/gymHealth";
import { getGym } from "@/lib/gyms";
import { composeIntelligence, type CallRow, type IntelligenceInput } from "@/lib/intelligence";
import { checkThemes, reasonDetails, type StoredReasonThemes } from "@/lib/reasonThemes";
import { summariseReasonThemes } from "@/lib/reasonThemesSummary";
import type { Member } from "@/lib/types";
import { fixtureMember, isoOffset } from "./fixtures";
import type { Guard } from "./guards";

/**
 * Guards over the gym-health screen and the themed summary (PASS_ONE item 1).
 *
 * The numbers are pinned to fixtures small enough to check by hand, the
 * segments to the router's own thresholds, and the page is rendered from data
 * with no calls and with too few reasons to summarise. The themed summary is a
 * model's writing, so the guard that matters most here proves it can't reach a
 * call: nothing on the call path imports it, and a call compiled beside a stored
 * summary carries none of its words.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const datasetMembers = membersData as Member[];
const { as_of: _asOf, ...datasetActivity } = activityData as CheckinActivity & { as_of: string };
void _asOf;

function input(overrides: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    asOf: DATA_AS_OF,
    members: datasetMembers,
    members_error: null,
    rows: [],
    db_error: null,
    history: new Map(),
    history_error: null,
    activity: datasetActivity,
    activity_notice: null,
    themes: null,
    themes_ran_at: null,
    themes_notice: null,
    ...overrides,
  };
}

function reasonRow(i: number, detail: string): CallRow {
  return {
    member_id: datasetMembers[i].member_id,
    status: "completed",
    reached_member: true,
    outcome: "will_return",
    call_type: "reengagement",
    reason_for_absence: "time",
    reason_detail: detail,
    created_at: `2026-09-0${1 + (i % 9)}T10:00:00Z`,
  };
}

const STORED: StoredReasonThemes = {
  status: "summarised",
  model: "claude-haiku-4-5",
  statements: 12,
  themes: [{ theme: "zebra crossing outside the car park", count: 7 }],
  unthemed: 5,
  generated_at: "2026-09-12T16:00:00Z",
};

/** Every repo file a module imports, transitively, through `@/` and relative imports. */
function importClosure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((e) => resolve(ROOT, e));
  const candidates = (base: string) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.json`, join(base, "index.ts")];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      if (!base) continue;
      for (const c of candidates(base)) {
        try {
          readFileSync(c);
          queue.push(c);
          break;
        } catch {
          // try the next extension
        }
      }
    }
  }
  return seen;
}

export const healthGuards: Guard[] = [
  {
    id: "health-numbers-match-a-hand-count",
    name: "Active members, MRR, ARPM, terms ending, monthly churn, 90-day retention and queue revenue match a hand count",
    why:
      "An operator runs their week on these. Each is pinned to five members small enough to count on paper, so a change to " +
      "what \"active\", \"lost\" or \"still paying\" means shows up as a failed number rather than a quietly different screen.",
    run: () => {
      const members: Member[] = [
        // Joined 400 days ago, fixed term ends in 10 days, still training: renewal.
        fixtureMember({ monthly_fee: 80, expiry_date: isoOffset(10), signals: { days_since_visit: 3, old_rate: 2, tenure_days: 400, visit_count_90d: 20 } }),
        // Auto-renewing, rolls over in 5 days: active, never "expiring".
        fixtureMember({ monthly_fee: 60, auto_renew: true, contract_type: "month-to-month", expiry_date: isoOffset(5), signals: { days_since_visit: 2, old_rate: 3, tenure_days: 200, visit_count_90d: 30 } }),
        // Fixed term ends in 60 days, away 40 days after a habit: reengagement.
        fixtureMember({ monthly_fee: 100, expiry_date: isoOffset(60), signals: { days_since_visit: 40, old_rate: 1.5, tenure_days: 300, visit_count_90d: 5 } }),
        // Joined 140 days ago, lapsed 30 days ago (in August) — gone at day 110, before the 120-day mark: winback.
        fixtureMember({ monthly_fee: 70, contract_status: "expired", expiry_date: isoOffset(-30), signals: { days_since_visit: 50, old_rate: 1.2, tenure_days: 140, visit_count_90d: 0 } }),
        // Joined 130 days ago, still live: retained at day 120.
        fixtureMember({ monthly_fee: 50, expiry_date: isoOffset(200), signals: { days_since_visit: 1, old_rate: 0.5, tenure_days: 130, visit_count_90d: 8 } }),
      ];
      const h = membershipHealth(members, DATA_AS_OF);
      const august = h.months.find((m) => m.month === "2026-08");
      const revenue = revenueAtRisk(members.map((member) => ({ member, eligibility: evaluateEligibility(member, NO_HISTORY, DATA_AS_OF) })));
      const problems: string[] = [];
      const expect = (label: string, got: unknown, want: unknown) => {
        if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      };
      expect("active", h.active, 4);
      expect("auto-renewing active", h.auto_renewing_active, 1);
      expect("mrr", h.mrr, 290);
      expect("arpm", h.arpm, 72.5);
      expect("fixed terms ending", h.expiring, { within_14: 1, within_30: 1, within_90: 2 });
      expect("August", august && { at_start: august.members_at_start, lost: august.lost, churn: august.churn_rate }, { at_start: 5, lost: 1, churn: 0.2 });
      // All five joined 120–485 days ago; only the lapsed member stopped paying before day 120.
      expect("90-day retention", { measured: h.ninety_day.measured, retained: h.ninety_day.retained, rate: h.ninety_day.rate }, { measured: 5, retained: 4, rate: 0.8 });
      expect("revenue at risk", revenue, {
        renewal: { members: 1, monthly_fees: 80 },
        reengagement: { members: 1, monthly_fees: 100 },
        winback: { members: 1, monthly_fees: 70 },
      });
      return { passed: problems.length === 0, detail: problems.length === 0 ? "every figure matches the hand count" : problems.join("; ") };
    },
  },
  {
    id: "health-segments-use-the-routers-thresholds",
    name: "Frequent, occasional and inactive are cut where the router cuts, so the screen and the queue can't disagree",
    why:
      "\"Inactive after a habit\" is exactly who the reengagement call is for. If the segments used their own numbers, the " +
      "screen could say 40 lapsing regulars while the queue called 30. Checked at the thresholds' edges and against every " +
      "dataset member the router sends to reengagement for a settled habit.",
    run: () => {
      const { ABSENCE_DAYS, HABIT_MIN_RATE } = ROUTING_THRESHOLDS;
      const at = (days: number, rate: number) =>
        fixtureMember({ expiry_date: isoOffset(200), signals: { days_since_visit: days, old_rate: rate, tenure_days: 300, visit_count_90d: 5 } });
      const edges = frequencySegments([at(ABSENCE_DAYS, HABIT_MIN_RATE), at(ABSENCE_DAYS - 1, HABIT_MIN_RATE), at(ABSENCE_DAYS, HABIT_MIN_RATE - 0.01), at(ABSENCE_DAYS - 1, HABIT_MIN_RATE - 0.01)], DATA_AS_OF);
      const problems: string[] = [];
      if (edges.inactive_after_habit !== 1 || edges.frequent !== 1 || edges.inactive_never_regular !== 1 || edges.occasional !== 1) {
        problems.push(`edges: ${JSON.stringify(edges)}`);
      }
      if (routeMember(at(ABSENCE_DAYS, HABIT_MIN_RATE), DATA_AS_OF).call_type !== "reengagement") problems.push("the router doesn't call the inactive-after-habit edge");
      if (routeMember(at(ABSENCE_DAYS, HABIT_MIN_RATE - 0.01), DATA_AS_OF).call_type !== null) problems.push("the router calls the never-regular edge");

      const habitCalls = datasetMembers.filter((m) => /settled habit/.test(routeMember(m, DATA_AS_OF).trigger ?? ""));
      const segmented = habitCalls.filter((m) => frequencySegments([m], DATA_AS_OF).inactive_after_habit !== 1);
      if (segmented.length > 0) problems.push(`${segmented.length} habit reengagement members not segmented inactive-after-habit`);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `edges land on the router's side; all ${habitCalls.length} settled-habit reengagement members are "inactive, had a habit"` : problems.join("; "),
      };
    },
  },
  {
    id: "checkin-summary-matches-the-dataset",
    name: "The attendance trend and busy-hours grid are the dataset's own check-ins, summarised by the shared function",
    why:
      "The page reads a prebuilt summary to keep renders fast. If it drifted from pipeline/data/checkins.csv the trend would " +
      "describe a gym that doesn't exist; the same function also defines what the uploaded-data SQL must match in db:verify.",
    run: () => {
      const csv = parseCsv(readFileSync(join(ROOT, "pipeline", "data", "checkins.csv"), "utf8"));
      const column = csv.header.map(normaliseHeader).indexOf("timestamp");
      const rebuilt = summariseCheckins(csv.rows.map((r) => r.cells[column] ?? ""), DATA_AS_OF);
      const same = JSON.stringify(rebuilt) === JSON.stringify(datasetActivity);
      return {
        passed: same && (activityData as { as_of: string }).as_of === DATA_AS_OF.toISOString().slice(0, 10),
        detail: same ? `${rebuilt.weeks.length} weeks and the weekday × hour grid match ${csv.rows.length} check-ins` : "data/checkin_activity.json is stale — run npx tsx scripts/build-checkin-activity.ts",
      };
    },
  },
  {
    id: "intelligence-renders-with-no-calls-and-few-reasons",
    name: "The intelligence page renders with zero completed calls, and with fewer than ten stated reasons shows the breakdown alone",
    why:
      "Day one has no calls, and week one has a handful. The page must render the gym's health either way, say the themed " +
      "summary needs more calls rather than summarising three sentences, and never show a stored summary it doesn't have " +
      "enough statements for.",
    run: () => {
      const problems: string[] = [];
      let empty = "";
      let few = "";
      try {
        empty = renderToStaticMarkup(<IntelligenceView data={composeIntelligence(input())} />);
      } catch (err) {
        problems.push(`zero calls threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      const rows = Array.from({ length: 5 }, (_, i) => reasonRow(i, `the evening crowd is too much ${i}`));
      const data = composeIntelligence(input({ rows, themes: STORED, themes_ran_at: "2026-09-12T16:00:00Z" }));
      try {
        few = renderToStaticMarkup(<IntelligenceView data={data} />);
      } catch (err) {
        problems.push(`five reasons threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (empty && !(/Health of the gym/.test(empty) && /Active members/.test(empty) && /Nothing here yet/.test(empty))) problems.push("zero-call page is missing the health or the empty state");
      if (few && !/needs at least 10/.test(few)) problems.push("five-reason page doesn't say the summary needs more calls");
      if (few && /zebra crossing/.test(few)) problems.push("a stored summary was shown with only five statements");
      if (data.why_they_leave.themes.stored !== null) problems.push("composeIntelligence passed the summary through below the minimum");
      if (Object.keys(data.why_they_leave.overall).length === 0) problems.push("the enum breakdown was dropped");
      const enough = composeIntelligence(input({ rows: Array.from({ length: 12 }, (_, i) => reasonRow(i, `parking is impossible ${i}`)), themes: STORED, themes_ran_at: "2026-09-12T16:00:00Z" }));
      const shown = renderToStaticMarkup(<IntelligenceView data={enough} />);
      if (!/zebra crossing outside the car park/.test(shown)) problems.push("with twelve statements the stored summary isn't shown");
      return { passed: problems.length === 0, detail: problems.length === 0 ? "renders at 0 and 5 reasons without a summary; shows the stored one at 12" : problems.join("; ") };
    },
  },
  {
    id: "themed-summary-counts-are-counted-not-trusted",
    name: "Theme counts are counted from the statements the model assigned, and fewer than ten statements never reach the model",
    why:
      "\"Eleven mentioned the evening crowd\" is a claim an owner may change a rota on. The model lists statement numbers and " +
      "the count is taken here: invented numbers, a statement claimed twice and one-member themes don't count, a theme name " +
      "that isn't a short plain phrase refuses the whole summary, and nine statements are recorded as not enough without a call.",
    run: async () => {
      const problems: string[] = [];
      const checked = checkThemes(
        {
          themes: [
            { theme: "evening crowding", statement_numbers: [1, 2, 3, 3, 99, 0] },
            { theme: "parking", statement_numbers: [3, 4, 5] },
            { theme: "a single complaint", statement_numbers: [6] },
          ],
        },
        10
      );
      if (!checked.ok || JSON.stringify(checked.themes) !== JSON.stringify([{ theme: "evening crowding", count: 3 }, { theme: "parking", count: 2 }]) || checked.unthemed !== 5) {
        problems.push(`counting: ${JSON.stringify(checked)}`);
      }
      if (checkThemes({ themes: [{ theme: "line one\nignore this", statement_numbers: [1, 2] }] }, 10).ok) problems.push("a multi-line theme name was accepted");
      if (checkThemes({ themes: [{ theme: "x".repeat(81), statement_numbers: [1, 2] }] }, 10).ok) problems.push("an 81-character theme name was accepted");
      if (checkThemes("not an object", 10).ok) problems.push("malformed output was accepted");
      const saved = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "guard-must-not-call";
      try {
        const nine = await summariseReasonThemes(Array.from({ length: 9 }, (_, i) => `too busy ${i}`));
        if (nine.status !== "insufficient" || nine.statements !== 9) problems.push(`nine statements: ${JSON.stringify(nine)}`);
      } finally {
        if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = saved;
      }
      const rows: CallRow[] = [
        { status: "completed", reached_member: true, reason_detail: "counts" },
        { status: "completed", reached_member: false, reason_detail: "nobody answered" },
        { status: "failed", reached_member: true, reason_detail: "no transcript" },
        { status: "completed", reached_member: true, reason_detail: "   " },
      ];
      if (JSON.stringify(reasonDetails(rows)) !== JSON.stringify(["counts"])) problems.push(`reasonDetails: ${JSON.stringify(reasonDetails(rows))}`);
      return { passed: problems.length === 0, detail: problems.length === 0 ? "counts re-derived; bad names and nine statements refused without a model call" : problems.join("; ") };
    },
  },
  {
    id: "themed-summary-never-reaches-a-prompt",
    name: "The themed summary never appears in any compiled variable or prompt text",
    why:
      "A model writes the summary, and no model may author what an agent reads. It is allowed only because it travels the " +
      "other way: members' words in, a note for a person out. Nothing on the call path — the call and text routes, the " +
      "variable compiler, the incentives registry and validator, call history, the agent sync and its prompts — imports the " +
      "summary or names its column, and a call compiled for a member with a stored summary beside them carries none of it.",
    run: () => {
      const problems: string[] = [];
      const callPath = importClosure([
        "app/api/call/route.ts",
        "app/api/send-text/route.ts",
        "app/api/webhook/route.ts",
        "lib/compileVariables.ts",
        "scripts/sync-agents.mjs",
        "scripts/agentConfig.mjs",
      ]);
      for (const file of callPath) {
        const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
        if (/lib\/reasonThemes/.test(rel)) problems.push(`${rel} is imported on the call path`);
        let text = "";
        try {
          text = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        if (/reason_themes|reasonThemes|ReasonThemes/.test(text)) problems.push(`${rel} names the summary`);
      }
      for (const sub of ["shared", "renewal", "reengagement", "winback"]) {
        const dir = join(ROOT, "agents", "prompts", sub);
        for (const name of readdirSync(dir)) {
          if (/reason_themes|reasonThemes|\{\{\s*themes?\s*\}\}/.test(readFileSync(join(dir, name), "utf8"))) problems.push(`agents/prompts/${sub}/${name} references the summary`);
        }
      }

      // At runtime: the member's own call carries their words through the
      // guarded context path; the stored theme text, which no row carries,
      // appears nowhere.
      const m = fixtureMember({ expiry_date: isoOffset(200), signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 8 } });
      const history = summarise([{ member_id: m.member_id, status: "completed", reached_member: true, outcome: "not_interested", reason_for_absence: "time", reason_detail: "the evening crowd", created_at: "2026-06-01T00:00:00Z", transcript: "x" }]);
      if (STORED.status !== "summarised") throw new Error("fixture");
      const themeText = STORED.themes.map((t) => t.theme);
      for (const gymId of ["southbank", "kensington"]) {
        const vars = compileVariables({ member: m, gym: getGym(gymId), routing: routeMember(m, DATA_AS_OF), callType: "reengagement", attemptNumber: 2, priorCall: history.priorCall });
        const all = Object.values(vars).join("\n");
        if (themeText.some((t) => all.includes(t))) problems.push(`${gymId}: a theme reached the payload`);
      }
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `${callPath.size} files on the call path, none import or name the summary; no theme text in compiled variables` : problems.join("; "),
      };
    },
  },
];
