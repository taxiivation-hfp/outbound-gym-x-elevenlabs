import { routeMember } from "@/lib/callType";
import { NO_HISTORY } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { compileVariables, NOT_RECORDED } from "@/lib/compileVariables";
import { evaluateEligibility } from "@/lib/eligibility";
import { getGym } from "@/lib/gyms";
import { buildMember, countVisits, currentContract, type ContractRecord, type MemberRecord } from "@/lib/memberData";
import { parseImport } from "@/lib/memberImport";
import { gymForMember, memberSource } from "@/lib/memberSource";
import { resolveDialTarget } from "@/lib/dialSafety";
import { onboardingWritesEnabled } from "@/lib/onboardingWrites";
import { computeSnapshot, planRecompute } from "@/lib/queueRecompute";
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

const sarah: MemberRecord = { member_id: "S0001", name: "Sarah Whitlock", mobile: "+61400000000", join_date: isoOffset(-420), cancellation_requested: null };

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
    last_seen_at: "2026-09-01T00:00:00Z",
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
      const renewed = term(-3, 362, { last_seen_at: "2026-09-11T00:00:00Z" });
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
      "new row, and an auto-renewing row that no fixed term has replaced decides the member — so a member who switched " +
      "to a rolling plan is excluded the moment the export says so.",
    run: () => {
      const fixed = term(-353, 12);
      const switched = { ...fixed, auto_renew: true, last_seen_at: "2026-09-11T00:00:00Z" };
      const r = routeMember(built([fixed, switched]), DATA_AS_OF);
      return {
        passed: r.call_type === null && r.auto_renew_excluded,
        detail: r.auto_renew_excluded ? "excluded on the auto-renew rule" : `routed to ${r.call_type}`,
      };
    },
  },
  {
    id: "conflicting-contract-rows-resolve-to-not-calling",
    name: "Contract rows that disagree about auto-renew never make an auto-renewing member callable",
    why:
      "Term history arrives from exports of different ages. A term re-exported as auto-renew, then fixed, then auto-renew " +
      "again; a fixed term converted mid-way to a rolling plan whose rollover falls before the fixed term's end; two rows " +
      "with the same dates in one file. Each once routed a rolling member to a renewal call. Ambiguity now resolves to the " +
      "rolling plan, while a real switch to a fixed term — a later term, or the same term reported later with auto-renew " +
      "off — still makes the member callable.",
    run: () => {
      const problems: string[] = [];
      const excluded = (label: string, contracts: ContractRecord[]) => {
        const r = routeMember(built(contracts), DATA_AS_OF);
        if (!r.auto_renew_excluded) problems.push(`${label}: routed to ${r.call_type ?? "nothing"}, not excluded`);
      };
      const callable = (label: string, contracts: ContractRecord[]) => {
        const r = routeMember(built(contracts), DATA_AS_OF);
        if (r.auto_renew_excluded) problems.push(`${label}: excluded, but the member moved to a fixed term`);
      };

      // 1. On, off, on again: the third import adds no row, only moves the first row's last_seen_at.
      const fixedTerm = term(-353, 12);
      const rolling = { ...fixedTerm, auto_renew: true, last_seen_at: "2026-09-12T03:00:00Z" };
      const switchedOff = { ...fixedTerm, auto_renew: false, last_seen_at: "2026-09-11T00:00:00Z" };
      excluded("on, off, on again", [rolling, switchedOff]);

      // 2. Fixed term to 12 days out, converted to a rolling plan whose next rollover is in 3 days.
      excluded("mid-term conversion to rolling", [
        term(-353, 12, { last_seen_at: "2026-09-12T03:00:00Z" }),
        term(-60, 3, { auto_renew: true, contract_type: "month-to-month", last_seen_at: "2026-09-12T03:00:00Z" }),
      ]);

      // 3. Same dates, same file, fixed row listed last.
      excluded("same dates in one file", [
        term(-353, 12, { auto_renew: true, last_seen_at: "2026-09-12T03:00:00Z", id: 1 }),
        term(-353, 12, { auto_renew: false, last_seen_at: "2026-09-12T03:00:00Z", id: 2 }),
      ]);

      // 4. A fixed term the latest export no longer lists doesn't replace the rolling plan it does list.
      excluded("dropped fixed term", [
        term(-60, 3, { auto_renew: true, contract_type: "month-to-month", last_seen_at: "2026-09-12T03:00:00Z" }),
        term(-30, 335, { last_seen_at: "2026-08-01T00:00:00Z" }),
      ]);

      // Real switches to a fixed term stay callable.
      callable("a later fixed term", [
        term(-400, -40, { auto_renew: true, contract_type: "month-to-month", last_seen_at: "2026-09-12T03:00:00Z" }),
        term(-353, 12, { last_seen_at: "2026-09-12T03:00:00Z" }),
      ]);
      callable("same term reported later with auto-renew off", [
        term(-353, 12, { auto_renew: true, last_seen_at: "2026-08-01T00:00:00Z" }),
        term(-353, 12, { auto_renew: false, last_seen_at: "2026-09-12T03:00:00Z" }),
      ]);

      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "4 ambiguous histories excluded; 2 real switches to a fixed term callable" : problems.join("; "),
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
        built([oldTerm, term(-1, 364, { last_seen_at: "2026-09-12T02:00:00Z" })]),
        NO_HISTORY,
        DATA_AS_OF
      );
      const switchedSince = evaluateEligibility(
        built([oldTerm, { ...oldTerm, auto_renew: true, last_seen_at: "2026-09-12T02:00:00Z" }]),
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
  {
    id: "uploaded-member-only-contacted-as-their-own-gym",
    name: "A gym's uploaded member can't be called or texted under another gym's name and offers",
    why:
      "Uploaded members belong to the gym they were uploaded for. The dashboard's gym switch exists to try the synthetic " +
      "members under either gym's rules; applied to real members it would put another gym's name and offers in the " +
      "agent's mouth. The call route and send_text both refuse the mismatch, and default to the member's own gym.",
    run: () => {
      const uploaded = { kind: "supabase" as const, gymId: "northside-iron" };
      const other = gymForMember(uploaded, "kensington");
      const own = gymForMember(uploaded, "northside-iron");
      const unspecified = gymForMember(uploaded, null);
      const synthetic = gymForMember({ kind: "dataset" }, "kensington");
      return {
        passed:
          !other.ok &&
          own.ok &&
          own.gymId === "northside-iron" &&
          unspecified.ok &&
          unspecified.gymId === "northside-iron" &&
          synthetic.ok &&
          synthetic.gymId === "kensington",
        detail: `as another gym: ${other.ok ? "ALLOWED" : "refused"}; unspecified: ${unspecified.ok ? unspecified.gymId : "refused"}; synthetic under kensington: ${synthetic.ok ? "allowed" : "refused"}`,
      };
    },
  },
  {
    id: "uploaded-members-refused-on-the-frozen-clock-everywhere",
    name: "Uploaded members are never read against the synthetic dataset's frozen date, by any reader",
    why:
      "Found by adversarial review: only the nightly job refused this. The queue, the call route and send_text all read " +
      "members through memberSource, so the refusal lives there — real members measured against a date weeks in the past " +
      "would be called about renewals that already happened.",
    run: () => {
      const refusal = (env: Record<string, string>) => {
        try {
          memberSource(env);
          return null;
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
      };
      const frozen = refusal({ MEMBER_SOURCE: "supabase", MEMBER_SOURCE_GYM_ID: "northside-iron" });
      const live = refusal({ MEMBER_SOURCE: "supabase", MEMBER_SOURCE_GYM_ID: "northside-iron", DATASET_CLOCK: "live" });
      const dataset = refusal({});
      return {
        passed: frozen !== null && /DATASET_CLOCK=live/.test(frozen) && live === null && dataset === null,
        detail: `frozen + uploaded: ${frozen ? "refused" : "READ"}; live + uploaded: ${live ? "refused" : "read"}; dataset: ${dataset ? "refused" : "read"}`,
      };
    },
  },
  {
    id: "synthetic-numbers-never-dialled-real-numbers-need-opt-in",
    name: "A synthetic member's number is never dialled; an uploaded member's needs a deliberate opt-in",
    why:
      "Found by adversarial review: the opt-in for real numbers was global, so a deployment that set it for a gym's " +
      "uploaded members, then switched back to the dataset, would dial 500 strangers. The rule now follows where the " +
      "member came from. Onboarding writes — the routes that change who is on auto-renew and what their number is — " +
      "are off until a deployment switches them on.",
    run: () => {
      const dataset = { kind: "dataset" as const };
      const uploaded = { kind: "supabase" as const, gymId: "northside-iron" };
      const problems: string[] = [];
      if (resolveDialTarget("+61400000001", dataset, { ALLOW_UNVERIFIED_NUMBERS: "true" }, true).allowed) problems.push("synthetic number dialled with the opt-in set");
      if (resolveDialTarget("+61400000001", uploaded, {}, true).allowed) problems.push("uploaded number dialled without the opt-in");
      const optedIn = resolveDialTarget("+61400000001", uploaded, { ALLOW_UNVERIFIED_NUMBERS: "true" }, true);
      if (!optedIn.allowed || optedIn.to !== "+61400000001") problems.push("uploaded number refused despite the opt-in");
      if (resolveDialTarget("", uploaded, { ALLOW_UNVERIFIED_NUMBERS: "true" }, true).allowed) problems.push("a blank number was dialled");
      const override = resolveDialTarget("+61400000001", dataset, { CALL_OVERRIDE_NUMBER: "+61400999999" }, true);
      if (!override.allowed || override.to !== "+61400999999") problems.push("the override was not used");
      if (onboardingWritesEnabled({})) problems.push("onboarding writes are on by default");
      if (!onboardingWritesEnabled({ ONBOARDING_WRITES: "enabled" })) problems.push("onboarding writes can't be switched on");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "synthetic refused even with the opt-in; uploaded needs it; override wins; writes off by default" : problems.join("; "),
      };
    },
  },
  {
    id: "nightly-recompute-refuses-real-data-on-the-frozen-clock",
    name: "The nightly recompute refuses to measure uploaded members against the frozen dataset date",
    why:
      "The frozen clock exists because the dataset is synthetic. Real members measured against it would route wrongly, and " +
      "a recorded run would make that look like a normal night. The job refuses, and says why.",
    run: () => {
      const now = new Date("2026-10-01T16:00:00Z");
      const refused = planRecompute({ MEMBER_SOURCE: "supabase", MEMBER_SOURCE_GYM_ID: "northside-iron" }, now);
      const live = planRecompute({ MEMBER_SOURCE: "supabase", MEMBER_SOURCE_GYM_ID: "northside-iron", DATASET_CLOCK: "live" }, now);
      const noGym = planRecompute({ MEMBER_SOURCE: "supabase", DATASET_CLOCK: "live" }, now);
      const demo = planRecompute({}, now);
      const snapshot = computeSnapshot([built([term(-353, 12)])], new Map(), DATA_AS_OF);
      return {
        passed:
          !refused.ok &&
          live.ok &&
          live.clock === "live" &&
          live.asOf.getTime() === now.getTime() &&
          !noGym.ok &&
          demo.ok &&
          demo.clock === "frozen" &&
          snapshot.counts.renewal === 1,
        detail: `frozen+uploaded: ${refused.ok ? "RAN" : "refused"}; live+uploaded: ${live.ok ? "runs on the wall clock" : "refused"}; no gym id: ${noGym.ok ? "RAN" : "refused"}; dataset: ${demo.ok ? demo.clock : "refused"}`,
      };
    },
  },
];
