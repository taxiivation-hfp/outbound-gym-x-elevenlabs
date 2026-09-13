import type { CallType } from "@/lib/callType";
import type { CallOutcome, Cohort } from "@/lib/types";

/**
 * Display vocabulary, in one place.
 *
 * The ten outcome values, three call types and five cohorts are rendered in
 * several views. Keeping the labels and the badge styles here means adding an
 * outcome is one edit, and means the dashboard cannot show one member's call as
 * "Rebooked" in a table and "booked" in a panel.
 */

type Outcome = NonNullable<CallOutcome>;

export const outcomeLabel: Record<Outcome, string> = {
  renewed: "Renewed",
  link_sent: "Link sent",
  booked: "Booked in",
  will_return: "Will return",
  callback_requested: "Callback asked for",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
  bad_time: "Bad time",
  wrong_number: "Wrong number",
  no_answer: "No answer",
};

/**
 * Three tiers, deliberately: a win, a maybe, a close. Lime is the win colour
 * throughout the dashboard; red stays reserved for a call that failed, which is
 * a fault rather than an answer.
 */
export const outcomeStyle: Record<Outcome, string> = {
  renewed: "border-transparent bg-[#D6FF3D] text-black",
  booked: "border-transparent bg-[#D6FF3D] text-black",
  link_sent: "border-lime-700 bg-lime-950/40 text-lime-300",
  will_return: "border-lime-700 bg-lime-950/40 text-lime-300",
  callback_requested: "border-cyan-700 bg-cyan-950/40 text-cyan-300",
  bad_time: "border-cyan-700 bg-cyan-950/40 text-cyan-300",
  not_interested: "border-zinc-700 bg-zinc-900 text-zinc-400",
  no_answer: "border-zinc-700 bg-zinc-900 text-zinc-400",
  wrong_number: "border-zinc-700 bg-zinc-900 text-zinc-400",
  do_not_contact: "border-amber-700 bg-amber-950/40 text-amber-300",
};

/** Outcomes that mean the call did its job. Used by the value panel. */
export const WINNING_OUTCOMES: Outcome[] = ["renewed", "booked", "link_sent", "will_return"];

export const callTypeLabel: Record<CallType, string> = {
  renewal: "Renewal",
  reengagement: "Reengagement",
  winback: "Winback",
  cancellation: "Cancellation",
};

/** One line each, for the column headers — what this call is actually for. */
export const callTypeBlurb: Record<CallType, string> = {
  renewal: "Still training, fixed term about to lapse. Make sure they know it won't renew itself.",
  reengagement: "Membership still live, stopped coming. Get them back in the door once.",
  winback: "Membership already ended. Find out why they stopped.",
  cancellation: "Asked to cancel. One call, one alternative on the table, and the cancellation goes ahead.",
};

export const callTypeStyle: Record<CallType, string> = {
  renewal: "border-[#D6FF3D]/40 bg-[#D6FF3D]/10 text-[#D6FF3D]",
  reengagement: "border-cyan-700/50 bg-cyan-950/40 text-cyan-300",
  winback: "border-violet-700/50 bg-violet-950/40 text-violet-300",
  cancellation: "border-amber-700/50 bg-amber-950/40 text-amber-300",
};

export const cohortLabel: Record<Cohort, string> = {
  winback: "Lapsed",
  sliding: "Sliding",
  new_joiner: "New joiner",
  sleeping_dog: "Dormant",
  steady: "Steady",
};

export const reasonLabel: Record<string, string> = {
  time: "No time",
  money: "Money",
  injury: "Injury",
  motivation: "Lost motivation",
  moved: "Moved away",
  gym_issue: "Something about the gym",
  none_given: "Wouldn't say",
  other: "Other",
};

/** Why a member is not being called. Keys match `Eligibility.blockedBy`. */
export const blockedLabel: Record<string, string> = {
  auto_renew: "Auto-renew — never called",
  do_not_contact: "Asked us to stop",
  cooldown: "Cooling off",
  max_attempts: "Attempt limit reached",
  not_due: "Nothing due today",
  nothing_to_offer: "Asked to cancel — nothing to offer",
};

export function outcomeText(outcome: string | null | undefined): string {
  if (!outcome) return "—";
  return outcomeLabel[outcome as Outcome] ?? outcome;
}

export function outcomeClass(outcome: string | null | undefined): string {
  if (!outcome) return "border-zinc-700 bg-zinc-900 text-zinc-400";
  return outcomeStyle[outcome as Outcome] ?? "border-zinc-700 bg-zinc-900 text-zinc-400";
}
