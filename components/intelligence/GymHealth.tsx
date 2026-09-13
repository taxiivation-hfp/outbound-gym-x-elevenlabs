/**
 * Gym health: the numbers an operator runs their week on — members, money,
 * churn, attendance and when the floor is busy. Every figure is read from
 * `composeIntelligence(...).health` (lib/intelligence.ts → lib/gymHealth.ts),
 * which `/api/intelligence` returns too. Nothing here is compared with a
 * previous period or another gym, because nothing in lib computes that.
 */
import { Card, Empty, Headline, Notice } from "@/components/intelligence/Card";
import { CALL_TYPE_ORDER, CALL_TYPE_TINT } from "@/components/calls/format";
import {
  WEEKDAYS,
  dayMonth,
  hourRange,
  hourTick,
  money,
  moneyCents,
  monthName,
  percent,
  plural,
  share,
} from "@/components/intelligence/format";
import type { CallType } from "@/lib/callType";
import { NINETY_DAY_MARK_DAYS } from "@/lib/gymHealth";
import type { Intelligence } from "@/lib/intelligence";
import { callTypeLabel } from "@/lib/labels";

type Health = Intelligence["health"];
type Membership = NonNullable<Health["membership"]>;

/** The last month counted in full; the month to date is never compared with it. */
export function latestCompleteMonth(membership: Membership) {
  return [...membership.months].reverse().find((m) => !m.to_date) ?? null;
}

// --- KPI strip ------------------------------------------------------------------------

function Kpi({ label, value, sub, title }: { label: string; value: string; sub: string; title?: string }) {
  return (
    <div title={title} className="flex min-w-0 flex-col justify-center gap-[3px] bg-surface px-[18px] py-3.5">
      <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className="font-display text-[30px] font-bold leading-none tracking-[-0.025em] tabular-nums text-ink">{value}</span>
      <span className="truncate text-[11.5px] text-dim">{sub}</span>
    </div>
  );
}

export function KpiStrip({ health }: { health: Health }) {
  const m = health.membership;
  if (!m) return null;
  const month = latestCompleteMonth(m);
  const week = health.attendance?.at(-1) ?? null;
  return (
    <section
      aria-label="Headline figures"
      className="col-span-full grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-soft min-[1360px]:grid-cols-6"
    >
      <Kpi
        label="Active members"
        value={m.active.toLocaleString("en-AU")}
        sub={`${m.auto_renewing_active} auto-renewing · ${m.active - m.auto_renewing_active} fixed-term`}
      />
      <Kpi label="MRR" value={money(m.mrr)} sub="monthly fees, active members" />
      <Kpi label="Revenue / member" value={m.arpm === null ? "—" : moneyCents(m.arpm)} sub="MRR ÷ active members" />
      <Kpi
        label="90-day retention"
        value={percent(m.ninety_day.rate)}
        sub={`${m.ninety_day.retained} retained of ${m.ninety_day.measured} measured joiners`}
        title={`Joiners ${dayMonth(m.ninety_day.joined_from)} ${m.ninety_day.joined_from.slice(0, 4)}–${dayMonth(m.ninety_day.joined_to)} ${m.ninety_day.joined_to.slice(0, 4)} still paying at day ${NINETY_DAY_MARK_DAYS}`}
      />
      <Kpi
        label="Monthly churn"
        value={month ? percent(month.churn_rate) : "—"}
        sub={month ? `${month.lost} of ${month.members_at_start} in ${monthName(month.month)}` : "no complete month yet"}
        title="Members lost in the month ÷ members at its start"
      />
      <Kpi
        label="Visits / member / wk"
        value={week?.per_member == null ? "—" : week.per_member.toFixed(2)}
        sub={week ? `week of ${dayMonth(week.week_start)}` : "no check-in data"}
        title={week ? `${week.visits} visits ÷ ${week.members} members` : undefined}
      />
    </section>
  );
}

// --- When the gym is busy ---------------------------------------------------------------

export function BusyHeatmap({ health, className = "" }: { health: Health; className?: string }) {
  const b = health.busyness;
  if (!b) {
    return (
      <Card lead title="When the gym is busy" className={className}>
        {health.activity_notice ? <Notice>{health.activity_notice}</Notice> : <Empty>No check-in data to plot.</Empty>}
      </Card>
    );
  }
  const open = b.hour_totals.map((t, h) => ({ t, h })).filter((x) => x.t > 0);
  const first = open[0]?.h;
  const last = open.at(-1)?.h;
  const hours = first === undefined || last === undefined ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(1, ...b.by_hour.flat());
  const peak = new Set(b.busiest.map((c) => `${c.weekday}-${c.hour}`));
  const cols = `36px minmax(0,1fr) 50px`;
  const cellCols = { gridTemplateColumns: `repeat(${hours.length},minmax(0,1fr))` };

  return (
    <Card lead title="When the gym is busy" sub={`visits by weekday and hour · last ${b.weeks} weeks`} className={className}>
      {health.activity_notice && <Notice className="mb-3">{health.activity_notice}</Notice>}
      {hours.length === 0 ? (
        <Empty>No check-ins in the last {b.weeks} weeks.</Empty>
      ) : (
        <div role="table" aria-label="Visits by weekday and hour" className="flex min-w-0 flex-col gap-[3px]">
          <div role="row" className="grid items-center gap-2.5" style={{ gridTemplateColumns: cols }}>
            <span />
            <div className="grid gap-0.5 text-[9.5px] font-semibold text-dim" style={cellCols}>
              {hours.map((h, i) => (
                <span key={h} role="columnheader" aria-label={hourRange(h)} className="text-center">
                  {i % 3 === 0 ? hourTick(h) : ""}
                </span>
              ))}
            </div>
            <span className="text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-dim" title={`Visits across the ${b.weeks} weeks`}>
              Total
            </span>
          </div>
          {b.by_hour.map((day, d) => (
            <div role="row" key={d} className="grid items-center gap-2.5" style={{ gridTemplateColumns: cols }}>
              <span role="rowheader" className="text-[11px] font-bold text-dim">
                {WEEKDAYS[d]}
              </span>
              <div className="grid gap-0.5" style={cellCols}>
                {hours.map((h) => {
                  const v = day[h];
                  const alpha = 0.035 + Math.pow(v / max, 1.45) * 0.95;
                  const isPeak = peak.has(`${d}-${h}`);
                  return (
                    <div
                      key={h}
                      role="cell"
                      title={`${WEEKDAYS[d]} ${hourRange(h)} · ${plural(v, "visit")}`}
                      aria-label={`${WEEKDAYS[d]} ${hourRange(h)}: ${plural(v, "visit")}`}
                      className="h-[21px] rounded-[3px]"
                      style={{
                        background: `rgba(var(--heat), ${alpha.toFixed(3)})`,
                        boxShadow: isPeak ? "0 0 0 1.5px var(--accent-ink)" : undefined,
                      }}
                    />
                  );
                })}
              </div>
              <span role="cell" className="text-right text-[12px] font-semibold tabular-nums text-ink-2">
                {day.reduce((n, v) => n + v, 0).toLocaleString("en-AU")}
              </span>
            </div>
          ))}
          <div className="mt-[9px] flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-line pt-2.5">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="text-[10.5px] text-dim">quiet</span>
              {[0.08, 0.3, 0.52, 0.74, 0.96].map((a) => (
                <span key={a} className="h-[9px] w-4 rounded-[2px]" style={{ background: `rgba(var(--heat), ${a})` }} />
              ))}
              <span className="text-[10.5px] text-dim">busy</span>
            </div>
            {b.busiest.length > 0 && (
              <span className="text-[12px] text-ink-2">
                <span className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px] shadow-[0_0_0_1.5px_var(--accent-ink)]" aria-hidden="true" />
                Busiest: {b.busiest.map((c) => `${WEEKDAYS[c.weekday]} ${hourRange(c.hour)} (${c.visits})`).join(" · ")}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Monthly churn ------------------------------------------------------------------------

export function ChurnTrend({ membership }: { membership: Membership }) {
  const complete = membership.months.filter((m) => !m.to_date && m.churn_rate !== null);
  const toDate = membership.months.find((m) => m.to_date) ?? null;
  const latest = complete.at(-1) ?? null;

  const W = 300;
  const H = 108;
  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 22;
  const rates = complete.map((m) => (m.churn_rate as number) * 100);
  // The axis is labelled with its own range, so it can hug the data honestly.
  const lo = rates.length ? Math.max(0, Math.floor(Math.min(...rates) * 2) / 2 - 0.5) : 0;
  const hi = rates.length ? Math.ceil(Math.max(...rates) * 2) / 2 + 0.5 : 1;
  const x = (i: number) => PAD_L + (complete.length > 1 ? (i * (W - PAD_L - PAD_R)) / (complete.length - 1) : 0);
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * (H - PAD_T - PAD_B);
  const points = rates.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <Card title="Monthly churn" sub={`${complete.length} complete months`}>
      <Headline
        value={latest ? percent(latest.churn_rate) : "—"}
        note={latest ? `${latest.lost} of ${latest.members_at_start} in ${monthName(latest.month)}` : undefined}
      />
      {complete.length < 2 ? (
        <Empty>Two complete months are needed to draw a line.</Empty>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Monthly churn, ${complete.map((m) => `${monthName(m.month, "short")} ${percent(m.churn_rate)}`).join(", ")}`}>
            {[hi, lo].map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
                <text x={PAD_L - 5} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--dim)">
                  {v.toFixed(1)}%
                </text>
              </g>
            ))}
            <polygon points={`${x(0)},${y(lo)} ${points} ${x(rates.length - 1)},${y(lo)}`} fill="var(--accent-wash)" />
            <polyline points={points} fill="none" stroke="var(--bar)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {complete.map((m, i) => (
              <circle key={m.month} cx={x(i)} cy={y(rates[i])} r={i === complete.length - 1 ? 4 : 2.5} fill="var(--bar)" stroke="var(--surface)" strokeWidth="1.5">
                <title>{`${monthName(m.month)}: ${m.lost} of ${m.members_at_start} lost, ${percent(m.churn_rate)}`}</title>
              </circle>
            ))}
            {complete.map((m, i) => (
              <text key={m.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--dim)">
                {monthName(m.month, "short")}
              </text>
            ))}
          </svg>
        </>
      )}
      {toDate && (
        <p className="mt-auto pt-2.5 text-[11.5px] leading-snug text-dim" title="Counted to date, so not plotted beside full months">
          {monthName(toDate.month)} so far: {toDate.lost} of {toDate.members_at_start} lost. Not plotted until the month ends.
        </p>
      )}
    </Card>
  );
}

// --- Visits per member per week ------------------------------------------------------------

export function VisitsTrend({ health }: { health: Health }) {
  const weeks = health.attendance ?? [];
  const latest = weeks.at(-1) ?? null;
  const max = Math.max(0, ...weeks.map((w) => w.per_member ?? 0));
  return (
    <Card title="Visits / member / week" sub={weeks.length ? `last ${weeks.length} weeks` : undefined}>
      {!health.attendance ? (
        health.activity_notice ? <Notice>{health.activity_notice}</Notice> : <Empty>No check-in data to plot.</Empty>
      ) : (
        <>
          <Headline
            value={latest?.per_member == null ? "—" : latest.per_member.toFixed(2)}
            note={latest ? `week of ${dayMonth(latest.week_start)}` : undefined}
          />
          <div className="flex min-h-[92px] flex-1 items-end gap-[3px]" role="list" aria-label="Visits per member, week by week">
            {weeks.map((w, i) => {
              const last = i === weeks.length - 1;
              return (
                <div
                  key={w.week_start}
                  role="listitem"
                  title={`Week of ${dayMonth(w.week_start)}: ${w.visits} visits ÷ ${w.members} members = ${w.per_member == null ? "—" : w.per_member.toFixed(2)}`}
                  className={`min-h-[3px] flex-1 rounded-t-[4px] rounded-b-[2px] ${last ? "bg-bar" : "bg-off-ink"}`}
                  style={{ height: `${max > 0 ? ((w.per_member ?? 0) / max) * 92 : 0}px` }}
                />
              );
            })}
          </div>
          {weeks.length > 0 && (
            <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-dim">
              <span>{dayMonth(weeks[0].week_start)}</span>
              <span>{dayMonth(weeks[weeks.length - 1].week_start)}</span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// --- How members use the gym -------------------------------------------------------------------

export function Segments({ health }: { health: Health }) {
  const s = health.segments;
  const rows = [
    { key: "frequent", label: "Frequent", n: s.frequent, color: "bg-bar", title: `In within ${s.thresholds.absence_days} days; ${s.thresholds.habit_min_rate}+ weekly visits before last four weeks` },
    { key: "occasional", label: "Occasional", n: s.occasional, color: "bg-reeng-ink", title: `In within ${s.thresholds.absence_days} days, below the habit rate` },
    { key: "after", label: "Inactive after a habit", n: s.inactive_after_habit, color: "bg-winb-ink", title: "Who the reengagement call is for" },
    { key: "never", label: "Inactive, never regular", n: s.inactive_never_regular, color: "bg-off-ink", title: `Away ${s.thresholds.absence_days}+ days, never had the habit` },
  ];
  return (
    <Card title="How members use the gym" sub={`${s.total} active`}>
      {s.total === 0 ? (
        <Empty>No active members.</Empty>
      ) : (
        <>
          <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-[4px]" aria-hidden="true">
            {rows.map((r) => (r.n > 0 ? <div key={r.key} className={r.color} style={{ width: `${(r.n / s.total) * 100}%` }} /> : null))}
          </div>
          {rows.map((r) => (
            <div key={r.key} title={r.title} className="flex items-center gap-[9px] border-b border-row-line py-[5px]">
              <span aria-hidden="true" className={`h-[9px] w-[9px] flex-none rounded-[3px] ${r.color}`} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.label}</span>
              <span className="text-[12.5px] font-bold tabular-nums text-ink">{r.n}</span>
              <span className="w-[38px] text-right text-[11.5px] tabular-nums text-dim">{share(r.n, s.total)}</span>
            </div>
          ))}
          <p className="mt-auto pt-2.5 text-[11.5px] leading-snug text-dim text-pretty">
            Cut where the router cuts: away {s.thresholds.absence_days}+ days is inactive; {s.thresholds.habit_min_rate}+ visits a week
            before the last four weeks is a habit.
          </p>
        </>
      )}
    </Card>
  );
}

// --- Fixed terms ending ------------------------------------------------------------------------

export function TermsEnding({ membership }: { membership: Membership }) {
  const e = membership.expiring;
  const tiles = [
    { label: "14 days", n: e.within_14 },
    { label: "30 days", n: e.within_30 },
    { label: "90 days", n: e.within_90 },
  ];
  return (
    <Card title="Fixed terms ending" sub="live fixed-term memberships">
      <div className="mb-3 flex gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-1 flex-col gap-1 rounded-[10px] bg-control px-[11px] py-[9px]">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-dim">{t.label}</span>
            <span className="font-display text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{t.n}</span>
            <div className="h-[3px] overflow-hidden rounded-[2px] bg-row-line">
              <div className="h-full rounded-[2px] bg-bar" style={{ width: `${e.within_90 > 0 ? (t.n / e.within_90) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-muted text-pretty">
        {e.within_90 === 0
          ? "No fixed term ends in the next 90 days."
          : `${plural(e.within_90, "fixed term")} end${e.within_90 === 1 ? "s" : ""} within 90 days; ${e.within_14} of them inside two weeks.`}{" "}
        Auto-renewing memberships roll over, so they aren&apos;t counted.
      </p>
    </Card>
  );
}

// --- Revenue at risk -----------------------------------------------------------------------------

const TYPE_BAR: Record<CallType, string> = {
  renewal: "bg-renew-ink",
  reengagement: "bg-reeng-ink",
  winback: "bg-winb-ink",
  cancellation: "bg-flag",
};

const TYPE_NOTE: Record<CallType, string> = {
  cancellation: "still paying, asked to cancel",
  renewal: "still paying, term ending",
  reengagement: "still paying, stopped coming",
  winback: "fees lapsed members used to pay",
};

export function RevenueAtRisk({ health }: { health: Health }) {
  const r = health.revenue_at_risk;
  const max = Math.max(0, ...CALL_TYPE_ORDER.map((t) => r[t].monthly_fees));
  const stillPaying = r.renewal.monthly_fees + r.reengagement.monthly_fees + r.cancellation.monthly_fees;
  return (
    <Card title="Revenue at risk" sub="monthly fees of members due each call">
      {health.history_error && (
        <Notice className="mb-2">Call history couldn&apos;t be read, so cooldowns and do-not-contact aren&apos;t applied here.</Notice>
      )}
      {CALL_TYPE_ORDER.map((type) => (
        <div key={type} className="flex flex-col gap-[5px] py-[5px]" title={TYPE_NOTE[type]}>
          <div className="flex items-baseline gap-2">
            <span className={`flex-1 text-[11px] font-bold uppercase tracking-[0.1em] ${CALL_TYPE_TINT[type].ink}`}>{callTypeLabel[type]}</span>
            <span className="text-[13.5px] font-bold tabular-nums text-ink">{money(r[type].monthly_fees)}</span>
            <span className="w-[74px] text-right text-[11.5px] tabular-nums text-dim">{plural(r[type].members, "member")}</span>
          </div>
          <div className="h-[7px] overflow-hidden rounded-[4px] bg-row-line">
            <div className={`h-full rounded-[4px] ${TYPE_BAR[type]}`} style={{ width: `${max > 0 ? (r[type].monthly_fees / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2.5">
        <div className="flex items-baseline gap-2" title="Renewal, reengagement and cancellation: fees still being paid">
          <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-dim">Still paying</span>
          <span className="font-display text-[20px] font-bold tracking-[-0.02em] tabular-nums text-ink">{money(stillPaying)}/mo</span>
        </div>
        <div className="flex items-baseline gap-2" title="Already lost; a winback call can recover it">
          <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-dim">Lapsed, recoverable</span>
          <span className="text-[13.5px] font-bold tabular-nums text-ink-2">{money(r.winback.monthly_fees)}/mo</span>
        </div>
      </div>
    </Card>
  );
}
