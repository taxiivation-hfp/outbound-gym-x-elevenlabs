import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import membersData from "@/data/members_scored.json";
import { callRefusal } from "@/lib/callGate";
import { routeMember } from "@/lib/callType";
import { NO_HISTORY } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { normaliseHeader, parseCsv } from "@/lib/csv";
import { evaluateEligibility } from "@/lib/eligibility";
import { parseImport } from "@/lib/memberImport";
import type { Member } from "@/lib/types";
import { fixtureMember, isoOffset } from "./fixtures";
import type { Guard } from "./guards";

/**
 * Guards over cancellation requests (PASS_ONE item 5).
 *
 * This pass adds the field, generates it and shows it. It does not change who
 * is called, and the first guard exists to make that a deliberate edit in the
 * pass that does: an auto-renewing member who has asked to cancel is still
 * excluded by the router and still refused by /api/call.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DAY_MS = 86_400_000;
const members = membersData as Member[];

export const cancellationGuards: Guard[] = [
  {
    id: "cancellation-flag-does-not-yet-change-who-is-called",
    name: "A member with cancellation_requested set and auto_renew true is still excluded by the router and still gets a 403 from /api/call",
    why:
      "A cancellation request is the one case where the auto-renew exclusion should one day lift, because the call is no " +
      "longer the only thing that could end the membership. That flip, and the agent that handles it, belong to pass two, " +
      "so the most important rule in the system changes in the same pass as the thing that needs it. Until then this pins " +
      "the current behaviour: pass two has to change this guard deliberately, not change behaviour quietly.",
    run: () => {
      const problems: string[] = [];
      const flagged = members.filter((m) => m.cancellation_requested && m.auto_renew);
      const fixture = fixtureMember({
        auto_renew: true,
        contract_type: "month-to-month",
        expiry_date: isoOffset(9),
        cancellation_requested: `${isoOffset(-3)}T18:30:00`,
        signals: { days_since_visit: 90, old_rate: 2.5, tenure_days: 500, visit_count_90d: 0 },
      });
      if (flagged.length === 0) problems.push("the dataset has no auto-renewing member with a cancellation request to check");
      for (const member of [fixture, ...flagged]) {
        const routing = routeMember(member, DATA_AS_OF);
        const eligibility = evaluateEligibility(member, NO_HISTORY, DATA_AS_OF);
        const refusal = callRefusal(eligibility);
        if (routing.call_type !== null || !routing.auto_renew_excluded) problems.push(`${member.member_id}: router sends ${routing.call_type}`);
        if (refusal?.status !== 403 || refusal.body.blocked_by !== "auto_renew") problems.push(`${member.member_id}: /api/call answers ${JSON.stringify(refusal)}`);
      }
      // The flag changes nothing for anyone: every flagged member routes exactly as they would without it.
      const changed = members
        .filter((m) => m.cancellation_requested)
        .filter((m) => JSON.stringify(routeMember(m, DATA_AS_OF)) !== JSON.stringify(routeMember({ ...m, cancellation_requested: null }, DATA_AS_OF)));
      if (changed.length > 0) problems.push(`the flag changed routing for ${changed.map((m) => m.member_id).join(", ")}`);
      return {
        passed: problems.length === 0,
        detail:
          problems.length === 0
            ? `${flagged.length} flagged auto-renewers and a fixture: excluded, 403 auto_renew; no flagged member's routing differs from unflagged`
            : problems.join("; "),
      };
    },
  },
  {
    id: "generated-cancellations-obey-both-exclusion-rules",
    name: "Generated cancellation requests never go to someone who checked in within the last week or visits more than twice a week",
    why:
      "People who are coming in don't cancel, and a flag on a four-times-a-week member makes the whole dataset look " +
      "fabricated. Checked against the raw check-ins rather than the derived counts, along with the shape the generator " +
      "promises: about 5% of members, requested after their last visit and before the dataset's date.",
    run: () => {
      const problems: string[] = [];
      const csv = parseCsv(readFileSync(join(ROOT, "pipeline", "data", "checkins.csv"), "utf8"));
      const header = csv.header.map(normaliseHeader);
      const idCol = header.indexOf("memberid");
      const tsCol = header.indexOf("timestamp");
      const today = DATA_AS_OF.getTime();
      const visits = new Map<string, number[]>();
      for (const row of csv.rows) {
        const t = Date.parse(`${row.cells[tsCol]}Z`);
        const list = visits.get(row.cells[idCol]) ?? [];
        list.push(t);
        visits.set(row.cells[idCol], list);
      }
      const flagged = members.filter((m) => m.cancellation_requested);
      for (const m of flagged) {
        const mine = visits.get(m.member_id) ?? [];
        const lastWeek = mine.filter((t) => t >= today - 7 * DAY_MS && t < today).length;
        const lastFourWeeks = mine.filter((t) => t >= today - 28 * DAY_MS && t < today).length;
        const requested = Date.parse(`${m.cancellation_requested}Z`);
        const lastVisit = mine.length ? Math.max(...mine) : Number.NEGATIVE_INFINITY;
        if (lastWeek > 0) problems.push(`${m.member_id} checked in ${lastWeek} times in the last week`);
        if (lastFourWeeks > 8) problems.push(`${m.member_id} visits ${(lastFourWeeks / 4).toFixed(1)} times a week`);
        if (!(requested > lastVisit && requested < today)) problems.push(`${m.member_id} asked at ${m.cancellation_requested}, not between their last visit and today`);
        if (m.contract_status !== "active") problems.push(`${m.member_id} asked to cancel a membership that already ended`);
      }
      if (flagged.length < 20 || flagged.length > 30) problems.push(`${flagged.length} requests, not about 5% of ${members.length}`);
      const autoRenewAbsent = flagged.filter((m) => m.auto_renew && m.signals.days_since_visit >= 56).length;
      if (autoRenewAbsent < 12) problems.push(`only ${autoRenewAbsent} auto-renewing members absent 8+ weeks`);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `${flagged.length} requests: none checked in this week, none above twice a week, all after their last visit; ${autoRenewAbsent} auto-renewers away 8+ weeks` : problems.slice(0, 4).join("; "),
      };
    },
  },
  {
    id: "cancellation-column-is-optional-in-the-import",
    name: "The members CSV accepts cancellation_requested as an optional column: absent means no requests, a bad value is refused",
    why:
      "An export without the column is a gym saying nothing about cancellations — every member comes through with no request " +
      "(null, never \"false\"). With the column, a blank cell is no request, a date or local time is kept, and a time zone or " +
      "a yes/no is refused with its line rather than guessed at.",
    run: () => {
      const problems: string[] = [];
      const without = parseImport("members", "member_id,name,join_date\nM1,Sam Lee,2025-02-09\nM2,Ana Ruiz,2025-03-01\n");
      if (!without.ok || without.rows.some((r) => r.cancellation_requested !== null)) problems.push(`no column: ${JSON.stringify(without.rows)}`);
      const withColumn = parseImport(
        "members",
        "member_id,name,join_date,cancellation_requested\nM1,Sam Lee,2025-02-09,2026-09-05T15:30:00\nM2,Ana Ruiz,2025-03-01,\nM3,Jo Park,2025-04-01,2026-09-01\n"
      );
      const values = withColumn.rows.map((r) => r.cancellation_requested);
      if (!withColumn.ok || JSON.stringify(values) !== JSON.stringify(["2026-09-05T15:30:00", null, "2026-09-01T00:00:00"])) problems.push(`with column: ${JSON.stringify(values)}`);
      const zoned = parseImport("members", "member_id,name,join_date,cancellation_requested\nM1,Sam Lee,2025-02-09,2026-09-05T15:30:00Z\n");
      if (zoned.ok || !zoned.issues.some((i) => i.line === 2 && /time zone/.test(i.message))) problems.push("a time-zoned request was accepted");
      const yes = parseImport("members", "member_id,name,join_date,cancellation_requested\nM1,Sam Lee,2025-02-09,yes\n");
      if (yes.ok || !yes.issues.some((i) => i.column === "Cancellation requested")) problems.push("\"yes\" was accepted as a request time");
      return { passed: problems.length === 0, detail: problems.length === 0 ? "absent column → null for all; blank → null; date and time kept; time zone and yes/no refused by line" : problems.join("; ") };
    },
  },
];
