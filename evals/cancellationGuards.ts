import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import membersData from "@/data/members_scored.json";
import { callRefusal } from "@/lib/callGate";
import { routeMember, type CallType } from "@/lib/callType";
import { NO_HISTORY, offersMade, summarise } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { compileVariables } from "@/lib/compileVariables";
import { normaliseHeader, parseCsv } from "@/lib/csv";
import { cancellationOffers, evaluateEligibility, evaluateOffers, scheduleKey, withholdOffers } from "@/lib/eligibility";
import { hasFreeze, parseGymConfig, parseGymFields, type GymConfig, type GymFields } from "@/lib/gymConfig";
import { getGym } from "@/lib/gyms";
import { compileIncentives, grantedOffers, sentenceTemplate } from "@/lib/incentives";
import { parseImport } from "@/lib/memberImport";
import { computeSnapshot } from "@/lib/queueRecompute";
import { validateIncentives } from "@/lib/validateIncentives";
import type { Member } from "@/lib/types";
import { comparePayloads, currentPayloads, SNAPSHOT_PATH, type PayloadSnapshot } from "../scripts/snapshot-scenario-payloads";
import { PATTERNS, firstOfferIs, numbersIn, onlyNumbersNear, saysBefore, type Turn } from "./assertions";
import { cancellationMember, earlyAbsenceMember, fixtureMember, isoOffset, renewalMember, winbackMember } from "./fixtures";
import type { Guard } from "./guards";

/**
 * Guards over the cancellation call (PASS_TWO).
 *
 * Pass one added the cancellation flag and pinned it inert with a tripwire:
 * `cancellation-flag-does-not-yet-change-who-is-called`. This pass is the one
 * that trips it, deliberately, and the guard that replaces it asserts the flip
 * is *narrow* — a flagged member is callable on the cancellation call and on
 * nothing else, an unflagged auto-renewer is refused exactly as before, and
 * do-not-contact still holds absolutely. The rest pin the gates around that
 * call: it needs something to offer, it happens once, and neither the offer
 * schedule nor the habit guard touches it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DAY_MS = 86_400_000;
const members = membersData as Member[];

const WITH_FREEZE = { freeze_max_weeks: 8, freeze_weekly_fee: 5 } as const;
const NO_TIER = { cheaper_tier_name: null, cheaper_tier_price: null } as const;

/** Southbank, changed one field at a time, re-parsed like a saved config. */
function southbank(overrides: Partial<GymFields> = {}, schedule?: GymConfig["offer_schedule"]): GymConfig {
  const parsed = parseGymConfig({ ...getGym("southbank"), ...overrides, ...(schedule ? { offer_schedule: schedule } : {}) });
  if (!parsed.ok) throw new Error(`fixture config invalid: ${JSON.stringify(parsed.errors)}`);
  return parsed.value;
}

/** The four combinations of what a gym can put on the table for a member who is leaving. */
const COMBINATIONS: Array<[string, GymConfig, string[]]> = [
  ["both", southbank(WITH_FREEZE), ["freeze", "cheaper_tier"]],
  ["freeze only", southbank({ ...WITH_FREEZE, ...NO_TIER }), ["freeze"]],
  ["cheaper tier only", southbank(), ["cheaper_tier"]],
  ["neither", southbank(NO_TIER), []],
];

function conversation(iso: string, callType: CallType, fields: Record<string, unknown> = {}) {
  return { member_id: "C0001", status: "completed", reached_member: true, outcome: "not_interested", call_type: callType, created_at: iso, transcript: "x", ...fields };
}

function daysAgo(days: number): string {
  return new Date(DATA_AS_OF.getTime() - days * DAY_MS).toISOString();
}

const agent = (message: string): Turn => ({ role: "agent", message });
const member = (message: string): Turn => ({ role: "user", message });

export const cancellationGuards: Guard[] = [
  {
    id: "cancellation-flip-is-narrow",
    name: "A member who asked to cancel is callable on the cancellation call and on nothing else; every other auto-renewer is refused exactly as before",
    why:
      "Replaces `cancellation-flag-does-not-yet-change-who-is-called`, the tripwire pass one left so this change had to be made " +
      "on purpose. The exception lives inside the auto-renew branch, not before it: a flagged auto-renewer routes to the " +
      "cancellation call whatever their absence or rollover date, and never to renewal, reengagement or winback; an unflagged " +
      "auto-renewer is excluded on the same rule with the same words; a flagged fixed-term member gets the cancellation call " +
      "rather than a renewal pitch, and once lapsed gets nothing — never a winback; do-not-contact holds, flag or no flag; " +
      "and every auto-renewer in the dataset who hasn't asked to cancel still gets a 403 naming the auto-renew rule.",
    run: () => {
      const problems: string[] = [];
      const flag = `${isoOffset(-3)}T18:30:00`;

      // The flip, across every absence, habit and rollover an auto-renewer can have.
      const before = routeMember(fixtureMember({ auto_renew: true, contract_type: "month-to-month", expiry_date: isoOffset(9) }), DATA_AS_OF);
      for (const absent of [0, 3, 30, 60, 200])
        for (const expiry of [-5, 3, 12, 25])
          for (const oldRate of [0.2, 2.5]) {
            const base = { auto_renew: true, contract_type: "month-to-month" as const, expiry_date: isoOffset(expiry), signals: { days_since_visit: absent, old_rate: oldRate, tenure_days: 500, visit_count_90d: 0 } };
            const flagged = routeMember(fixtureMember({ ...base, cancellation_requested: flag }), DATA_AS_OF);
            if (flagged.call_type !== "cancellation" || flagged.auto_renew_excluded) problems.push(`flagged auto-renewer (absent ${absent}, expiry ${expiry}) routes to ${flagged.call_type}`);
            const plain = routeMember(fixtureMember(base), DATA_AS_OF);
            if (plain.call_type !== null || !plain.auto_renew_excluded || plain.excluded_reason !== before.excluded_reason) {
              problems.push(`unflagged auto-renewer (absent ${absent}, expiry ${expiry}) routes to ${plain.call_type ?? "nothing"}: ${plain.excluded_reason}`);
            }
          }
      if (!/never called/.test(before.excluded_reason ?? "")) problems.push("the auto-renew exclusion's words changed");

      // A fixed-term member who asked to cancel: the cancellation call, not the pitch they'd otherwise get.
      const renewalFlagged = routeMember({ ...renewalMember(), cancellation_requested: flag }, DATA_AS_OF);
      if (renewalFlagged.call_type !== "cancellation") problems.push(`a flagged near-expiry member routes to ${renewalFlagged.call_type} instead of the cancellation call`);
      const absentFlagged = routeMember({ ...earlyAbsenceMember(), cancellation_requested: flag }, DATA_AS_OF);
      if (absentFlagged.call_type !== "cancellation") problems.push(`a flagged absent member routes to ${absentFlagged.call_type} instead of the cancellation call`);
      const lapsedFlagged = routeMember({ ...winbackMember(), cancellation_requested: `${isoOffset(-40)}T10:00:00` }, DATA_AS_OF);
      if (lapsedFlagged.call_type !== null || !/since ended/.test(lapsedFlagged.excluded_reason ?? "")) {
        problems.push(`a flagged member whose term has ended routes to ${lapsedFlagged.call_type ?? "nothing"}: ${lapsedFlagged.excluded_reason}`);
      }

      // Do-not-contact, flag or no flag, gym or no gym.
      const dnc = summarise([{ member_id: "C0001", status: "completed", created_at: daysAgo(30), transcript: "x", reached_member: true, do_not_contact: true }]);
      for (const gym of [southbank(WITH_FREEZE), null]) {
        const e = evaluateEligibility(cancellationMember(), dnc, DATA_AS_OF, gym);
        if (e.allowed || e.blockedBy !== "do_not_contact") problems.push(`do-not-contact didn't hold for a flagged member (gym ${gym ? "set" : "unset"}): ${e.blockedBy}`);
      }

      // The dataset: every flagged member is cancellation or nothing; every unflagged auto-renewer is a 403 on the auto-renew rule.
      const flaggedAuto = members.filter((m) => m.cancellation_requested && m.auto_renew);
      const unflaggedAuto = members.filter((m) => !m.cancellation_requested && m.auto_renew);
      const autoTotal = members.filter((m) => m.auto_renew).length;
      if (flaggedAuto.length < 12) problems.push(`only ${flaggedAuto.length} flagged auto-renewers in the dataset`);
      for (const m of members.filter((x) => x.cancellation_requested)) {
        const r = routeMember(m, DATA_AS_OF);
        if (r.call_type !== "cancellation" && r.call_type !== null) problems.push(`${m.member_id} (flagged) routes to ${r.call_type}`);
        if (m.auto_renew && r.call_type !== "cancellation") problems.push(`${m.member_id} (flagged auto-renewer) routes to ${r.call_type ?? "nothing"}`);
      }
      for (const m of unflaggedAuto) {
        const refusal = callRefusal(evaluateEligibility(m, NO_HISTORY, DATA_AS_OF, southbank(WITH_FREEZE)));
        if (refusal?.status !== 403 || refusal.body.blocked_by !== "auto_renew") problems.push(`${m.member_id}: /api/call answers ${JSON.stringify(refusal)}`);
      }
      const dueOnCancellation = flaggedAuto.filter((m) => evaluateEligibility(m, NO_HISTORY, DATA_AS_OF, southbank()).allowed).length;
      if (dueOnCancellation !== flaggedAuto.length) problems.push(`${dueOnCancellation} of ${flaggedAuto.length} flagged auto-renewers are due against a gym with a cheaper tier`);

      return {
        passed: problems.length === 0,
        detail:
          problems.length === 0
            ? `40 auto-renewer fixtures: flagged → cancellation, unflagged → excluded on the unchanged rule; fixed-term flagged → cancellation, lapsed flagged → nothing; ` +
              `do-not-contact holds; dataset: ${flaggedAuto.length} flagged auto-renewers due the cancellation call, the other ${unflaggedAuto.length} of ${autoTotal} refused 403 auto_renew`
            : problems.slice(0, 6).join("; "),
      };
    },
  },
  {
    id: "cancellation-needs-something-to-offer",
    name: "A member who asked to cancel is called when the gym has a freeze, a cheaper tier or both, and not when it has neither",
    why:
      "Either offer alone justifies the call: a gym with only a cheaper tier offers that, a gym with only a freeze offers that, " +
      "a gym with both has the ladder. A gym with neither doesn't call — a call to someone who is leaving, with nothing to offer, " +
      "only annoys, and extracting a reason isn't worth that. The gate is in eligibility, judged against the gym the call would " +
      "speak for, and /api/call refuses with its own reason. A free freeze is a freeze; no freeze at all is not.",
    run: () => {
      const problems: string[] = [];
      const tom = cancellationMember();
      for (const [label, gym, grants] of COMBINATIONS) {
        const e = evaluateEligibility(tom, NO_HISTORY, DATA_AS_OF, gym);
        const refusal = callRefusal(e);
        const block = compileIncentives(gym, "cancellation");
        const granted = grantedOffers(block);
        if (grants.length === 0) {
          if (e.allowed || e.blockedBy !== "nothing_to_offer") problems.push(`${label}: ${e.allowed ? "called" : e.blockedBy}`);
          if (refusal?.status !== 403 || refusal.body.blocked_by !== "nothing_to_offer") problems.push(`${label}: /api/call answers ${JSON.stringify(refusal)}`);
          if (e.routing.call_type !== "cancellation") problems.push(`${label}: the router should still say cancellation; the gate is eligibility's`);
          if (granted.length > 0) problems.push(`${label}: the block grants ${granted.join(", ")}`);
        } else {
          if (!e.allowed || refusal !== null) problems.push(`${label}: blocked by ${e.blockedBy}`);
          if (JSON.stringify(granted) !== JSON.stringify(grants)) problems.push(`${label}: the block grants ${JSON.stringify(granted)}, expected ${JSON.stringify(grants)}`);
        }
        if (!validateIncentives(block.text, gym, "cancellation").ok) problems.push(`${label}: the block is invalid`);
      }

      const freeFreeze = southbank({ ...NO_TIER, freeze_max_weeks: 4, freeze_weekly_fee: 0 });
      if (!hasFreeze(freeFreeze) || !cancellationOffers(freeFreeze).any || !evaluateEligibility(tom, NO_HISTORY, DATA_AS_OF, freeFreeze).allowed) {
        problems.push("a free freeze (fee 0) didn't count as something to offer");
      }
      if (!evaluateEligibility(tom, NO_HISTORY, DATA_AS_OF, getGym("southbank")).allowed) problems.push("Southbank (a cheaper tier, no freeze) doesn't call");
      const kensington = evaluateEligibility(tom, NO_HISTORY, DATA_AS_OF, getGym("kensington"));
      if (kensington.allowed || kensington.blockedBy !== "nothing_to_offer") problems.push(`Kensington (neither) ${kensington.allowed ? "calls" : kensington.blockedBy}`);
      // The nightly snapshot records the same gate, against the same gym.
      const snapshot = computeSnapshot([tom], new Map(), DATA_AS_OF, getGym("kensington"));
      if (snapshot.counts.due !== 0 || snapshot.counts.nothing_to_offer !== 1 || snapshot.entries[0].blocked_by !== "nothing_to_offer") {
        problems.push(`the snapshot against Kensington counts ${JSON.stringify(snapshot.counts)}`);
      }
      // A reader with no gym in scope doesn't apply the gate; the call route always has one.
      if (!evaluateEligibility(tom, NO_HISTORY, DATA_AS_OF).allowed) problems.push("without a gym the call was refused, so the queue and the call route could disagree");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "both, freeze only, tier only: called with exactly those offers; neither: 403 nothing_to_offer; Kensington refused, Southbank called; a free freeze counts" : problems.join("; "),
      };
    },
  },
  {
    id: "cancellation-call-is-capped-at-one",
    name: "Nobody is rung twice about their cancellation, and an earlier conversation about something else doesn't spend the one they get",
    why:
      "The cap is enforced in eligibility, not the prompt, and counted on cancellation conversations alone. A reengagement chat " +
      "ten days ago neither uses up the one call nor puts it on the three-month cooldown — that cooldown exists for a trigger that " +
      "fires every day, and this one fires once. A dial nobody answered still waits its week before a redial.",
    run: () => {
      const problems: string[] = [];
      const tom = cancellationMember();
      const gym = southbank(WITH_FREEZE);
      const spoken = summarise([conversation(daysAgo(2), "cancellation", { offer_made: true, offers_available: ["cheaper_tier"] })]);
      const capped = evaluateEligibility(tom, spoken, DATA_AS_OF, gym);
      if (capped.allowed || capped.blockedBy !== "max_attempts") problems.push(`after one cancellation conversation: ${capped.allowed ? "allowed" : capped.blockedBy}`);
      if (callRefusal(capped)?.body.blocked_by !== "max_attempts") problems.push("/api/call doesn't refuse the second cancellation call");
      if (spoken.cancellationConversations !== 1) problems.push(`cancellationConversations = ${spoken.cancellationConversations}`);

      const earlier = summarise([conversation(daysAgo(10), "reengagement")]);
      const afterEarlier = evaluateEligibility(tom, earlier, DATA_AS_OF, gym);
      if (!afterEarlier.allowed) problems.push(`a reengagement conversation ten days ago blocks the cancellation call: ${afterEarlier.blockedBy}`);
      if (earlier.cancellationConversations !== 0 || afterEarlier.attemptNumber !== 2) problems.push(`history after a reengagement conversation: ${JSON.stringify({ c: earlier.cancellationConversations, n: afterEarlier.attemptNumber })}`);
      // The same history still cools a reengagement call, so the exemption is the cancellation call's alone.
      const reengagement = evaluateEligibility(earlyAbsenceMember(), earlier, DATA_AS_OF, gym);
      if (reengagement.allowed || reengagement.blockedBy !== "cooldown") problems.push("the conversation cooldown stopped applying to reengagement");

      const unanswered = summarise([{ member_id: "C0001", status: "failed", created_at: daysAgo(2), transcript: null }]);
      const redial = evaluateEligibility(tom, unanswered, DATA_AS_OF, gym);
      if (redial.allowed || redial.blockedBy !== "cooldown") problems.push(`two days after an unanswered dial: ${redial.allowed ? "redialled" : redial.blockedBy}`);
      const later = evaluateEligibility(tom, summarise([{ member_id: "C0001", status: "failed", created_at: daysAgo(8), transcript: null }]), DATA_AS_OF, gym);
      if (!later.allowed) problems.push(`eight days after an unanswered dial: ${later.blockedBy}`);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "second cancellation call refused (max_attempts); a reengagement chat 10 days ago neither caps nor cools it, but still cools a reengagement call; unanswered dial waits a week" : problems.join("; "),
      };
    },
  },
  {
    id: "cancellation-ignores-offer-schedule-and-habit-guard",
    name: "Neither the offer schedule nor the habit guard withholds anything from a cancellation call, while both still bind a winback call",
    why:
      "Explicit in eligibility rather than inferred: a member who has asked to cancel is not subject to a cooldown on their way out, " +
      "and the habit guard tells a routine from sporadic attendance, which says nothing about someone actively leaving. A tier switched " +
      "off by the schedule, a tier offered ten days ago under a yearly limit, a member with no habit who is still coming in — every one " +
      "of them still gets the tier on the cancellation call, and the same schedule still withholds it from a winback call.",
    run: () => {
      const problems: string[] = [];
      const gym = southbank(WITH_FREEZE, { cheaper_tier: "never" });
      const noHabit = fixtureMember({ ...cancellationMember(), signals: { days_since_visit: 3, old_rate: 0.2, tenure_days: 500, visit_count_90d: 3 } });
      const offers = evaluateOffers(noHabit, NO_HISTORY, gym.offer_schedule, "cancellation", DATA_AS_OF);
      if (Object.keys(offers.withheld).length > 0) problems.push(`withheld on the cancellation call: ${JSON.stringify(offers.withheld)}`);
      const vars = compileVariables({ member: noHabit, gym, routing: routeMember(noHabit, DATA_AS_OF), callType: "cancellation", offers });
      if (!/off-peak membership at \$39 a month/.test(vars.incentives) || !/8 weeks at \$5 a week/.test(vars.incentives)) problems.push(`the block dropped an offer: ${vars.incentives}`);

      const yearly = southbank(WITH_FREEZE, { cheaper_tier: "yearly" });
      const spent = summarise([conversation(daysAgo(10), "winback", { offer_made: true, offers_available: ["cheaper_tier"] })]);
      if (Object.keys(evaluateOffers(cancellationMember(), spent, yearly.offer_schedule, "cancellation", DATA_AS_OF).withheld).length > 0) {
        problems.push("a tier offered ten days ago was withheld from the cancellation call");
      }
      const winback = evaluateOffers(winbackMember(), spent, yearly.offer_schedule, "winback", DATA_AS_OF);
      if (!winback.withheld.cheaper_tier) problems.push("the same schedule no longer withholds the tier from a winback call");
      const winbackOff = evaluateOffers(winbackMember(), NO_HISTORY, gym.offer_schedule, "winback", DATA_AS_OF);
      if (!winbackOff.withheld.cheaper_tier) problems.push("\"never\" no longer switches the tier off for winback");

      // What a cancellation call records as offered: the tier, never the freeze, which isn't scheduled.
      const granted = grantedOffers(compileIncentives(withholdOffers(gym, offers), "cancellation")).map((o) => scheduleKey(o, "cancellation"));
      if (JSON.stringify(granted) !== JSON.stringify([null, "cheaper_tier"])) problems.push(`offers recorded as ${JSON.stringify(granted)}`);
      const legacy = offersMade({ offer_made: true, call_type: "cancellation" });
      if (JSON.stringify(legacy) !== JSON.stringify(["cheaper_tier"])) problems.push(`a legacy cancellation record spends ${JSON.stringify(legacy)}`);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "tier \"never\" and a tier spent 10 days ago both still offered on cancellation, to a member with no habit; both withheld on winback; the freeze is never scheduled" : problems.join("; "),
      };
    },
  },
  {
    id: "cancellation-blocks-name-only-the-configured-terms",
    name: "Every freeze and tier combination compiles to a valid cancellation block, and the validator refuses any other number, price or offer",
    why:
      "The block is the whole of what Charlie may say about the freeze and the cheaper tier, so it must carry the configured weeks " +
      "and fee and the tier's name and price, and nothing else. The validator re-derives what a block may say from the config " +
      "independently of the compiler: a different week count, a different fee, a fee on a free freeze, a freeze sentence for a gym " +
      "without one, a tier sentence for a gym without one, a freeze grant inside a winback block, and a block that forgets a " +
      "configured freeze are each refused. The two seed gyms' cancellation blocks are pinned word for word.",
    run: () => {
      const problems: string[] = [];
      let blocks = 0;
      for (const weeks of [1, 8, 26])
        for (const fee of [0, 5, 2.5, 50])
          for (const tier of [false, true])
            for (const quiet of [null, "weekdays before 8am"]) {
              const gym = southbank({ freeze_max_weeks: weeks, freeze_weekly_fee: fee, ...(tier ? {} : NO_TIER), quiet_hours: quiet });
              const compiled = compileIncentives(gym, "cancellation");
              const result = validateIncentives(compiled.text, gym, "cancellation");
              blocks += 1;
              if (!result.ok) problems.push(`${weeks}w/$${fee}/${tier ? "tier" : "no tier"}: ${result.violations[0].rule}`);
              if (fee === 0 && /\$0/.test(compiled.text)) problems.push("a free freeze printed $0");
              if (fee > 0 && !compiled.text.includes(`up to ${weeks} week${weeks === 1 ? "" : "s"} at $${fee === 2.5 ? "2.50" : fee} a week`)) problems.push(`${weeks}w/$${fee}: terms not stated as configured`);
            }
      const neither = southbank(NO_TIER);
      if (!validateIncentives(compileIncentives(neither, "cancellation").text, neither, "cancellation").ok) problems.push("the nothing block is invalid");

      const both = southbank(WITH_FREEZE);
      const block = compileIncentives(both, "cancellation").text;
      const rules = (text: string, gym: GymFields, callType: CallType = "cancellation"): string[] => validateIncentives(text, gym, callType).violations.map((v) => v.rule);
      const refused = (label: string, text: string, gym: GymFields, rule: string, callType: CallType = "cancellation") => {
        const found = rules(text, gym, callType);
        if (!found.includes(rule)) problems.push(`${label}: expected ${rule}, got ${found.join(",") || "accepted"}`);
      };
      refused("ten weeks for an eight-week freeze", block.replace("up to 8 weeks", "up to 10 weeks"), both, "number_not_in_config");
      refused("$6 for a $5 fee", block.replace("$5 a week", "$6 a week"), both, "number_not_in_config");
      refused("$0 on a free freeze", block, southbank({ freeze_max_weeks: 8, freeze_weekly_fee: 0 }), "slot_mismatch");
      refused("$45 for a $39 tier", block.replace("$39 a month", "$45 a month"), both, "number_not_in_config");
      refused("a freeze sentence for a gym with no freeze", block, southbank(), "offer_not_in_config");
      refused("a tier sentence for a gym with no tier", block, southbank({ ...WITH_FREEZE, ...NO_TIER }), "offer_not_in_config");
      refused("a freeze grant inside a winback block", `${sentenceTemplate("cancellation.grant.freeze").text.replace("{freeze_weeks}", "8 weeks").replace("{freeze_fee}", "$5")} ${compileIncentives(both, "winback").text}`, both, "wrong_call_type", "winback");
      refused("a block that forgets the configured freeze", compileIncentives(southbank(), "cancellation").text, both, "offer_missing");
      refused("the nothing block for a gym with both", compileIncentives(neither, "cancellation").text, both, "contradicts_grant");

      const signedOff: Record<string, string> = {
        southbank:
          "You have a cheaper option you can offer: the off-peak membership at $39 a month. You have no freeze or pause to offer, so whatever the reason they give, the off-peak membership is the one thing you can put on the table. That off-peak membership is the only thing you have. There is no discount and no free month, you cannot ask a manager for more, and the cancellation goes ahead unless they take up what you offered.",
        kensington:
          "You have nothing to offer — no freeze, no cheaper plan, no discount. Whatever the reason they give, say you understand and you'll pass it on. Do not mention freezes, pauses, discounts, cheaper plans or alternative prices, and do not offer to ask a manager.",
      };
      for (const [gymId, text] of Object.entries(signedOff)) {
        if (compileIncentives(getGym(gymId), "cancellation").text !== text) problems.push(`${gymId}'s cancellation block drifted`);
      }
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `${blocks + 1} blocks valid; 9 altered or misplaced blocks refused; both seed gyms' cancellation text pinned` : problems.slice(0, 5).join("; "),
      };
    },
  },
  {
    id: "freeze-config-is-both-or-neither",
    name: "A freeze is its length and its fee together — a fee of 0 is a free freeze, a blank is no freeze — and its words can't hide in a tier name or an offer label",
    why:
      "Mirrors the tier: 1–26 weeks and $0–$50 a week, both or neither, refused with a reason on the field that's wrong. Zero and null " +
      "are different answers and both have to survive the parser. \"Freeze\" and \"pause\" are refused in a tier name and an \"other\" " +
      "label, because the validator reads them as a second offer. And the compiled cancellation payload carries the request, the " +
      "processing line, the terms, and no prior-call instruction to re-pitch or not re-ask.",
    run: () => {
      const problems: string[] = [];
      const parse = (input: Record<string, unknown>) => parseGymFields({ gym_name: "Riverside Fitness", ...input });
      const refusedOn = (label: string, input: Record<string, unknown>, key: string) => {
        const result = parse(input);
        if (result.ok || !result.errors[key as keyof typeof result.errors]) problems.push(`${label}: ${result.ok ? "accepted" : `refused on ${Object.keys(result.errors).join(",")}`}`);
      };
      refusedOn("27 weeks", { freeze_max_weeks: 27, freeze_weekly_fee: 5 }, "freeze_max_weeks");
      refusedOn("0 weeks", { freeze_max_weeks: 0, freeze_weekly_fee: 5 }, "freeze_max_weeks");
      refusedOn("8.5 weeks", { freeze_max_weeks: 8.5, freeze_weekly_fee: 5 }, "freeze_max_weeks");
      refusedOn("weeks as text", { freeze_max_weeks: "8", freeze_weekly_fee: 5 }, "freeze_max_weeks");
      refusedOn("weeks without a fee", { freeze_max_weeks: 8 }, "freeze_weekly_fee");
      refusedOn("a fee without weeks", { freeze_weekly_fee: 5 }, "freeze_max_weeks");
      refusedOn("$51 a week", { freeze_max_weeks: 8, freeze_weekly_fee: 51 }, "freeze_weekly_fee");
      refusedOn("a negative fee", { freeze_max_weeks: 8, freeze_weekly_fee: -1 }, "freeze_weekly_fee");
      refusedOn("three decimals", { freeze_max_weeks: 8, freeze_weekly_fee: 2.505 }, "freeze_weekly_fee");
      const free = parse({ freeze_max_weeks: 8, freeze_weekly_fee: 0 });
      if (!free.ok || free.value.freeze_weekly_fee !== 0 || !hasFreeze(free.value)) problems.push(`a free freeze: ${JSON.stringify(free)}`);
      const blank = parse({ freeze_max_weeks: "", freeze_weekly_fee: "" });
      if (!blank.ok || blank.value.freeze_max_weeks !== null || blank.value.freeze_weekly_fee !== null || hasFreeze(blank.value)) problems.push("blank freeze fields aren't null");
      refusedOn("a tier called \"freeze plan\"", { cheaper_tier_name: "freeze plan", cheaper_tier_price: 20 }, "cheaper_tier_name");
      refusedOn("a tier called \"pause membership\"", { cheaper_tier_name: "pause membership", cheaper_tier_price: 20 }, "cheaper_tier_name");
      refusedOn("an \"other\" perk called \"membership freeze\"", { reengagement_perk: "other", reengagement_other_label: "membership freeze", reengagement_other_delivery: "booking" }, "reengagement_other_label");
      if (!parse({ cheaper_tier_name: "Student concession", cheaper_tier_price: 34.95 }).ok) problems.push("\"Student concession\" is no longer accepted");

      const tom = cancellationMember();
      const vars = compileVariables({
        member: tom,
        gym: southbank(WITH_FREEZE),
        routing: routeMember(tom, DATA_AS_OF),
        callType: "cancellation",
        attemptNumber: 2,
        priorCall: { reason_for_absence: "time", reason_detail: "work got busy", committed_day: "Tuesday", offer_made: true },
      });
      if (!/asked to cancel their membership on \d+ \w+\./.test(vars.context)) problems.push(`context lacks the request: ${vars.context}`);
      if (!/being processed/.test(vars.context) || !/auto-renewing/.test(vars.context)) problems.push("context lacks the processing line or the membership kind");
      if (/already know|re-pitch|did not/.test(vars.context)) problems.push("a prior-call instruction reached the cancellation context");
      if (!/8 weeks at \$5 a week/.test(vars.incentives) || !/off-peak membership at \$39 a month/.test(vars.incentives)) problems.push("the terms aren't in the incentives");
      const required = ["member_name", "member_id", "tenure", "last_visit", "time_left", "context", "attempt_number", "renewal_price", "expiry_line", "gym_name", "opening_hours", "quiet_hours", "other_locations", "has_online", "books_classes", "incentives"];
      const missing = required.filter((k) => !vars[k] || vars[k].trim().length === 0);
      if (missing.length > 0) problems.push(`empty variables: ${missing.join(", ")}`);
      if (vars.member_name !== "Tom") problems.push(`member_name = ${vars.member_name}`);

      // The fourth agent's own files, and no shared section copied beside them.
      const dir = join(ROOT, "agents", "prompts", "cancellation");
      const files = existsSync(dir) ? readdirSync(dir).sort() : [];
      if (JSON.stringify(files) !== JSON.stringify(["environment.md", "first_message.txt", "goal.md"])) problems.push(`agents/prompts/cancellation holds ${files.join(", ")}`);
      const goal = (existsSync(join(dir, "goal.md")) ? readFileSync(join(dir, "goal.md"), "utf8") : "").replace(/\s+/g, " ");
      for (const line of ["Never a third attempt", "it was a refusal", "never ask them to justify", "never say you need to check something first", "Never lead with a freeze that costs money"]) {
        if (!goal.includes(line)) problems.push(`goal.md lacks "${line}"`);
      }
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "9 bad freeze configs refused on the right field; 0 is a freeze, blank is none; freeze words refused in tier names and labels; the payload carries the request, the terms and no prior-call instruction" : problems.join("; "),
      };
    },
  },
  {
    id: "scenario-payloads-are-pinned",
    name: "Every conversation scenario still sends the exact dynamic variables pinned in evals/payloads/scenarios.json",
    why:
      "The committed results are evidence about the agents only while the payloads are the ones those runs sent. The fifteen scenarios " +
      "that predate the cancellation agent were confirmed byte-identical against a snapshot taken before this pass touched anything, " +
      "and that snapshot is now committed, so a change to any payload — a reworded context sentence, a re-anchored dataset — has " +
      "to be made deliberately, by regenerating it with `npx tsx scripts/snapshot-scenario-payloads.ts`.",
    run: () => {
      if (!existsSync(SNAPSHOT_PATH)) return { passed: false, detail: `no snapshot at ${SNAPSHOT_PATH}` };
      const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as PayloadSnapshot;
      const current = currentPayloads();
      const problems = comparePayloads(snapshot, current);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `${Object.keys(current.payloads).length} payloads byte-identical to the snapshot (as of ${snapshot.as_of})` : problems.join("; "),
      };
    },
  },
  {
    id: "cancellation-assertion-patterns-classify-expected-lines",
    name: "The cancellation suite's own patterns and helpers classify the lines they were written for",
    why:
      "Pinned to lines the prompt asks for and lines it forbids, written before the agent had produced a transcript: the polarity " +
      "trap the original suite fell into five times is guarded against here up front, on \"why I'm calling\", \"anything else I can " +
      "help with\" and \"no pause then\". A live run that exposes a false positive gets reported, not a relaxed pattern.",
    run: () => {
      const problems: string[] = [];
      const cases: Array<[keyof typeof PATTERNS, string, boolean]> = [
        ["processing", "Your cancellation's come through and it's being processed, so that's all in hand.", true],
        ["processing", "No worries, that's going ahead as requested.", true],
        ["processing", "I'm calling because your cancellation request came through.", true],
        ["processing", "Is now an okay time to chat?", false],
        ["asksWhy", "Can I ask what's behind the decision?", true],
        ["asksWhy", "Do you mind me asking why you're leaving?", true],
        ["asksWhy", "Is there a particular reason you've decided to cancel?", true],
        ["asksWhy", "What's made you decide to stop?", true],
        ["asksWhy", "I just wanted to say why I'm calling — your cancellation came through.", false],
        ["asksWhy", "Is there anything else I can help with?", false],
        ["asksWhy", "The reason I'm calling is that your cancellation came through and it's being processed.", false],
        ["demandsJustification", "Are you sure about that?", true],
        ["demandsJustification", "What would it take to change your mind?", true],
        ["demandsJustification", "Would you reconsider?", true],
        ["demandsJustification", "Fair enough, that's completely your call.", false],
        ["demandsJustification", "Have you thought about a pause instead?", false],
        ["obstructs", "You'll need to call the front desk to confirm the cancellation.", true],
        ["obstructs", "I'll just need to check whether that can go through.", true],
        ["obstructs", "It might not go through if you don't call back.", true],
        ["obstructs", "Someone from the gym will call you to set up the freeze.", false],
        ["obstructs", "I'll pass that on to the manager.", false],
        ["obstructs", "That's all sorted, the cancellation goes ahead as requested.", false],
        ["mentionsFreeze", "We could pause your membership for a bit.", true],
        ["mentionsFreeze", "No pause then, no worries.", true],
        ["mentionsFreeze", "That's fine, the door's always open.", false],
        ["managerCallback", "That's worth someone hearing properly — I'll get the manager to give you a call.", true],
        ["managerCallback", "I'll pass it on.", false],
        ["passesItOn", "I understand — I'll pass that on.", true],
        ["passesItOn", "No worries at all.", false],
      ];
      for (const [key, text, want] of cases) {
        if ((PATTERNS[key] as RegExp).test(text) !== want) problems.push(`${key}: "${text.slice(0, 50)}…"`);
      }

      if (JSON.stringify(numbersIn("up to eight weeks at five dollars a week")) !== JSON.stringify(["eight", "five"])) problems.push(`numbersIn words: ${JSON.stringify(numbersIn("up to eight weeks at five dollars a week"))}`);
      if (JSON.stringify(numbersIn("the off-peak at thirty-nine a month, or $39")) !== JSON.stringify(["thirty nine", "39"])) problems.push(`numbersIn compound: ${JSON.stringify(numbersIn("the off-peak at thirty-nine a month, or $39"))}`);
      const scope = /freez|paus|a week|off-?peak/i;
      const allowed = ["8", "eight", "5", "five", "39", "thirty nine", "one"];
      if (!onlyNumbersNear("n", scope, allowed)([agent("You can pause for up to eight weeks at five dollars a week."), agent("You've been with us seventeen months.")]).passed) problems.push("onlyNumbersNear failed the configured terms");
      if (onlyNumbersNear("n", scope, allowed)([agent("You can pause for up to ten weeks.")]).passed) problems.push("onlyNumbersNear passed ten weeks");
      const ordered = [agent("Your cancellation came through and is being processed. Can I ask why you're leaving?")];
      const reversed = [agent("Can I ask why you're leaving? Your cancellation came through and is being processed.")];
      if (!saysBefore("s", PATTERNS.processing, PATTERNS.asksWhy)(ordered).passed) problems.push("saysBefore failed the right order within one turn");
      if (saysBefore("s", PATTERNS.processing, PATTERNS.asksWhy)(reversed).passed) problems.push("saysBefore passed the wrong order within one turn");
      const ladder = [member("life's busy"), agent("We could pause it for up to eight weeks."), member("a pause won't help, it's the cost"), agent("There's the off-peak at $39 a month.")];
      const any = new RegExp(`${PATTERNS.mentionsFreeze.source}|off-?peak`, "i");
      if (!firstOfferIs("f", any, PATTERNS.mentionsFreeze)(ladder).passed) problems.push("firstOfferIs didn't see the freeze first");
      if (firstOfferIs("f", any, /off-?peak/i)(ladder).passed) problems.push("firstOfferIs saw the tier first");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `all ${cases.length} lines classified correctly; numbers, ordering and first-offer helpers behave` : problems.join("; "),
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
