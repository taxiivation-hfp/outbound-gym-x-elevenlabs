/**
 * The overview: gym health, why members leave, and the call programme — the
 * approved Analytics mockup, laid out in its "sections" arrangement, with every
 * number read from `composeIntelligence` (lib/intelligence.ts).
 *
 * Rendered without the app shell and without any navigation hook, so the
 * guards can render it from data alone (with no calls, with too few reasons to
 * summarise, and with enough). app/intelligence/page.tsx puts it in the shell.
 *
 * What the mockup had and this doesn't, on purpose: period-over-period deltas,
 * the "Agent live" pill and clock, the quietest-hour note, per-theme quotes and
 * trends, and reasons over time — none of them is computed in lib.
 */
import { Notice, SectionHead } from "@/components/intelligence/Card";
import {
  Commitments,
  FollowUps,
  LiveCriteria,
  Outcomes,
  Sentiment,
  TodaysQueue,
} from "@/components/intelligence/CallProgramme";
import { plural } from "@/components/intelligence/format";
import {
  BusyHeatmap,
  ChurnTrend,
  KpiStrip,
  RevenueAtRisk,
  Segments,
  TermsEnding,
  VisitsTrend,
} from "@/components/intelligence/GymHealth";
import ReasonThemes from "@/components/intelligence/ReasonThemes";
import { Quotes, ReasonBreakdown, ReasonCrossTables, hasReasons } from "@/components/intelligence/WhyTheyLeave";
import type { Intelligence } from "@/lib/intelligence";

export default function IntelligenceView({ data }: { data: Intelligence }) {
  const health = data.health;
  const reasons = hasReasons(data);
  const wide = "col-span-2";
  const board = "grid grid-cols-2 items-stretch gap-3.5 min-[1360px]:grid-cols-4";

  return (
    <div className="flex flex-col gap-3.5 pb-6">
      {data.db_error && (
        <Notice>
          <strong className="text-flag-ink">Call records couldn&apos;t be read,</strong> so reasons, outcomes, offers, sentiment, guardrails,
          expected visits and follow-ups below are empty. Check the Supabase connection. ({data.db_error})
        </Notice>
      )}

      <div className={board}>
        <SectionHead title="Gym health" sub="membership, revenue and use" />
        {health.members_error && (
          <Notice className="col-span-full">
            <strong className="text-flag-ink">Members couldn&apos;t be read,</strong> so nothing here is counted. ({health.members_error})
          </Notice>
        )}
        {!health.membership && !health.members_error && (
          <p className="col-span-full text-[12.5px] text-dim">
            No members yet. Import them in Setup to see Active members, churn and retention.
          </p>
        )}
        <KpiStrip health={health} />
        <BusyHeatmap health={health} className={`${wide} min-[1360px]:col-span-3`} />
        <Segments health={health} />
        {health.membership && <ChurnTrend membership={health.membership} />}
        <VisitsTrend health={health} />
        {health.membership && <TermsEnding membership={health.membership} />}
        <RevenueAtRisk health={health} />
      </div>

      <div className={board}>
        <SectionHead
          title="Why members leave"
          sub={`${plural(data.calls.with_a_stated_reason, "stated reason")} from ${plural(data.calls.conversations, "conversation")} · all calls`}
        />
        <ReasonThemes themes={data.why_they_leave.themes} className={wide} />
        <ReasonBreakdown data={data} className={wide} />
        {reasons && (
          <>
            <ReasonCrossTables data={data} />
            <Quotes data={data} />
          </>
        )}
      </div>

      <div className={board}>
        <SectionHead title="Call programme" sub="what the agent did and what it costs" />
        <Outcomes data={data} className={wide} />
        <Sentiment data={data} />
        <LiveCriteria data={data} />
        <TodaysQueue data={data} className={wide} />
        <Commitments data={data} />
        <FollowUps data={data} />
      </div>
    </div>
  );
}
