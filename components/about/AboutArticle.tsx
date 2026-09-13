import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CALL_TYPE_TINT, longDate } from "@/components/calls/format";
import { ABOUT_CALL_TYPES, CALL_TYPE_WHAT, COMMITMENTS, TEAM, numberWord, plural } from "@/components/about/copy";
import { LATEST_RUN_AT, evidenceFor, type Evidence } from "@/components/about/evidence";
import { callTypeLabel } from "@/lib/labels";

/**
 * The About article. Static prose, except that every number in it is handed in
 * by the page from `buildQueueView()` — the queue counts and the campaign
 * economics — or read from the committed eval run. Nothing is typed in here.
 */

export interface AboutFacts {
  total: number;
  /** Auto-renewers the router refuses: `counts.excluded_auto_renew`. */
  neverCalled: number;
  /** Auto-renewers with a cancellation request, who route to the one cancellation call. */
  autoRenewAskedToCancel: number;
  /** Refused auto-renewers whose rollover is inside a fortnight. */
  nearRollover: number;
  blocked: {
    auto_renew: number;
    do_not_contact: number;
    nothing_to_offer: number;
    cooldown: number;
    max_attempts: number;
    not_due: number;
  };
  economics: {
    calls: number;
    cost_per_call: number;
    average_retained_value: number;
    break_even_conversion: number;
    retained_months: number;
  };
  historyError: string | null;
}

// The shared rhythm of the mockup: dim uppercase kicker, Archivo headings, 15.5px body.
function Kicker({ children }: { children: ReactNode }) {
  return <span className="mb-[9px] block text-[10.5px] font-bold uppercase tracking-[0.14em] text-dim">{children}</span>;
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 mb-3.5 text-balance font-display text-[23px] font-bold tracking-[-0.025em] text-ink">{children}</h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-[18px] text-pretty text-[15.5px] leading-[1.72] text-ink-2">{children}</p>;
}

function Rule() {
  return <hr className="my-[38px] h-0.5 w-16 border-none bg-line-strong" />;
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-ink">{children}</span>;
}

function money(n: number, places = 0): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
}

/** Two significant figures, as a percentage: 0.000841 → "0.084%". */
function percent(fraction: number): string {
  return `${Number((fraction * 100).toPrecision(2))}%`;
}

function SeeTheRun() {
  return (
    <Link href="/our-journey" className="font-semibold text-accent-ink hover:text-ink hover:underline">
      See the run
    </Link>
  );
}

function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const { checks, missing } = evidence;
  // A check named for this rule that the run file doesn't contain is said out
  // loud, never dropped from the count: a renamed scenario must not quietly
  // turn "0 of 1 passed" into "no eval checks it yet".
  const missingNote =
    missing.length > 0
      ? `${plural(missing.length, "check", "checks")} named for this rule ${missing.length === 1 ? "is" : "are"} not in the latest run (${missing.join(", ")}).`
      : null;

  if (checks.length === 0) {
    if (missingNote) {
      return (
        <span className="text-flag-ink">
          {missingNote} <SeeTheRun />
        </span>
      );
    }
    return <span className="text-dim">In the prompt. No eval checks it yet.</span>;
  }
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed);
  const noun = checks.length === 1 ? "check" : "checks";
  if (failed.length === 0 && !missingNote) {
    return (
      <span className="text-dim">
        Latest run: {passed} of {checks.length} {noun} passed.
      </span>
    );
  }
  if (failed.length === 0) {
    return (
      <span className="text-flag-ink">
        Latest run: {passed} of {checks.length} {noun} passed. {missingNote} <SeeTheRun />
      </span>
    );
  }
  return (
    <span className="text-flag-ink">
      Latest run: {passed} of {checks.length} {noun} passed.{missingNote ? ` ${missingNote}` : ""}{" "}
      {failed.map((c, i) => (
        <span key={c.id}>
          {i > 0 ? " " : ""}
          {c.inconclusive ? `Inconclusive: ${c.name} — the call was cut off mid-turn.` : `Failed: ${c.name}`}
          {c.inconclusive ? "" : c.judgeOnly ? " — every regex check passed; the judge failed it." : "."}
        </span>
      ))}{" "}
      <SeeTheRun />
    </span>
  );
}

export default function AboutArticle({ facts }: { facts: AboutFacts }) {
  const { economics: eco, blocked } = facts;
  const cents = Math.round(eco.cost_per_call * 100);
  const hasQueue = eco.calls > 0 && eco.average_retained_value > 0;
  // One save in N calls is break-even read the other way up, rounded to the nearest ten for prose.
  const callsPerSave = hasQueue && eco.break_even_conversion > 0 ? Math.round(1 / eco.break_even_conversion / 10) * 10 : 0;

  const reasons: Array<[number, string]> = [
    [blocked.auto_renew, "on an auto-renewing contract"],
    [blocked.do_not_contact, "asked us to stop"],
    [blocked.nothing_to_offer, "asked to cancel at a gym with nothing to offer them"],
    [blocked.cooldown, "cooling off after a conversation that changed nothing, or waiting a week to redial a call nobody answered"],
    [blocked.max_attempts, "at the attempt limit"],
    [blocked.not_due, "simply not due anything today"],
  ];

  return (
    <article className="flex w-full min-w-[420px] max-w-[820px] flex-col rounded-[18px] border border-line bg-surface px-10 pb-10 pt-8 shadow-window">
      {facts.historyError && (
        <p className="m-0 mb-6 rounded-[10px] border border-line bg-flag-wash px-3.5 py-2.5 text-[13px] leading-relaxed text-flag-ink">
          Call history couldn’t be read, so every count and figure on this page ignores it. Check the Supabase settings
          and reload.
        </p>
      )}
      <Kicker>Why we built this</Kicker>
      <h2 className="m-0 mb-5 max-w-[24ch] text-balance font-display text-[38px] font-bold leading-[1.1] tracking-[-0.04em]">
        The call you shouldn’t make
      </h2>

      <p className="m-0 mb-5 text-pretty text-[17px] leading-[1.65] text-muted">
        Plenty of gyms are big enough to have churn and too small to have anyone act on it: no retention team, no
        marketing hire, nothing beyond the management platform. The front desk can already see who has stopped coming
        and whose term is about to end. Nobody rings them, because ringing tens of people a day is not a job anyone at the
        front desk has time for.
      </p>
      <P>
        So we started where anyone would: automate the calls. Then we looked hard at who those calls would reach, and
        found the part nobody wants to say out loud.
      </P>

      <Rule />

      <Kicker>What everyone builds</Kicker>
      <H3>Two halves of the same assumption</H3>
      <P>
        One half of the market predicts. Keepme Score, PredictStay and Glofox’s At Risk report score every member’s
        chance of leaving from attendance and payment data. They tell a gym who is likely to go. None of them asks whether
        getting in touch is the right move.
      </P>
      <P>
        The other half executes. Replify runs outbound retention calls; Keepme’s Antares runs text, chat and email
        follow-up. Both reach out to whoever the predictor flags. Neither has a reason to say no.
      </P>
      <P>
        Both halves assume contact is neutral — that the worst a call can do is nothing. Point either at the member data
        behind today’s queue and they would ring the <Num>{facts.neverCalled}</Num> auto-renewing members this product
        never calls, hardest at the <Num>{facts.nearRollover}</Num> of them whose renewal date is inside a fortnight.
      </P>

      <Rule />

      <Kicker>What we found</Kicker>
      <H3>A call is not free</H3>
      <P>
        Phoning someone who has drifted reminds them they are paying for something they are not using. For a member on a
        fixed term that is about to lapse, that reminder is the point. For a member on a rolling contract who has stopped
        coming, it can be the reminder that ends the membership: they pay full price, take up no capacity, and the call
        risks being what makes them remember to cancel. Uplift research calls these members sleeping dogs.
      </P>

      <p className="my-[26px] text-balance font-display text-[25px] font-semibold leading-[1.35] tracking-[-0.025em] text-accent-ink">
        So the first thing it decides is not who is about to leave. It is who you would lose by getting in touch — and
        then it leaves them alone.
      </p>

      <P>
        In the member data behind today’s queue, that is <Num>{facts.neverCalled}</Num> of{" "}
        <Num>{facts.total}</Num> members who are never called. Not deferred, not queued for later, not tried once to see
        what happens.{" "}
        {facts.autoRenewAskedToCancel > 0 ? (
          <>
            The only thing that lifts the rule is the member’s own request:{" "}
            <Num>{facts.autoRenewAskedToCancel.toLocaleString("en-AU")}</Num>{" "}
            {facts.autoRenewAskedToCancel === 1 ? "auto-renewer has" : "auto-renewers have"} asked to cancel, and each
            can get at most one call about it — and only if the gym has a freeze or a cheaper plan to put on the table.
          </>
        ) : (
          <>
            The only thing that lifts the rule is the member’s own request to cancel, which earns at most one call about
            it — and only if the gym has a freeze or a cheaper plan to put on the table. No auto-renewer in this data has
            asked.
          </>
        )}
      </P>
      <P>
        Everyone the agent won’t dial today stays in the queue, below the members who are due, grouped under the reason
        that holds them back:{" "}
        {reasons.map(([n, label], i) => (
          <span key={label}>
            {i === reasons.length - 1 ? "or " : ""}
            {label} (<Num>{n}</Num>){i === reasons.length - 1 ? "." : ", "}
          </span>
        ))}{" "}
        A manager can see exactly who is being left alone, and why.
      </P>
      <P>That is the whole product, really. Everything below this is in service of it.</P>

      <Rule />

      <Kicker>How it works</Kicker>
      <H3>{numberWord(ABOUT_CALL_TYPES.length, true)} conversations, not one</H3>
      <P>
        A member whose term ends next week and a member whose membership ended months ago need nothing in common from a
        phone call, so they don’t share an agent. There are {numberWord(ABOUT_CALL_TYPES.length)}, and each only knows
        what it needs to.
      </P>
      <dl className="m-0 mb-[18px]">
        {ABOUT_CALL_TYPES.map((type) => (
          <div key={type} className="grid grid-cols-[150px_minmax(0,1fr)] gap-[18px] border-t border-row-line py-3">
            <dt className={`text-[13px] font-bold uppercase tracking-[0.08em] ${CALL_TYPE_TINT[type].ink}`}>
              {callTypeLabel[type]}
            </dt>
            <dd className="m-0 text-pretty text-[14.5px] leading-[1.6] text-ink-2">{CALL_TYPE_WHAT[type]}</dd>
          </div>
        ))}
      </dl>
      <P>
        Each gym types in its facts and what it actually offers — the renewal discount, the cheaper plan, the freeze —
        and every sentence the agent reads about an offer is compiled from those fields, then checked against them. No
        model writes that text. A blank field means the gym didn’t say, which is not the same as no. Each agent’s prompt
        serves every gym; what changes is the facts and the offers.
      </P>

      <Rule />

      <Kicker>The arithmetic</Kicker>
      <H3>{numberWord(cents, true)} cents</H3>
      {hasQueue ? (
        <P>
          A call costs <Num>{money(eco.cost_per_call, 2)}</Num>. A saved member is worth <Num>{money(eco.average_retained_value)}</Num>{" "}
          to the gym — {numberWord(eco.retained_months)} more months of fees, averaged over the{" "}
          {plural(eco.calls, "member", "members")} due a call today. Break-even is <Num>{percent(eco.break_even_conversion)}</Num>{" "}
          — one save in roughly <Num>{callsPerSave.toLocaleString("en-AU")}</Num> calls, a bar so low it is almost
          embarrassing to state.
        </P>
      ) : (
        <P>
          A call costs <Num>{money(eco.cost_per_call, 2)}</Num>. Nobody is due a call today, so there is no queue to
          average a saved member’s value over, and no break-even to state.
        </P>
      )}
      <P>
        That is exactly why the restraint has to be built in rather than left to judgement. When calling is this cheap,
        nothing in the economics will ever stop you calling everybody. The only discipline left is the decision not to,
        and it has to live in the product, because it will not survive a quarterly target.
      </P>

      <Rule />

      <Kicker>What it will not do</Kicker>
      <H3>{numberWord(COMMITMENTS.length, true)} things, not configurable</H3>
      <P>
        These are not switches a gym can turn off. They are written into the agents’ prompts, and beside each is what the
        latest committed eval run, from {longDate(LATEST_RUN_AT)}, found.
      </P>
      <ul className="m-0 mb-[18px] list-none p-0">
        {COMMITMENTS.map((c) => (
          <li
            key={c.text}
            className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 border-t border-row-line py-2.5 text-pretty text-[14.5px] leading-[1.6] text-ink-2"
          >
            <span aria-hidden="true" className="text-dim">
              —
            </span>
            <span className="flex flex-col gap-1">
              <span>{c.text}</span>
              <span className="text-[12.5px] leading-normal">
                <span className="text-faint">{c.source}. </span>
                <EvidenceLine evidence={evidenceFor(c)} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <P>
        The last one matters most. A retention product that quietly makes leaving harder will always look like it is
        working.
      </P>

      <Rule />

      <Kicker>Who we are</Kicker>
      <H3>{numberWord(TEAM.length, true)} of us</H3>
      <P>
        Everything above is in the repository — the router, the prompts and every eval run — so none of it has to be
        taken on our word.
      </P>
      <div className="mt-2 flex flex-wrap gap-[26px]">
        {TEAM.map((p) => (
          <div key={p.name} className="flex items-center gap-3">
            <Image
              src={p.src}
              alt={p.name}
              width={52}
              height={52}
              className="size-[52px] rounded-full border border-line bg-control object-cover object-top"
            />
            <span className="whitespace-nowrap text-[14px] font-bold tracking-[-0.01em]">{p.name}</span>
          </div>
        ))}
      </div>

      <div className="mt-9 flex flex-wrap gap-3 border-t border-line pt-6">
        <Link
          href="/our-journey"
          className="flex h-9 items-center rounded-[10px] border border-line bg-control px-[15px] text-[13px] font-bold text-ink no-underline transition-colors hover:border-accent-line"
        >
          Our Journey: every run, including the bad ones
        </Link>
        <Link
          href="/"
          className="flex h-9 items-center rounded-[10px] border border-control-line bg-transparent px-[15px] text-[13px] font-bold text-muted no-underline transition-colors hover:text-ink"
        >
          See today’s queue
        </Link>
      </div>
    </article>
  );
}
