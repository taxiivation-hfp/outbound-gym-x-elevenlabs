import { routeMember, type CallType } from "@/lib/callType";
import { summarise } from "@/lib/callHistory";
import { DATA_AS_OF } from "@/lib/clock";
import { compileVariables } from "@/lib/compileVariables";
import { evaluateOffers, withholdOffers } from "@/lib/eligibility";
import { parseGymConfig, parseOfferSchedule, type GymConfig, type OfferSchedule } from "@/lib/gymConfig";
import { getGym } from "@/lib/gyms";
import { compileIncentives, grantedOffers } from "@/lib/incentives";
import { validateIncentives } from "@/lib/validateIncentives";
import type { Member } from "@/lib/types";
import { fixtureMember, isoOffset } from "./fixtures";
import type { Guard } from "./guards";

/**
 * Guards over offer schedules and offer eligibility (PASS_ONE item 2).
 *
 * The incentive system said what a gym offers; the schedule says how often.
 * Both halves of the rule are pinned: a spent offer compiles to the block a gym
 * with nothing gets — the path that was already guarded — and a member without
 * a genuine habit never reaches an offer at all, whatever the schedule says.
 */

function daysAgo(days: number): string {
  return new Date(DATA_AS_OF.getTime() - days * 86_400_000).toISOString();
}

function offeredRow(days: number, callType: CallType, offers: string[] | undefined) {
  return {
    member_id: "O0001",
    status: "completed",
    reached_member: true,
    outcome: "not_interested",
    offer_made: true,
    call_type: callType,
    created_at: daysAgo(days),
    transcript: "x",
    ...(offers ? { offers_available: offers } : {}),
  };
}

function withSchedule(gymId: string, schedule: OfferSchedule): GymConfig {
  const parsed = parseGymConfig({ ...getGym(gymId), offer_schedule: schedule });
  if (!parsed.ok) throw new Error(`fixture schedule invalid: ${JSON.stringify(parsed.errors)}`);
  return parsed.value;
}

/** Away five weeks after training 2.5 times a week, seven months left: reengagement. */
const regular = (): Member =>
  fixtureMember({ expiry_date: isoOffset(200), signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 8 } });

/** Lapsed three weeks ago after 1.9 visits a week: winback. */
const lapsedRegular = (): Member =>
  fixtureMember({ contract_status: "expired", expiry_date: isoOffset(-24), signals: { days_since_visit: 52, old_rate: 1.9, tenure_days: 320, visit_count_90d: 3 } });

function compile(member: Member, gym: GymConfig, callType: CallType, history: ReturnType<typeof summarise>) {
  const offers = evaluateOffers(member, history, gym.offer_schedule, callType, DATA_AS_OF);
  const variables = compileVariables({ member, gym, routing: routeMember(member, DATA_AS_OF), callType, priorCall: history.priorCall, attemptNumber: history.attemptNumber, offers });
  const masked = withholdOffers(gym, offers);
  return { offers, block: variables.incentives, masked, granted: grantedOffers(compileIncentives(masked, callType)), valid: validateIncentives(variables.incentives, masked, callType) };
}

export const offerGuards: Guard[] = [
  {
    id: "offer-inside-cooldown-compiles-to-nothing",
    name: "An offer inside its cooldown compiles to a block that offers nothing, and the validator accepts that block",
    why:
      "Nothing stopped the same member being offered a guest pass every month. The schedule is enforced before the block " +
      "is compiled, and a spent offer takes the \"nothing to give them\" path that already exists and is already guarded — " +
      "so the agent is never handed an offer and a rule not to use it.",
    run: () => {
      const gym = withSchedule("southbank", { guest_pass: "quarterly" });
      const member = regular();
      const spent = compile(member, gym, "reengagement", summarise([offeredRow(30, "reengagement", ["guest_pass"])]));
      const nothing = compileIncentives({ ...gym, reengagement_perk: null }, "reengagement").text;
      const again = compile(member, gym, "reengagement", summarise([offeredRow(92, "reengagement", ["guest_pass"])]));
      const problems: string[] = [];
      if (!spent.offers.withheld.guest_pass) problems.push("a guest pass 30 days into a quarterly cooldown wasn't withheld");
      if (spent.block !== nothing) problems.push(`spent block isn't the nothing block: ${spent.block}`);
      if (!spent.valid.ok) problems.push(`validator refused the nothing block: ${spent.valid.violations.map((v) => v.rule).join(",")}`);
      if (/guest pass/i.test(spent.block)) problems.push("the spent block still names a guest pass");
      if (again.offers.withheld.guest_pass || !/guest pass/.test(again.block) || !again.valid.ok) problems.push("after the quarter the guest pass didn't come back");
      const off = compile(member, withSchedule("southbank", { guest_pass: "never" }), "reengagement", summarise([]));
      if (!off.offers.withheld.guest_pass || off.block !== nothing) problems.push("\"never\" didn't switch the guest pass off");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? `day 30 of a quarter: "${spent.block.slice(0, 60)}…" (valid); day 92: guest pass again; "never": off` : problems.join("; "),
      };
    },
  },
  {
    id: "offer-cooldowns-are-independent",
    name: "Each offer type's cooldown is its own: spending one doesn't spend another",
    why:
      "Cooldown is per offer type, not per member. A lapsed member given a free PT session last week can still be told about " +
      "the cheaper membership if money is the problem, and a renewal discount says nothing about a guest pass.",
    run: () => {
      const gym = withSchedule("southbank", { free_pt_session: "quarterly", cheaper_tier: "yearly", guest_pass: "monthly", renewal_discount: "yearly" });
      const problems: string[] = [];
      const winback = compile(lapsedRegular(), gym, "winback", summarise([offeredRow(10, "winback", ["free_pt_session"])]));
      if (!winback.offers.withheld.free_pt_session) problems.push("the PT session wasn't withheld");
      if (winback.offers.withheld.cheaper_tier) problems.push("the cheaper tier was withheld by the PT session's cooldown");
      if (JSON.stringify(winback.granted) !== JSON.stringify(["cheaper_tier"])) problems.push(`winback grants ${JSON.stringify(winback.granted)}`);
      if (!winback.valid.ok) problems.push(`winback block invalid: ${winback.valid.violations.map((v) => v.rule).join(",")}`);

      const afterDiscount = summarise([offeredRow(5, "renewal", ["renewal_discount"])]);
      const reengagement = compile(regular(), gym, "reengagement", afterDiscount);
      if (reengagement.offers.withheld.guest_pass || !reengagement.granted.includes("guest_pass")) problems.push("a renewal discount spent the guest pass");
      if (!evaluateOffers(fixtureMember({ expiry_date: isoOffset(12) }), afterDiscount, gym.offer_schedule, "renewal", DATA_AS_OF).withheld.renewal_discount) {
        problems.push("the renewal discount wasn't withheld inside its own year");
      }

      // A guest pass is one offer type across calls: given on reengagement, it's spent on winback too.
      const pass = withSchedule("southbank", { guest_pass: "quarterly" });
      const passGym = { ...pass, winback_offer: "guest_pass" as const };
      const crossCall = evaluateOffers(lapsedRegular(), summarise([offeredRow(20, "reengagement", ["guest_pass"])]), passGym.offer_schedule, "winback", DATA_AS_OF);
      if (!crossCall.withheld.guest_pass) problems.push("a guest pass given on reengagement wasn't spent for winback");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "PT session spent, tier still offered (valid block); discount leaves the guest pass; guest pass spans call types" : problems.join("; "),
      };
    },
  },
  {
    id: "habit-guard-blocks-offers-regardless-of-cooldown",
    name: "A member who never had a habit never reaches an offer, whatever the schedule or cooldown says",
    why:
      "The reward-hacking guard. Offers only reach members who are inactive after a genuine habit — the router's own 1.0 " +
      "visits a week, unchanged. Gaming it means not going to the gym, and someone who never had a routine can't qualify at " +
      "all: not with no schedule, not with every cooldown long expired. A renewal call reaches members still training, so its " +
      "discount isn't gated.",
    run: () => {
      const problems: string[] = [];
      const noSchedule = getGym("southbank");
      // Near expiry and absent: the router calls regardless of habit, and the offer gate doesn't.
      const sporadic = fixtureMember({ expiry_date: isoOffset(10), signals: { days_since_visit: 35, old_rate: 0.3, tenure_days: 300, visit_count_90d: 1 } });
      const reengagement = compile(sporadic, noSchedule, "reengagement", summarise([]));
      if (routeMember(sporadic, DATA_AS_OF).call_type !== "reengagement") problems.push("fixture isn't a reengagement call");
      if (reengagement.granted.length > 0 || !reengagement.valid.ok) problems.push(`sporadic reengagement grants ${JSON.stringify(reengagement.granted)}`);

      const sporadicLapsed = fixtureMember({ contract_status: "expired", expiry_date: isoOffset(-30), signals: { days_since_visit: 60, old_rate: 0.6, tenure_days: 300, visit_count_90d: 0 } });
      const winback = compile(sporadicLapsed, withSchedule("southbank", { free_pt_session: "monthly" }), "winback", summarise([offeredRow(400, "winback", ["free_pt_session"])]));
      if (winback.granted.length > 0 || !winback.valid.ok) problems.push(`sporadic winback grants ${JSON.stringify(winback.granted)}`);

      const at = (rate: number) => evaluateOffers(fixtureMember({ expiry_date: isoOffset(200), signals: { days_since_visit: 35, old_rate: rate, tenure_days: 300, visit_count_90d: 5 } }), summarise([]), null, "reengagement", DATA_AS_OF);
      if (Object.keys(at(1.0).withheld).length > 0) problems.push("1.0 visits a week didn't pass the gate");
      if (!at(0.99).withheld.guest_pass) problems.push("0.99 visits a week passed the gate");

      const renewal = evaluateOffers(fixtureMember({ expiry_date: isoOffset(12), signals: { days_since_visit: 3, old_rate: 0.4, tenure_days: 240, visit_count_90d: 5 } }), summarise([]), null, "renewal", DATA_AS_OF);
      if (renewal.withheld.renewal_discount) problems.push("the renewal discount was gated on habit");
      return {
        passed: problems.length === 0,
        detail: problems.length === 0 ? "sporadic reengagement and winback get nothing (valid blocks); gate at exactly 1.0; renewal ungated" : problems.join("; "),
      };
    },
  },
  {
    id: "schedule-names-only-configured-offers",
    name: "A gym can only schedule offers its own config grants, from the fixed periods, and no schedule changes nothing",
    why:
      "The schedule's offer choices come from what onboarding captured; a gym can't schedule something it never set up, and " +
      "a stored schedule naming one is refused like any other bad config. A gym with no schedule parses to exactly the object " +
      "it did before schedules existed, which keeps every scenario payload the same.",
    run: () => {
      const problems: string[] = [];
      const kensington = getGym("kensington");
      if (!parseOfferSchedule({ guest_pass: "quarterly" }, kensington).error) problems.push("Kensington scheduled a guest pass it doesn't offer");
      if (parseGymConfig({ ...kensington, offer_schedule: { guest_pass: "quarterly" } }).ok) problems.push("a stored row scheduling an unconfigured offer parsed");
      if (!parseOfferSchedule({ guest_pass: "fortnightly" }, getGym("southbank")).error) problems.push("an unknown period was accepted");
      if (!parseOfferSchedule({ free_month: "yearly" }, getGym("southbank")).error) problems.push("an unknown offer was accepted");
      if (parseOfferSchedule({}, getGym("southbank")).value !== null) problems.push("an empty schedule isn't blank");
      for (const id of ["southbank", "kensington"]) {
        const reparsed = parseGymConfig(getGym(id));
        if (!reparsed.ok || "offer_schedule" in reparsed.value) problems.push(`${id} gained an offer_schedule key`);
      }
      const m = regular();
      const plain = compileVariables({ member: m, gym: getGym("southbank"), routing: routeMember(m, DATA_AS_OF), callType: "reengagement" });
      const evaluated = compileVariables({ member: m, gym: getGym("southbank"), routing: routeMember(m, DATA_AS_OF), callType: "reengagement", offers: evaluateOffers(m, summarise([]), undefined, "reengagement", DATA_AS_OF) });
      if (JSON.stringify(plain) !== JSON.stringify(evaluated)) problems.push("an eligible member with no schedule compiles differently");
      return { passed: problems.length === 0, detail: problems.length === 0 ? "unconfigured offers, unknown periods and offers refused; no schedule is no change" : problems.join("; ") };
    },
  },
  {
    id: "offer-history-spends-conservatively",
    name: "An offer counts as made only when one was, and a record from before offers were recorded spends every offer its call could carry",
    why:
      "Cooldowns are measured from call history. A conversation with no offer spends nothing; one whose block granted nothing " +
      "spends nothing; one recorded before `offers_available` existed can't say which offer it was, so it spends all its call " +
      "type could carry — which can only make a cooldown longer, never skip one.",
    run: () => {
      const problems: string[] = [];
      const legacy = summarise([offeredRow(10, "winback", undefined)]).offersLastMade;
      if (JSON.stringify(Object.keys(legacy).sort()) !== JSON.stringify(["cheaper_tier", "free_pt_session", "guest_pass"])) problems.push(`legacy winback spent ${JSON.stringify(legacy)}`);
      if (Object.keys(summarise([offeredRow(10, "reengagement", [])]).offersLastMade).length > 0) problems.push("a block that granted nothing spent an offer");
      if (Object.keys(summarise([{ ...offeredRow(10, "reengagement", ["guest_pass"]), offer_made: false }]).offersLastMade).length > 0) problems.push("a call with no offer made spent one");
      if (Object.keys(summarise([{ ...offeredRow(10, "reengagement", ["guest_pass"]), reached_member: false, transcript: null, status: "failed" }]).offersLastMade).length > 0) problems.push("an unanswered dial spent an offer");
      const latest = summarise([offeredRow(100, "reengagement", ["guest_pass"]), offeredRow(20, "reengagement", ["guest_pass"])]).offersLastMade.guest_pass;
      if (latest !== daysAgo(20)) problems.push(`the cooldown runs from ${latest}, not the latest offer`);
      return { passed: problems.length === 0, detail: problems.length === 0 ? "legacy records spend all their call type's offers; no offer, no spend; latest offer wins" : problems.join("; ") };
    },
  },
];
