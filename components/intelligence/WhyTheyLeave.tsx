/**
 * Why members leave, as the calls extracted it: the stated reason on every
 * completed conversation that gave one, broken down by the call that reached
 * them, their cohort and their tenure band, and the words they used. Read from
 * `composeIntelligence(...).why_they_leave` and `.quotes`. There is no time
 * window: lib counts every call on record, so the screen says "all calls".
 */
import { BarRow, Card, Empty } from "@/components/intelligence/Card";
import { plural, share } from "@/components/intelligence/format";
import type { CallType } from "@/lib/callType";
import { TENURE_BANDS } from "@/lib/economics";
import type { Intelligence } from "@/lib/intelligence";
import { callTypeLabel, cohortLabel, reasonLabel } from "@/lib/labels";
import type { Cohort } from "@/lib/types";

const reasonText = (r: string) => reasonLabel[r] ?? r;

export function hasReasons(data: Intelligence): boolean {
  return Object.keys(data.why_they_leave.overall).length > 0;
}

export function ReasonBreakdown({ data, className = "" }: { data: Intelligence; className?: string }) {
  const entries = Object.entries(data.why_they_leave.overall).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, c]) => n + c, 0);
  const max = entries[0]?.[1] ?? 0;
  return (
    <Card title="Stated reasons" sub={total ? `${plural(total, "stated reason")} · all calls` : "all calls"} className={className}>
      {entries.length === 0 ? (
        <div className="flex flex-col gap-2 py-1">
          <p className="text-[13px] font-bold text-ink">Nothing here yet, and that is real</p>
          <p className="text-[12.5px] leading-normal text-muted text-pretty">
            No completed call has returned a stated reason, so there is nothing to count. Place a call from the queue, let it finish, and
            this fills in from the webhook.
          </p>
          <p className="text-[12px] leading-normal text-dim text-pretty">
            A reason lands here only once the post-call webhook is registered on the agents and{" "}
            <code className="font-mono text-[11px] text-ink-2">supabase/migrations/20260913120000_call_records_analysis.sql</code> is applied.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {entries.map(([reason, n]) => (
            <BarRow key={reason} label={reasonText(reason)} title={reasonText(reason)} value={n} max={max} count={n} shareText={share(n, total)} labelWidth="136px" />
          ))}
        </div>
      )}
    </Card>
  );
}

function CrossTable({
  title,
  rows,
  rowLabel,
  table,
}: {
  title: string;
  rows: string[];
  rowLabel: (row: string) => string;
  table: Record<string, Record<string, number>>;
}) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>No reasons matched to this yet.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((row) => {
            const inner = Object.entries(table[row] ?? {}).sort((a, b) => b[1] - a[1]);
            const n = inner.reduce((s, [, c]) => s + c, 0);
            return (
              <li key={row} className="flex flex-col gap-1.5 border-b border-row-line pb-2.5 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-[12.5px] font-semibold text-ink-2">{rowLabel(row)}</span>
                  <span className="text-[11.5px] tabular-nums text-dim">{n}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inner.map(([reason, count]) => (
                    <span key={reason} className="rounded-[6px] border border-control-line bg-control px-2 py-0.5 text-[11px] text-muted">
                      {reasonText(reason)} · <span className="font-bold tabular-nums text-ink-2">{count}</span>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function ReasonCrossTables({ data }: { data: Intelligence }) {
  const w = data.why_they_leave;
  return (
    <>
      <CrossTable
        title="By call type"
        rows={Object.keys(w.by_call_type)}
        rowLabel={(r) => callTypeLabel[r as CallType] ?? r}
        table={w.by_call_type}
      />
      <CrossTable title="By cohort" rows={Object.keys(w.by_cohort)} rowLabel={(r) => cohortLabel[r as Cohort] ?? r} table={w.by_cohort} />
      <CrossTable title="By tenure" rows={TENURE_BANDS.filter((b) => w.by_tenure_band[b])} rowLabel={(r) => r} table={w.by_tenure_band} />
    </>
  );
}

export function Quotes({ data }: { data: Intelligence }) {
  return (
    <Card title="In their words" sub={data.quotes.length ? plural(data.quotes.length, "quote") : undefined}>
      {data.quotes.length === 0 ? (
        <Empty>No member has put a reason in their own words yet.</Empty>
      ) : (
        <ul className="m-0 flex max-h-[320px] list-none flex-col overflow-auto p-0 pr-1">
          {data.quotes.map((q, i) => (
            <li key={`${q.member_id}-${i}`} className="border-b border-row-line py-2 last:border-b-0">
              <blockquote className="m-0 text-[12.5px] italic leading-normal text-ink-2 text-pretty">&ldquo;{q.quote}&rdquo;</blockquote>
              <p className="mt-1 text-[11px] text-dim">
                {q.member_name ?? q.member_id}
                {q.reason ? ` · ${reasonText(q.reason)}` : ""}
                {q.sentiment ? ` · sounded ${q.sentiment}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
