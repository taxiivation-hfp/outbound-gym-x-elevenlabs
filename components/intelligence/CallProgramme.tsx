/**
 * The call programme: how the calls ended, how members sounded, what the
 * agents were scored on, who is expected at the desk, what needs a person, and
 * what today's queue costs against what a saved member is worth.
 *
 * Outcomes, sentiment, offers, commitments, follow-ups and the live criteria
 * are tallies over every completed call on record (`composeIntelligence`).
 * Today's queue is `campaignEconomics` over the members eligible today, with
 * `ASSUMPTIONS` from lib/economics.ts on screen beside the numbers they
 * produce. How often a call works is not assumed anywhere.
 */
import { BarRow, Card, Empty, Headline, Notice } from "@/components/intelligence/Card";
import { CALL_TYPE_ORDER, CALL_TYPE_TINT, dateTime } from "@/components/calls/format";
import { moneyCents, percent, plural, share } from "@/components/intelligence/format";
import type { CallType } from "@/lib/callType";
import type { Intelligence } from "@/lib/intelligence";
import { WINNING_OUTCOMES, callTypeLabel, outcomeText, reasonLabel } from "@/lib/labels";

/** The shared label; an outcome the labels don't know yet is shown as written, capitalised. */
function outcomeName(outcome: string): string {
  const text = outcomeText(outcome);
  return text === outcome ? (outcome.charAt(0).toUpperCase() + outcome.slice(1)).replace(/_/g, " ") : text;
}

export function Outcomes({ data, className = "" }: { data: Intelligence; className?: string }) {
  const entries = Object.entries(data.outcomes.overall).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, c]) => n + c, 0);
  const max = entries[0]?.[1] ?? 0;
  const o = data.offers;
  return (
    <Card title="Call outcomes" sub={`${plural(data.calls.conversations, "conversation")} · all calls`} className={className}>
      {entries.length === 0 ? (
        <Empty>No completed call has recorded an outcome yet.</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-x-[22px]">
          {entries.map(([outcome, n]) => (
            <BarRow
              key={outcome}
              label={outcomeName(outcome)}
              title={outcomeName(outcome)}
              value={n}
              max={max}
              count={n}
              shareText={share(n, total)}
              barClass={(WINNING_OUTCOMES as string[]).includes(outcome) ? "bg-bar" : "bg-off-ink"}
            />
          ))}
        </div>
      )}
      <div className="mt-auto grid grid-cols-3 gap-2.5 pt-3">
        <MiniStat label="Offers made" value={o.made} />
        <MiniStat label="Accepted" value={o.accepted} />
        <MiniStat label="Links texted" value={o.links_sent} />
      </div>
      <p className="pt-2.5 text-[11.5px] text-dim">
        {plural(data.calls.dials, "dial")} · {data.calls.completed} completed · {data.calls.conversations} reached the member ·{" "}
        {data.calls.with_a_stated_reason} gave a reason
      </p>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-control px-[11px] py-[9px]">
      <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-dim">{label}</span>
      <span className="font-display text-[20px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{value}</span>
    </div>
  );
}

const SENTIMENT_ORDER = ["positive", "neutral", "negative"];
const SENTIMENT_COLOR: Record<string, string> = { positive: "bg-bar", neutral: "bg-off-ink", negative: "bg-flag" };

export function Sentiment({ data }: { data: Intelligence }) {
  const entries = Object.entries(data.sentiment).sort((a, b) => {
    const ai = SENTIMENT_ORDER.indexOf(a[0]);
    const bi = SENTIMENT_ORDER.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || b[1] - a[1];
  });
  const total = entries.reduce((n, [, c]) => n + c, 0);
  const positive = data.sentiment.positive ?? 0;
  return (
    <Card title="Sentiment of members called" sub={total ? `${plural(total, "conversation")} rated` : undefined}>
      {total === 0 ? (
        <Empty>No conversation has been rated yet.</Empty>
      ) : (
        <>
          <Headline value={share(positive, total)} note={`positive · ${positive} of ${total}`} />
          <div className="mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-hidden="true">
            {entries.map(([k, n]) => (
              <div key={k} className={SENTIMENT_COLOR[k] ?? "bg-faint"} style={{ width: `${(n / total) * 100}%` }} />
            ))}
          </div>
          {entries.map(([k, n]) => (
            <div key={k} className="flex items-center gap-[9px] py-1">
              <span aria-hidden="true" className={`h-[9px] w-[9px] flex-none rounded-[3px] ${SENTIMENT_COLOR[k] ?? "bg-faint"}`} />
              <span className="flex-1 text-[12.5px] capitalize text-ink-2">{k}</span>
              <span className="text-[12.5px] font-bold tabular-nums text-ink">{share(n, total)}</span>
              <span className="w-[34px] text-right text-[11.5px] tabular-nums text-dim">{n}</span>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

const CRITERIA_LABEL: Record<string, string> = {
  stuck_to_one_ask: "Stuck to one ask",
  invented_nothing: "Invented nothing",
  no_guilt: "No guilt",
};

export function LiveCriteria({ data }: { data: Intelligence }) {
  return (
    <Card
      title="Guardrails on live calls"
      sub={`scored by ElevenLabs after each call · ${plural(data.calls.completed, "completed call")}`}
    >
      <ul className="m-0 flex list-none flex-col p-0">
        {Object.entries(data.live_criteria).map(([name, s]) => {
          const unscored = data.calls.completed - s.scored;
          return (
            <li key={name} className="flex items-center gap-2 border-b border-row-line py-[7px] last:border-b-0">
              <span className="flex-1 text-[12.5px] text-ink-2">{CRITERIA_LABEL[name] ?? name.replace(/_/g, " ")}</span>
              {s.scored === 0 ? (
                <span className="text-[11.5px] text-dim">not scored yet</span>
              ) : (
                <>
                  <span className={`text-[12.5px] font-bold tabular-nums ${s.passed === s.scored ? "text-accent-ink" : "text-flag-ink"}`}>
                    {s.passed}/{s.scored} passed
                  </span>
                  {unscored > 0 && <span className="text-[11px] tabular-nums text-dim">· {unscored} unscored</span>}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-auto pt-2.5 text-[11.5px] leading-snug text-dim text-pretty">
        The simulated suite in evals/ is the controlled measurement; this is the field.
      </p>
    </Card>
  );
}

export function Commitments({ data }: { data: Intelligence }) {
  return (
    <Card title="Expected at the desk" sub="members who named a day">
      {data.commitments.length === 0 ? (
        <Empty>Nobody has committed to a day yet.</Empty>
      ) : (
        <ul className="m-0 flex max-h-[260px] list-none flex-col overflow-auto p-0">
          {data.commitments.map((c, i) => (
            <li key={`${c.member_id}-${i}`} className="flex items-center gap-3 border-b border-row-line py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{c.member_name ?? c.member_id}</p>
                <p className="truncate text-[11px] text-dim">
                  {c.call_type ? (callTypeLabel[c.call_type as CallType] ?? c.call_type) : "call"}
                  {c.reason ? ` · ${reasonLabel[c.reason] ?? c.reason}` : ""}
                </p>
              </div>
              <span className="flex-none rounded-[7px] border border-accent-line bg-accent px-2.5 py-0.5 text-[12px] font-bold text-on-accent">{c.day}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FollowUps({ data }: { data: Intelligence }) {
  return (
    <Card title="Needs a person" sub="what the agent couldn't do itself">
      {data.follow_ups.length === 0 ? (
        <Empty>Nothing outstanding.</Empty>
      ) : (
        <ul className="m-0 flex max-h-[260px] list-none flex-col overflow-auto p-0">
          {data.follow_ups.map((f, i) => (
            <li key={`${f.member_id}-${i}`} className="border-b border-row-line py-2 last:border-b-0">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{f.member_name ?? f.member_id}</span>
                {f.said_at && <span className="flex-none text-[11px] text-dim">{dateTime(f.said_at)}</span>}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted text-pretty">{f.task}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TodaysQueue({ data, className = "" }: { data: Intelligence; className?: string }) {
  const e = data.economics;
  const r = data.health.revenue_at_risk;
  const oneIn = e.break_even_conversion > 0 ? Math.round(1 / e.break_even_conversion) : null;
  return (
    <Card title="Today’s queue" sub="members due a call, after every eligibility gate" className={className}>
      {data.health.history_error && (
        <Notice className="mb-2">Call history couldn&apos;t be read, so cooldowns and do-not-contact aren&apos;t applied to this count.</Notice>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 min-[1360px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col">
          <div className="mb-2.5 flex items-baseline gap-2.5">
            <span className="font-display text-[30px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">{e.calls}</span>
            <span className="text-[11.5px] text-dim">calls</span>
            <span className="ml-auto font-display text-[20px] font-bold tracking-[-0.02em] tabular-nums text-ink" title="Calls × cost per call">
              {moneyCents(e.total_cost)}
            </span>
          </div>
          {CALL_TYPE_ORDER.map((type) => (
            <div key={type} className="flex items-center gap-[9px] border-b border-row-line py-[5px]">
              <span className={`flex-1 text-[11px] font-bold uppercase tracking-[0.1em] ${CALL_TYPE_TINT[type].ink}`}>{callTypeLabel[type]}</span>
              <span className="text-[12.5px] font-bold tabular-nums text-ink">{r[type].members}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-3 gap-2.5">
            <Figure label="Per call" value={`$${e.cost_per_call.toFixed(2)}`} note="voice, telephony and the text" />
            <Figure label="A saved member" value={`$${Math.round(e.average_retained_value).toLocaleString("en-AU")}`} note={`their fee for ${e.retained_months} more months`} />
            <Figure label="Break-even" value={e.calls > 0 ? percent(e.break_even_conversion) : "—"} note={oneIn ? `one save in ${oneIn.toLocaleString("en-AU")} calls` : "nobody due today"} accent />
          </div>
          {e.calls > 0 && (
            <p className="text-[12px] leading-snug text-muted text-pretty">
              Calling everyone due today costs {moneyCents(e.total_cost)}.{" "}
              {e.break_even_saves === 1 ? "A single save" : `${e.break_even_saves} saves`} cover{e.break_even_saves === 1 ? "s" : ""} the whole
              run. That takes no guess about how often a call works.
            </p>
          )}
        </div>
      </div>
      <details className="group mt-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.08em] text-dim hover:text-ink">
          Assumptions behind these numbers
        </summary>
        <dl className="m-0 mt-2.5 flex flex-col gap-2">
          {e.assumptions.map((a) => (
            <div key={a.key} className="grid grid-cols-[150px_150px_minmax(0,1fr)] gap-3">
              <dt className="text-[12px] font-semibold text-ink-2">{a.label}</dt>
              <dd className="m-0 font-mono text-[12px] text-accent-ink">{a.value}</dd>
              <dd className="m-0 text-[12px] leading-snug text-dim text-pretty">{a.source}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 border-t border-line pt-2.5 text-[12px] leading-snug text-dim text-pretty">
          Not assumed anywhere: how often a call works. Every figure above is arithmetic on today&apos;s queue and the assumptions
          listed here.
        </p>
      </details>
    </Card>
  );
}

function Figure({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-control px-[11px] py-[9px]">
      <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.08em] text-dim">{label}</span>
      <span className={`font-display text-[20px] font-bold leading-none tracking-[-0.02em] tabular-nums ${accent ? "text-accent-ink" : "text-ink"}`}>{value}</span>
      <span className="text-[11px] leading-snug text-dim text-pretty">{note}</span>
    </div>
  );
}
