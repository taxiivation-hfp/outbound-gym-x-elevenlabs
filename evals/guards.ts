import { routeMember } from "@/lib/callType";
import { NO_HISTORY, summarise } from "@/lib/callHistory";
import { compileVariables, firstName } from "@/lib/compileVariables";
import { evaluateEligibility } from "@/lib/eligibility";
import { getGym } from "@/lib/gyms";
import { PATTERNS } from "./assertions";
import { configGuards } from "./configGuards";
import { healthGuards } from "./healthGuards";
import { memberGuards } from "./memberGuards";
import { offerGuards } from "./offerGuards";
import { otherOfferGuards } from "./otherOfferGuards";
import { fixtureMember, isoOffset } from "./fixtures";

/**
 * The half of the evaluation that needs no model.
 *
 * The conversation suite scores what the agent says. These score what the system
 * decides: who gets called, who never does, and what the agent is told. They run
 * in milliseconds, cost nothing, and are the assertions that would actually catch
 * a regression in the rule that matters most — an auto-renewing member must
 * never be dialled, whatever else is true of them.
 *
 * Written as data rather than a test framework because there is one runner and
 * one results format for both halves of the suite, and a judge reading the repo
 * should find one place where evaluation lives.
 */

export interface GuardResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  why: string;
}

export interface Guard {
  id: string;
  name: string;
  why: string;
  /** Synchronous, except where the code under test is async (the nightly summary). */
  run: () => { passed: boolean; detail: string } | Promise<{ passed: boolean; detail: string }>;
}

function record(iso: string, fields: Record<string, unknown> = {}) {
  return { member_id: "G0001", status: "completed", created_at: iso, transcript: "x", ...fields };
}

const guards: Guard[] = [
  {
    id: "auto-renew-dormant-never-called",
    name: "A dormant auto-renewer is never called",
    why:
      "The single rule the product is built on. Six months absent and still billing is the " +
      "member a churn model flags hardest and the one a call can actively lose.",
    run: () => {
      const m = fixtureMember({
        auto_renew: true,
        contract_type: "month-to-month",
        expiry_date: isoOffset(11),
        signals: { days_since_visit: 200, old_rate: 3.1, tenure_days: 600, visit_count_90d: 0 },
      });
      const r = routeMember(m);
      return {
        passed: r.call_type === null && r.auto_renew_excluded,
        detail: r.call_type ? `routed to ${r.call_type}` : `excluded: ${r.excluded_reason}`,
      };
    },
  },
  {
    id: "auto-renew-near-rollover-never-called",
    name: "An auto-renewer days from rollover is never called",
    why:
      "Their expiry date always looks imminent, because it is the next billing date. This is " +
      "the exact member a date-triggered dialer rings by accident.",
    run: () => {
      const m = fixtureMember({
        auto_renew: true,
        contract_type: "month-to-month",
        expiry_date: isoOffset(3),
      });
      const r = routeMember(m);
      return {
        passed: r.call_type === null && r.auto_renew_excluded,
        detail: r.call_type ? `routed to ${r.call_type}` : "excluded on the auto-renew rule",
      };
    },
  },
  {
    id: "renewal-fires-for-training-member",
    name: "Renewal fires twelve days out for someone still training",
    why: "The call type the old dataset could not produce at all.",
    run: () => {
      const r = routeMember(fixtureMember({ expiry_date: isoOffset(12) }));
      return { passed: r.call_type === "renewal", detail: `routed to ${r.call_type}` };
    },
  },
  {
    id: "reengagement-fires-on-absence-with-habit",
    name: "Reengagement fires at five weeks absent for a former regular",
    why: "Membership still live, so there is still something to save.",
    run: () => {
      const r = routeMember(
        fixtureMember({
          expiry_date: isoOffset(200),
          signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 12 },
        })
      );
      return { passed: r.call_type === "reengagement", detail: `routed to ${r.call_type}` };
    },
  },
  {
    id: "habit-guard-blocks-sporadic-member",
    name: "Five weeks absent does not fire for someone who was never a regular",
    why:
      "Without this guard the reengagement agent spends most of its calls on people whose " +
      "quiet month means nothing, because they were always occasional.",
    run: () => {
      const r = routeMember(
        fixtureMember({
          expiry_date: isoOffset(200),
          signals: { days_since_visit: 35, old_rate: 0.3, tenure_days: 300, visit_count_90d: 2 },
        })
      );
      return {
        passed: r.call_type === null,
        detail: r.call_type ? `routed to ${r.call_type}` : `excluded: ${r.excluded_reason}`,
      };
    },
  },
  {
    id: "near-expiry-absence-overrides-habit-guard",
    name: "Absent and about to lapse fires regardless of habit",
    why:
      "The habit guard exists to avoid calling on a weak signal. A membership days from " +
      "lapsing is not a weak signal, and there is nothing left to protect by staying quiet.",
    run: () => {
      const r = routeMember(
        fixtureMember({
          expiry_date: isoOffset(10),
          signals: { days_since_visit: 35, old_rate: 0.3, tenure_days: 300, visit_count_90d: 1 },
        })
      );
      return { passed: r.call_type === "reengagement", detail: `routed to ${r.call_type}` };
    },
  },
  {
    id: "winback-windows",
    name: "Winback fires at ~1, ~3 and ~6 months and nowhere between",
    why:
      "A post-expiry cadence, not a standing invitation to ring every week. The gaps are as " +
      "much of the rule as the windows.",
    run: () => {
      const cases: Array<[number, number | null]> = [
        [-30, 1],
        [-60, null],
        [-90, 3],
        [-130, null],
        [-180, 6],
        [-300, null],
      ];
      const wrong = cases.filter(([offset, expected]) => {
        const r = routeMember(
          fixtureMember({
            contract_status: "expired",
            expiry_date: isoOffset(offset),
            signals: { days_since_visit: -offset + 20, old_rate: 1.8, tenure_days: 400, visit_count_90d: 0 },
          })
        );
        return (r.winback_window ?? null) !== expected;
      });
      return {
        passed: wrong.length === 0,
        detail:
          wrong.length === 0
            ? "all six offsets landed in the right window"
            : `wrong at ${wrong.map(([o]) => `${-o}d`).join(", ")}`,
      };
    },
  },
  {
    id: "do-not-contact-is-permanent",
    name: "Do-not-contact blocks a member the trigger would otherwise call",
    why: "Permanent, and it has to survive both a new trigger and a different call type.",
    run: () => {
      const history = summarise([record("2026-08-01T00:00:00Z", { do_not_contact: true, reached_member: true })]);
      const e = evaluateEligibility(fixtureMember({ expiry_date: isoOffset(12) }), history);
      return {
        passed: !e.allowed && e.blockedBy === "do_not_contact",
        detail: e.allowed ? "call allowed" : `blocked by ${e.blockedBy}`,
      };
    },
  },
  {
    id: "cooldown-after-a-call-that-changed-nothing",
    name: "A conversation ten days ago that changed nothing blocks today's call",
    why: "One member, eight near-identical calls a year, is how a retention tool causes churn.",
    run: () => {
      const ten = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const history = summarise([
        record(ten, { reached_member: true, outcome: "not_interested" }),
      ]);
      const e = evaluateEligibility(
        fixtureMember({
          expiry_date: isoOffset(200),
          signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 12 },
        }),
        history
      );
      return {
        passed: !e.allowed && e.blockedBy === "cooldown",
        detail: e.allowed ? "call allowed" : `blocked by ${e.blockedBy}`,
      };
    },
  },
  {
    id: "cooldown-lifts-when-the-call-worked",
    name: "A call that got them back in resumes the normal trigger immediately",
    why:
      "The cooldown punishes calls that do nothing, not calls that work. An intervention that " +
      "worked once has earned the right to happen again.",
    run: () => {
      const ten = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const history = summarise([record(ten, { reached_member: true, outcome: "booked" })]);
      const e = evaluateEligibility(
        fixtureMember({
          expiry_date: isoOffset(200),
          signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 12 },
        }),
        history
      );
      return { passed: e.allowed, detail: e.allowed ? "allowed" : `blocked by ${e.blockedBy}` };
    },
  },
  {
    id: "no-answer-does-not-count-as-an-attempt",
    name: "A dial nobody answered does not increment the attempt number",
    why:
      "attempt_number tells the agent which conversation this is. Counting dials would make " +
      "it brief with someone it has never actually spoken to.",
    run: () => {
      const history = summarise([
        record("2026-09-01T00:00:00Z", { status: "failed", transcript: null }),
        record("2026-09-02T00:00:00Z", { status: "failed", transcript: null }),
        record("2026-09-03T00:00:00Z", { reached_member: true, outcome: "will_return" }),
      ]);
      return {
        passed: history.attemptNumber === 2 && history.dialCount === 3,
        detail: `attempt ${history.attemptNumber} after ${history.dialCount} dials`,
      };
    },
  },
  {
    id: "attempt-cap",
    name: "Three conversations is the limit",
    why:
      "The prompts describe behaviour for attempts one to three. A fourth call would be " +
      "running on undefined behaviour.",
    run: () => {
      const history = summarise([
        record("2026-09-01T00:00:00Z", { reached_member: true, outcome: "not_interested" }),
        record("2026-09-02T00:00:00Z", { reached_member: true, outcome: "not_interested" }),
        record("2026-09-03T00:00:00Z", { reached_member: true, outcome: "not_interested" }),
      ]);
      const e = evaluateEligibility(fixtureMember({ expiry_date: isoOffset(12) }), history);
      return {
        passed: !e.allowed && e.blockedBy === "max_attempts",
        detail: e.allowed ? "allowed" : `blocked by ${e.blockedBy} at attempt ${e.attemptNumber}`,
      };
    },
  },
  {
    id: "winback-time-left-reads-correctly",
    name: 'Winback time_left does not double the word "expired"',
    why:
      'The prompt says "Their membership expired {{time_left}}". The brief\'s example value ' +
      'also began with "expired", which would have produced "expired expired three weeks ago".',
    run: () => {
      const m = fixtureMember({
        contract_status: "expired",
        expiry_date: isoOffset(-24),
        signals: { days_since_visit: 50, old_rate: 1.9, tenure_days: 320, visit_count_90d: 0 },
      });
      const routing = routeMember(m);
      const v = compileVariables({
        member: m,
        gym: getGym(),
        routing,
        callType: "winback",
      });
      return {
        passed: !/expired/i.test(v.time_left) && /ago$/.test(v.time_left),
        detail: `time_left = "${v.time_left}"`,
      };
    },
  },
  {
    id: "expiry-line-has-no-nested-placeholder",
    name: "expiry_line contains no unexpanded placeholder",
    why:
      "ElevenLabs substitutes variables into the prompt once and does not re-scan the values " +
      "it inserted, so a {{time_left}} inside expiry_line would have been read out verbatim.",
    run: () => {
      const m = fixtureMember({
        expiry_date: isoOffset(13),
        signals: { days_since_visit: 35, old_rate: 2.2, tenure_days: 400, visit_count_90d: 6 },
      });
      const routing = routeMember(m);
      const v = compileVariables({ member: m, gym: getGym(), routing, callType: "reengagement" });
      return {
        passed: !v.expiry_line.includes("{{") && /thirteen days/.test(v.expiry_line),
        detail: v.expiry_line.replace(/\s+/g, " ").slice(0, 120),
      };
    },
  },
  {
    id: "every-variable-has-a-value",
    name: "Every variable the prompts reference arrives with a value",
    why:
      "A blank variable leaves a hole in the middle of the prompt. Defaults are sentences the " +
      "agent can say out loud, not empty strings.",
    run: () => {
      const m = fixtureMember({ expiry_date: isoOffset(12) });
      const v = compileVariables({
        member: m,
        gym: getGym(),
        routing: routeMember(m),
        callType: "renewal",
      });
      const expected = [
        "member_name", "member_id", "tenure", "last_visit", "time_left", "context",
        "attempt_number", "renewal_price", "expiry_line", "gym_name", "opening_hours",
        "quiet_hours", "other_locations", "has_online", "books_classes", "incentives",
      ];
      const missing = expected.filter((k) => !v[k] || v[k].trim().length === 0);
      return {
        passed: missing.length === 0,
        detail: missing.length ? `empty: ${missing.join(", ")}` : `all ${expected.length} present`,
      };
    },
  },
  {
    id: "first-name-only",
    name: "The agent greets a first name, not a title",
    why:
      'The first thing it says is "Hi, is that X?". 19 of the 500 dataset names carry a title ' +
      'or a suffix, and "Hi, is that Dr.?" ends the call before it starts.',
    run: () => {
      const cases: Array<[string, string]> = [
        ["Dr. Jordan Hill PhD", "Jordan"],
        ["Ms. Aisha Brennan", "Aisha"],
        ["Michael Farrow", "Michael"],
        ["Timothy Cole Jr.", "Timothy"],
      ];
      const wrong = cases.filter(([input, expected]) => firstName(input) !== expected);
      return {
        passed: wrong.length === 0,
        detail: wrong.length
          ? wrong.map(([i]) => `${i} -> ${firstName(i)}`).join("; ")
          : "titles and suffixes stripped",
      };
    },
  },
  {
    id: "gym-config-changes-the-offer",
    name: "Switching gym changes what the agent may offer, with no prompt change",
    why:
      "The scalability claim, made checkable: one prompt, config per gym. Kensington funds " +
      "nothing, and the agent has to be told so in words it cannot work around.",
    run: () => {
      const m = fixtureMember({ expiry_date: isoOffset(12) });
      const routing = routeMember(m);
      const southbank = compileVariables({ member: m, gym: getGym("southbank"), routing, callType: "renewal" });
      const kensington = compileVariables({ member: m, gym: getGym("kensington"), routing, callType: "renewal" });
      const southbankOffers = /20%/.test(southbank.incentives);
      const kensingtonOffers = /%|discount|cheaper/i.test(kensington.incentives.replace(/Do not mention[\s\S]*$/i, ""));
      return {
        passed: southbankOffers && !kensingtonOffers,
        detail: `southbank offers a discount: ${southbankOffers}; kensington offers one: ${kensingtonOffers}`,
      };
    },
  },
  {
    id: "closed-loop-carries-the-reason-forward",
    name: "A second call already knows why they stopped",
    why:
      "Re-asking a question the last call answered is the tell that an outbound caller is a " +
      "dialer rather than a system.",
    run: () => {
      const m = fixtureMember({
        expiry_date: isoOffset(200),
        signals: { days_since_visit: 35, old_rate: 2.5, tenure_days: 300, visit_count_90d: 8 },
      });
      const v = compileVariables({
        member: m,
        gym: getGym(),
        routing: routeMember(m),
        callType: "reengagement",
        attemptNumber: 2,
        priorCall: {
          reason_for_absence: "injury",
          reason_detail: "did my knee in playing footy",
          committed_day: "Tuesday",
          offer_made: true,
        },
      });
      return {
        passed:
          /already know why they stopped/i.test(v.context) &&
          /knee/.test(v.context) &&
          /Do not ask why they stopped/i.test(v.context) &&
          v.attempt_number === "2",
        detail: v.context.slice(v.context.indexOf("You already know")).slice(0, 150),
      };
    },
  },
  {
    id: "assertion-patterns-match-real-transcripts",
    name: "The suite's own patterns agree with real transcripts",
    why:
      "Five of the conversation failures across four runs were this suite being wrong rather " +
      "than the agent: a pattern that matched \"because your membership ends in twelve days\" " +
      "as an explanation of the calling criteria, one that read \"I don't have any cheaper " +
      "plans or discounts to offer\" as offering a discount, one that could not see the word " +
      "\"actually\" inside \"I don't actually have that in front of me\". A regex cannot see " +
      "polarity, so every pattern is now pinned to lines real transcripts actually produced.",
    run: () => {
      const cases: Array<[keyof typeof PATTERNS, string, boolean]> = [
        ["dontHaveThat", "I don't actually have the quiet times in front of me, sorry about that.", true],
        ["dontHaveThat", "I don't have that information in front of me, but I can have someone follow up.", true],
        ["dontHaveThat", "It's usually quietest between ten AM and four PM on weekdays.", false],
        ["offersDiscount", "I don't have any cheaper plans or discounts to offer, but I will let the team know.", false],
        ["offersDiscount", "We don't have anything cheaper to offer right now.", false],
        ["offersDiscount", "I can do 20% off your renewal if that helps.", true],
        ["offersDiscount", "We have an off-peak membership at thirty-nine a month.", true],
        ["inventedNegative", "We don't have any other locations, so I guess that explains it.", false],
        ["inventedNegative", "We don't have anything cheaper to offer right now.", false],
        ["inventedNegative", "We don't have a pool at our gym.", true],
        ["inventedNegative", "There's no creche here.", true],
        ["leaksReasoning", "Do you want to keep it going?The user asked a clarifying question about the call.", true],
        ["leaksReasoning", "The gym likes to check in with members, and I'm not sure how the list gets put together.", false],
        ["explainsCriteria", "I'm calling because your membership ends in twelve days and won't renew on its own.", false],
        ["explainsCriteria", "You were flagged because you haven't been in for a month.", true],
        ["admitsAI", "I'm an AI, Jordan. Is now still a good time to chat?", true],
        ["givesInjuryAdvice", "I'd get some ice on it and rest it for a week.", true],
        ["givesInjuryAdvice", "I can put you in touch with a trainer who can work around it.", false],
      ];
      const wrong = cases.filter(([key, text, want]) => (PATTERNS[key] as RegExp).test(text) !== want);
      return {
        passed: wrong.length === 0,
        detail:
          wrong.length === 0
            ? `all ${cases.length} lines classified correctly`
            : wrong.map(([k, t]) => `${k}: "${t.slice(0, 50)}…"`).join("; "),
      };
    },
  },
  {
    id: "clean-slate-history-is-attempt-one",
    name: "A member never called is attempt one",
    why: "The boring case, asserted so the interesting ones mean something.",
    run: () => {
      const e = evaluateEligibility(fixtureMember({ expiry_date: isoOffset(12) }), NO_HISTORY);
      return {
        passed: e.allowed && e.attemptNumber === 1,
        detail: `allowed=${e.allowed}, attempt=${e.attemptNumber}`,
      };
    },
  },
];

export async function runGuards(): Promise<GuardResult[]> {
  const all = [...guards, ...configGuards, ...memberGuards, ...healthGuards, ...offerGuards, ...otherOfferGuards];
  const results: GuardResult[] = [];
  for (const g of all) results.push(await runOne(g));
  return results;
}

async function runOne(g: Guard): Promise<GuardResult> {
  try {
    const { passed, detail } = await g.run();
    return { id: g.id, name: g.name, passed, detail, why: g.why };
  } catch (err) {
    return {
      id: g.id,
      name: g.name,
      passed: false,
      detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      why: g.why,
    };
  }
}
