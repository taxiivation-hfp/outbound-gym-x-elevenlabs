import { routeMember } from "@/lib/callType";
import { NO_HISTORY } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { compileVariables, NOT_RECORDED } from "@/lib/compileVariables";
import { evaluateEligibility } from "@/lib/eligibility";
import { getGym } from "@/lib/gyms";
import { buildMember, countVisits, currentContract, type ContractRecord, type MemberRecord } from "@/lib/memberData";
import { parseImport } from "@/lib/memberImport";
import { isoOffset } from "./fixtures";
import type { Guard } from "./guards";

/**
 * Guards over uploaded member data and the nightly recompute.
 *
 * The failures these pin are the expensive kind: ringing a member about a
 * renewal she did at the front desk three days ago, treating an export's blank
 * auto-renew cell as "fixed term", and dialling off a queue computed before the
 * member's latest contract arrived. Each is a pure function over rows, so they
 * run with the rest of the guards — no database, no network.
 */

const sarah: MemberRecord = { member_id: "S0001", name: "Sarah Whitlock", mobile: "+61400000000", join_date: isoOffset(-420) };

/** Visits every two or three days up to yesterday: someone still training. */
function recentVisits(days = 60): string[] {
  const out: string[] = [];
  for (let d = days; d >= 1; d -= 3) out.push(`${isoOffset(-d)}T07:30:00`);
  return out;
}

function term(start: number, end: number, extra: Partial<ContractRecord> = {}): ContractRecord {
  return {
    member_id: sarah.member_id,
    contract_type: "12-month",
    auto_renew: false,
    start_date: isoOffset(start),
    end_date: isoOffset(end),
    monthly_fee: 79,
    renewal_fee: 79,
    imported_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

function built(contracts: ContractRecord[], visits = recentVisits()) {
  const result = buildMember(sarah, contracts, countVisits(visits, DATA_AS_OF), DATA_AS_OF);
  if (!result.ok) throw new Error(result.reason);
  return result.member;
}

export const memberGuards: Guard[] = [
  {
    id: "renewal-is-a-new-row-not-a-stale-queue-entry",
    name: "A member who renewed at the front desk leaves the renewal queue on the next import",
    why:
      "If a sync could only append and the current term were ambiguous, Sarah would keep her old expiry and the agent " +
      "would ring her about a renewal she did three days ago — the call that costs a gym a member. One row per term, " +
      "latest end date wins, fixes it; the old term stays as history.",
    run: () => {
      const oldTerm = term(-353, 12);
      const before = routeMember(built([oldTerm]), DATA_AS_OF);
      const renewed = term(-3, 362, { imported_at: "2026-09-11T00:00:00Z" });
      const after = routeMember(built([oldTerm, renewed]), DATA_AS_OF);
      const current = currentContract([oldTerm, renewed]);
      return {
        passed: before.call_type === "renewal" && after.call_type === null && current?.end_date === renewed.end_date,
        detail: `before the renewal row: ${before.call_type}; after: ${after.call_type ?? "not due"} (current term ends ${current?.end_date})`,
      };
    },
  },
  {
    id: "same-term-reexported-as-auto-renew-is-never-called",
    name: "A term re-exported with auto-renew switched on is never called",
    why:
      "Insert-only contracts must still let a changed fact land. The same term exported again with auto-renew on is a " +
      "new row, and the latest import for the latest term wins — so a member who switched to a rolling plan is excluded " +
      "the moment the export says so.",
    run: () => {
      const fixed = term(-353, 12);
      const switched = { ...fixed, auto_renew: true, imported_at: "2026-09-11T00:00:00Z" };
      const r = routeMember(built([fixed, switched]), DATA_AS_OF);
      return {
        passed: r.call_type === null && r.auto_renew_excluded,
        detail: r.auto_renew_excluded ? "excluded on the auto-renew rule" : `routed to ${r.call_type}`,
      };
    },
  },
  {
    id: "days-since-visit-comes-from-the-latest-check-in",
    name: "Days since the last visit are derived from the latest check-in, however rows arrive",
    why:
      "Check-ins are insert-only and never an array on the member; days_since_visit is computed at query time from the " +
      "latest one. Rows imported out of order, duplicated, or not at all must all give the right answer.",
    run: () => {
      // Whole days before the reference midnight, as the pipeline counts them —
      // so the latest visit is written at midnight to read as exactly five.
      const shuffled = [`${isoOffset(-40)}T08:00:00`, `${isoOffset(-5)}T00:00:00`, `${isoOffset(-90)}T06:00:00`, `${isoOffset(-5)}T00:00:00`];
      const m = built([term(-100, 200)], shuffled);
      const neverCame = built([term(-100, 200)], []);
      return {
        passed: m.signals.days_since_visit === 5 && neverCame.signals.days_since_visit === m.signals.tenure_days,
        detail: `latest visit → ${m.signals.days_since_visit} days; no visits → ${neverCame.signals.days_since_visit} (tenure ${neverCame.signals.tenure_days})`,
      };
    },
  },
  {
    id: "blank-auto-renew-refused-not-defaulted",
    name: "A contracts CSV with a blank auto-renew cell is refused whole, never read as fixed-term",
    why:
      "The one field the product rests on. Defaulting a blank to false would make an auto-renewing member callable; the " +
      "file is rejected with the line and what to fix, and nothing from it is imported.",
    run: () => {
      const csv =
        "member_id,contract_type,auto_renew,start_date,expiry_date,monthly_fee,renewal_fee\n" +
        "M0001,12-month,False,2026-01-01,2026-12-31,79,79\n" +
        "M0002,month-to-month,,2026-09-01,2026-09-30,99,99\n";
      const preview = parseImport("contracts", csv);
      const issue = preview.issues.find((i) => i.line === 3 && i.column === "Auto-renews");
      return {
        passed: !preview.ok && preview.rows.length === 0 && Boolean(issue && /can't be assumed/.test(issue.message)),
        detail: issue ? `line ${issue.line}: ${issue.message.slice(0, 90)}…` : `ok=${preview.ok}, rows=${preview.rows.length}`,
      };
    },
  },
  {
    id: "malformed-csv-rejected-with-actionable-errors",
    name: "A malformed export is rejected with errors that say which line and what to change",
    why:
      "\"Invalid file\" gives a front desk nothing to act on. A missing column names the column and the headers it would " +
      "be recognised by; a broken row names its line; a US-style date is refused rather than guessed.",
    run: () => {
      const missingColumn = parseImport("members", "id,full name,dob\n1,Sam Lee,1990-01-01\n");
      const badRows = parseImport(
        "checkins",
        'member_id,timestamp\nM1,2026-09-10T07:00:00\nM2,"2026-09-10T07:00:00\nM3,04/05/2026 07:00\n'
      );
      const usDate = parseImport("members", "member_id,name,join_date\nM1,Sam Lee,04/05/2026\n");
      const problems: string[] = [];
      if (missingColumn.ok || !missingColumn.issues.some((i) => /No Join date column.*join_date/.test(i.message))) problems.push("missing column not named");
      if (badRows.ok || !badRows.issues.some((i) => /never closed/.test(i.message))) problems.push("unterminated quote not reported");
      if (usDate.ok || !usDate.issues.some((i) => i.line === 2 && /YYYY-MM-DD/.test(i.message))) problems.push("ambiguous date accepted");
      return { passed: problems.length === 0, detail: problems.length === 0 ? "column, line and format errors all specific" : problems.join("; ") };
    },
  },
  {
    id: "missing-renewal-fee-stays-unknown",
    name: "A contract with no renewal fee makes the agent admit it doesn't have the price",
    why:
      "Blank stays blank for member data too. Handing the agent the monthly fee as the renewal price would be a " +
      "plausible guess about what someone will pay.",
    run: () => {
      const m = built([term(-353, 12, { renewal_fee: null })]);
      const v = compileVariables({ member: m, gym: getGym("southbank"), routing: routeMember(m, DATA_AS_OF), callType: "renewal" });
      return {
        passed: m.renewal_fee === null && v.renewal_price === NOT_RECORDED,
        detail: `renewal_price = "${v.renewal_price}"`,
      };
    },
  },
  {
    id: "stale-queue-entry-refused-at-dial-time",
    name: "A queue entry computed before the latest import cannot produce a call",
    why:
      "The queue is computed nightly; the call happens when someone presses the button. Between those a member can renew " +
      "or switch to auto-renew. The call route re-reads the member and re-checks eligibility, so what the queue said no " +
      "longer matters once the rows have changed.",
    run: () => {
      const oldTerm = term(-353, 12);
      const queuedThen = evaluateEligibility(built([oldTerm]), NO_HISTORY, DATA_AS_OF);
      const renewedSince = evaluateEligibility(
        built([oldTerm, term(-1, 364, { imported_at: "2026-09-12T02:00:00Z" })]),
        NO_HISTORY,
        DATA_AS_OF
      );
      const switchedSince = evaluateEligibility(
        built([oldTerm, { ...oldTerm, auto_renew: true, imported_at: "2026-09-12T02:00:00Z" }]),
        NO_HISTORY,
        DATA_AS_OF
      );
      return {
        passed:
          queuedThen.allowed &&
          !renewedSince.allowed &&
          renewedSince.blockedBy === "not_due" &&
          !switchedSince.allowed &&
          switchedSince.blockedBy === "auto_renew",
        detail: `queue: ${queuedThen.allowed ? queuedThen.routing.call_type : queuedThen.blockedBy}; at dial after renewal: ${renewedSince.blockedBy}; after switching to auto-renew: ${switchedSince.blockedBy}`,
      };
    },
  },
];
