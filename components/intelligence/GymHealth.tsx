/**
 * PLACEHOLDER UI — pass one. Correct data, plain layout, no design investment.
 * Pass three replaces this component wholesale from the HTML mockups; don't
 * polish it. The numbers come from `composeIntelligence` (lib/intelligence.ts),
 * which the page and /api/intelligence share.
 */
import type { Intelligence } from "@/lib/intelligence";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-white">{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-amber-300">{children}</p>;
}

export function MembershipAndMoney({ health }: { health: Intelligence["health"] }) {
  const m = health.membership;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Membership and money</h2>
      {health.members_error && <Note>Members couldn&apos;t be read, so nothing here is counted: {health.members_error}</Note>}
      {!m ? (
        !health.members_error && <p className="mt-2 text-sm text-zinc-500">No members yet.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Active members" value={String(m.active)} note={`${m.auto_renewing_active} on auto-renew`} />
            <Stat label="MRR" value={money(m.mrr)} note="monthly fee, active members" />
            <Stat label="ARPM" value={m.arpm === null ? "—" : `$${m.arpm.toFixed(2)}`} note="MRR ÷ active members" />
            <Stat
              label="90-day retention"
              value={percent(m.ninety_day.rate)}
              note={`${m.ninety_day.retained} of ${m.ninety_day.measured} who joined ${m.ninety_day.joined_from} to ${m.ninety_day.joined_to} still paying at day 120`}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold text-zinc-300">Fixed terms ending</h3>
          <p className="text-xs text-zinc-500">Live fixed-term memberships only. Auto-renewing memberships roll over and aren&apos;t counted.</p>
          <div className="mt-2 grid grid-cols-3 gap-3 sm:max-w-md">
            <Stat label="Next 14 days" value={String(m.expiring.within_14)} />
            <Stat label="Next 30 days" value={String(m.expiring.within_30)} />
            <Stat label="Next 90 days" value={String(m.expiring.within_90)} />
          </div>

          <h3 className="mt-5 text-sm font-semibold text-zinc-300">Churn and retention by month</h3>
          <p className="text-xs text-zinc-500">
            Churn is members lost in the month ÷ members at its start. A member is lost on the last day their term ran. Members
            who left before the data begins can&apos;t be counted.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="pr-6 font-normal">Month</th>
                  <th className="pr-6 font-normal">Members at start</th>
                  <th className="pr-6 font-normal">Lost</th>
                  <th className="pr-6 font-normal">Churn</th>
                  <th className="pr-6 font-normal">Retention</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-zinc-300">
                {m.months.map((row) => (
                  <tr key={row.month}>
                    <td className="pr-6">
                      {row.month}
                      {row.to_date ? " (to date)" : ""}
                    </td>
                    <td className="pr-6">{row.members_at_start}</td>
                    <td className="pr-6">{row.lost}</td>
                    <td className="pr-6">{percent(row.churn_rate)}</td>
                    <td className="pr-6">{percent(row.retention_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mt-5 text-sm font-semibold text-zinc-300">Revenue in each call queue</h3>
      <p className="text-xs text-zinc-500">
        Monthly fees of the members due each call today, by the same eligibility the queue uses. Winback is what lapsed members
        used to pay.
      </p>
      {health.history_error && <Note>Call history couldn&apos;t be read, so do-not-contact and cooldowns aren&apos;t applied to these: {health.history_error}</Note>}
      <div className="mt-2 grid grid-cols-3 gap-3 sm:max-w-xl">
        {(["renewal", "reengagement", "winback"] as const).map((type) => (
          <Stat
            key={type}
            label={type === "renewal" ? "Renewal" : type === "reengagement" ? "Reengagement" : "Winback"}
            value={`${money(health.revenue_at_risk[type].monthly_fees)}/mo`}
            note={`${health.revenue_at_risk[type].members} members`}
          />
        ))}
      </div>
    </section>
  );
}

export function Engagement({ health }: { health: Intelligence["health"] }) {
  const s = health.segments;
  const maxHour = health.busyness ? Math.max(1, ...health.busyness.by_hour.flat()) : 1;
  const openHours = health.busyness
    ? health.busyness.hour_totals.map((total, hour) => ({ total, hour })).filter((h) => h.total > 0).map((h) => h.hour)
    : [];
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">Engagement</h2>

      <h3 className="mt-3 text-sm font-semibold text-zinc-300">How often active members come in</h3>
      <p className="text-xs text-zinc-500">
        Cut at the router&apos;s own thresholds: away {s.thresholds.absence_days}+ days is inactive, and {s.thresholds.habit_min_rate}+
        visits a week before the last four weeks is a habit.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Frequent" value={String(s.frequent)} note="coming in, had a habit" />
        <Stat label="Occasional" value={String(s.occasional)} note="coming in, below the habit rate" />
        <Stat label="Inactive, had a habit" value={String(s.inactive_after_habit)} note="who reengagement is for" />
        <Stat label="Inactive, never regular" value={String(s.inactive_never_regular)} />
      </div>

      {health.activity_notice && <Note>{health.activity_notice}</Note>}

      {health.attendance && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-zinc-300">Visits per member per week</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="pr-6 font-normal">Week from</th>
                  <th className="pr-6 font-normal">Visits</th>
                  <th className="pr-6 font-normal">Members</th>
                  <th className="pr-6 font-normal">Per member</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-zinc-300">
                {health.attendance.map((w) => (
                  <tr key={w.week_start}>
                    <td className="pr-6">{w.week_start}</td>
                    <td className="pr-6">{w.visits}</td>
                    <td className="pr-6">{w.members}</td>
                    <td className="pr-6">{w.per_member === null ? "—" : w.per_member.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {health.busyness && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-zinc-300">When it&apos;s busy</h3>
          <p className="text-xs text-zinc-500">
            Check-ins by weekday and hour over the last {health.busyness.weeks} weeks.
            {health.busyness.busiest.length > 0 &&
              ` Busiest: ${health.busyness.busiest.map((c) => `${WEEKDAYS[c.weekday]} ${hourLabel(c.hour)} (${c.visits})`).join(", ")}.`}
          </p>
          {openHours.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No check-ins in that window.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs tabular-nums">
                <thead>
                  <tr className="text-zinc-500">
                    <th />
                    {openHours.map((h) => (
                      <th key={h} className="px-1 font-normal">
                        {hourLabel(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {health.busyness.by_hour.map((day, d) => (
                    <tr key={d}>
                      <td className="pr-2 text-zinc-500">{WEEKDAYS[d]}</td>
                      {openHours.map((h) => (
                        <td
                          key={h}
                          className="px-1 text-center text-zinc-200"
                          style={{ backgroundColor: `rgba(214,255,61,${(day[h] / maxHour) * 0.6})` }}
                        >
                          {day[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
