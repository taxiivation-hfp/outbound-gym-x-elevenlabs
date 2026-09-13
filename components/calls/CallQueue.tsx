"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { HeaderPill } from "@/components/shell/AppShell";
import { isTypingTarget } from "@/components/shell/theme";
import { readTestNumber } from "@/components/shell/testNumber";
import QueueRow, { ROW_GRID, type CallState } from "@/components/calls/QueueRow";
import {
  BLOCKED_NOTE,
  BLOCKED_ORDER,
  CALL_TYPE_ORDER,
  CALL_TYPE_TINT,
  longDate,
  tenureLabel,
  whyNow,
} from "@/components/calls/format";
import type { CallType } from "@/lib/callType";
import { blockedLabel, callTypeLabel } from "@/lib/labels";
import type { QueueEntry, QueueView } from "@/lib/queueView";
import type { CallRecord } from "@/lib/types";

/**
 * The call queue: every member, the ones due a call on top, the ones the
 * product refuses to call underneath with the reason for each.
 *
 * Everything on it comes from `buildQueueView`, which `/api/queue` also
 * returns, and a call is placed through `/api/call`, which reads the member
 * and re-checks eligibility itself — so this screen can't dial anyone the
 * server wouldn't. Transcripts arrive by webhook; there is no push to the
 * browser, so the Refresh button is how a finished call shows up.
 */

type Variant = "table" | "by-type";
type SortKey = "name" | "why" | "days" | "visits" | "expires" | "tenure" | "fee" | "dials" | "type";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "name", label: "Name", title: "Sort by name" },
  { key: "why", label: "Why now", title: "What put them in the queue, or kept them out" },
  { key: "days", label: "Away", title: "Days since their last visit" },
  { key: "visits", label: "Visits 90d", title: "Check-ins in the last 90 days" },
  { key: "expires", label: "Term ends", title: "Fixed term end, rollover date, or when it ended" },
  { key: "tenure", label: "Tenure", title: "How long they've been a member" },
  { key: "fee", label: "Fee", title: "Monthly fee today" },
  { key: "dials", label: "Dials", title: "Calls placed, answered or not" },
  { key: "type", label: "Call type", title: "Which agent would call" },
];

/** Buckets with more rows than this open collapsed, so the queue stays in view. */
const OPEN_BUCKET_MAX = 12;

function sortValue(entry: QueueEntry, key: SortKey, asOf: string): string | number {
  switch (key) {
    case "name":
      return entry.name;
    case "why":
      return entry.call_type ? whyNow(entry, asOf) : (blockedLabel[entry.blocked_by ?? ""] ?? "");
    case "days":
      return entry.days_since_visit;
    case "visits":
      return entry.visit_count_90d;
    case "expires":
      return entry.days_to_expiry;
    case "tenure":
      return entry.tenure_days;
    case "fee":
      return entry.monthly_fee;
    case "dials":
      return entry.dial_count;
    case "type":
      return entry.call_type ?? "";
  }
}

export default function CallQueue({ view, gymName }: { view: QueueView; gymName: string }) {
  const router = useRouter();
  const [variant, setVariant] = useState<Variant>("table");
  const [types, setTypes] = useState<CallType[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [bucketOpen, setBucketOpen] = useState<Record<string, boolean>>({});
  const [records, setRecords] = useState<Record<string, CallRecord>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [callState, setCallState] = useState<Record<string, CallState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const asOf = view.as_of;

  const fetchRecords = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setLoading((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    try {
      const res = await fetch(`/api/call-records?member_ids=${ids.map(encodeURIComponent).join(",")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fetched = (await res.json()) as Record<string, CallRecord>;
      setRecords((prev) => ({ ...prev, ...fetched }));
      setRecordsError(null);
    } catch (err) {
      setRecordsError(`Call records couldn't be loaded (${err instanceof Error ? err.message : String(err)}). Refresh to try again.`);
    } finally {
      setLoading((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, false])) }));
    }
  }, []);

  // Anyone with a dial on record gets their latest call loaded once.
  const dialledIds = useMemo(() => view.entries.filter((e) => e.dial_count > 0).map((e) => e.member_id), [view.entries]);
  useEffect(() => {
    fetchRecords(dialledIds);
  }, [dialledIds, fetchRecords]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e.target)) setOpen({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    router.refresh();
    const ids = Array.from(new Set([...dialledIds, ...Object.keys(records), ...Object.keys(callState)]));
    await fetchRecords(ids);
    setRefreshing(false);
  };

  const toggleRow = (entry: QueueEntry) => {
    const id = entry.member_id;
    setOpen((o) => {
      const next = { ...o };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
    if (!records[id] && !loading[id] && (entry.dial_count > 0 || callState[id]?.status === "placed")) fetchRecords([id]);
  };

  async function placeCall(entry: QueueEntry) {
    const id = entry.member_id;
    setCallState((s) => ({ ...s, [id]: { status: "calling" } }));
    const testNumber = readTestNumber();
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The member, the gym and the sidebar's test number, nothing else: the
        // route reads the member and decides eligibility itself. A blank test
        // number is left out, so CALL_OVERRIDE_NUMBER stands.
        body: JSON.stringify({ member_id: id, gym_id: view.default_gym_id, ...(testNumber ? { test_number: testNumber } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCallState((s) => ({ ...s, [id]: { status: "refused", detail: body?.reason ?? body?.error ?? `HTTP ${res.status}` } }));
        return;
      }
      setCallState((s) => ({ ...s, [id]: { status: "placed" } }));
      setTimeout(() => fetchRecords([id]), 1500);
    } catch (err) {
      setCallState((s) => ({ ...s, [id]: { status: "refused", detail: `Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}` } }));
    }
  }

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (e: QueueEntry) => !q || e.name.toLowerCase().includes(q) || e.member_id.toLowerCase().includes(q),
    [q]
  );

  const order = useCallback(
    (rows: QueueEntry[]) => {
      const indexed = rows.map((entry, index) => ({ entry, index }));
      indexed.sort((a, b) => {
        // A member who has asked to cancel is always on top: that call has a date on it.
        const cancel = Number(b.entry.call_type === "cancellation") - Number(a.entry.call_type === "cancellation");
        if (cancel !== 0) return cancel;
        if (sort) {
          const av = sortValue(a.entry, sort.key, asOf);
          const bv = sortValue(b.entry, sort.key, asOf);
          const diff = typeof av === "string" ? av.localeCompare(String(bv)) : av - (bv as number);
          if (diff !== 0) return sort.dir === "asc" ? diff : -diff;
        }
        // Otherwise the view's own order: cohort urgency, most dormant first.
        return a.index - b.index;
      });
      return indexed.map((x) => x.entry);
    },
    [sort, asOf]
  );

  const due = useMemo(() => view.entries.filter((e) => e.call_type), [view.entries]);
  const excluded = useMemo(() => view.entries.filter((e) => !e.call_type), [view.entries]);

  const visibleDue = useMemo(
    () => order(due.filter((e) => matches(e) && (variant === "by-type" || types.length === 0 || types.includes(e.call_type as CallType)))),
    [due, matches, variant, types, order]
  );

  const buckets = useMemo(
    () =>
      BLOCKED_ORDER.map((key) => {
        const all = excluded.filter((e) => e.blocked_by === key);
        return { key, total: all.length, rows: order(all.filter(matches)) };
      }),
    [excluded, matches, order]
  );

  const typeGroups = useMemo(
    () => CALL_TYPE_ORDER.map((type) => ({ type, rows: visibleDue.filter((e) => e.call_type === type) })),
    [visibleDue]
  );

  const bucketIsOpen = (bucket: { key: string; total: number; rows: QueueEntry[] }) =>
    q ? bucket.rows.length > 0 : (bucketOpen[bucket.key] ?? bucket.total <= OPEN_BUCKET_MAX);
  const visibleExcluded = buckets.reduce((n, b) => n + (bucketIsOpen(b) ? b.rows.length : 0), 0);
  const visibleFees = visibleDue.reduce((n, e) => n + e.monthly_fee, 0);
  const tenureAvgDays = visibleDue.length ? visibleDue.reduce((n, e) => n + e.tenure_days, 0) / visibleDue.length : null;
  const dialled = dialledIds.length;
  const askedToCancel = view.entries.filter((e) => e.cancellation_requested).length;

  const toggleSort = (key: SortKey) =>
    setSort((s) => {
      if (s && s.key === key) return s.dir === "desc" ? { key, dir: "asc" } : null;
      return { key, dir: key === "name" || key === "why" || key === "type" ? "asc" : "desc" };
    });

  const rowProps = (entry: QueueEntry) => ({
    entry,
    asOf,
    open: Boolean(open[entry.member_id]),
    record: records[entry.member_id] ?? null,
    recordLoading: Boolean(loading[entry.member_id]),
    callState: callState[entry.member_id],
    onToggle: () => toggleRow(entry),
    onCall: () => placeCall(entry),
  });

  return (
    <AppShell
      current="queue"
      title={gymName}
      eyebrow="Call queue"
      memberCount={view.counts.total}
      headerBody={
        <HeaderPill>
          <span className="font-bold">Member data</span>
          <span className="opacity-75">as of {longDate(asOf)}</span>
        </HeaderPill>
      }
      headerActions={
        <>
          <div className="flex items-stretch">
            <Stat value={view.counts.due_total} label="To call" title="Members due a call today, after every eligibility gate" />
            <Divider />
            <Stat value={dialled} label="Dialled" muted title="Members with at least one call on record" />
            <Divider />
            <Stat value={view.counts.total - view.counts.due_total} label="Excluded" muted title="Members the agent won't dial today, each with a reason" />
            <Divider />
            <Stat value={askedToCancel} label="Asked to cancel" flag title="Members with a cancellation request in the member data" />
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            title="Reload the queue and the latest call for each member"
            className="h-[34px] rounded-[10px] border border-line bg-control px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:border-accent-line disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </>
      }
    >
      <section
        aria-label="Call queue"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-window"
      >
        <nav
          aria-label="Filter the queue"
          className="flex h-[46px] flex-none items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-line bg-surface-2 px-3.5"
        >
          {variant === "table" ? (
            <>
              <Chip on={types.length === 0} count={view.counts.due_total} onClick={() => setTypes([])}>
                All
              </Chip>
              {CALL_TYPE_ORDER.map((type) => {
                const on = types.includes(type);
                return (
                  <Chip
                    key={type}
                    on={on}
                    tint={type}
                    count={view.counts[type]}
                    onClick={() => setTypes((t) => (on ? t.filter((x) => x !== type) : [...t, type]))}
                  >
                    {callTypeLabel[type]}
                  </Chip>
                );
              })}
            </>
          ) : (
            <span className="text-[11.5px] text-dim">Grouped by the agent that would call</span>
          )}
          <div className="ml-auto flex min-w-0 flex-none items-center gap-3">
            <span className="hidden min-w-0 truncate text-[11.5px] text-dim xl:inline">
              cancellations first, then {sort ? `${COLUMNS.find((c) => c.key === sort.key)?.label.toLowerCase()} ${sort.dir === "asc" ? "ascending" : "descending"}` : "priority"}
            </span>
            <div role="group" aria-label="Layout" className="flex gap-0.5 rounded-[10px] border border-line bg-control p-[3px]">
              {(
                [
                  ["table", "One table"],
                  ["by-type", "By call type"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={variant === key}
                  onClick={() => setVariant(key)}
                  className={`h-[26px] rounded-[7px] px-3 text-[12px] ${
                    variant === key ? "bg-surface font-bold text-ink shadow-soft" : "font-semibold text-dim hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a member"
              aria-label="Find a member"
              className="h-[30px] w-[170px] rounded-[9px] border border-control-line bg-surface px-[11px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent-line"
            />
          </div>
        </nav>

        {(view.history_error || view.gym_notice || recordsError) && (
          <div className="flex flex-none flex-col gap-1.5 border-b border-line bg-flag-wash px-3.5 py-2.5 text-[12px] text-ink-2">
            {view.history_error && (
              <p>
                <strong className="text-flag-ink">Call history couldn&apos;t be read,</strong> so attempts, cooldowns and
                do-not-contact aren&apos;t reflected here. The call route still checks them and refuses rather than dial
                blind. ({view.history_error})
              </p>
            )}
            {view.gym_notice && (
              <p>
                <strong className="text-flag-ink">Gym settings:</strong> {view.gym_notice}
              </p>
            )}
            {recordsError && <p className="text-flag-ink">{recordsError}</p>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <div role="table" aria-label="Members, the ones due a call first" className="min-w-[1080px]">
            <div
              role="row"
              className="sticky top-0 z-[6] h-7 border-b border-line-strong bg-surface px-3.5 shadow-[0_6px_12px_-10px_rgba(0,0,0,0.35)]"
              style={{ display: "grid", gridTemplateColumns: ROW_GRID, alignItems: "stretch" }}
            >
              {COLUMNS.map((col, i) => {
                const on = sort?.key === col.key;
                return (
                  <button
                    key={col.key}
                    type="button"
                    role="columnheader"
                    aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    title={col.title}
                    onClick={() => toggleSort(col.key)}
                    className={`flex h-full items-center gap-[5px] whitespace-nowrap border-r border-cell-line px-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-dim hover:text-ink ${
                      i === 0 ? "justify-start" : "justify-center"
                    }`}
                  >
                    <span>{col.label}</span>
                    <span aria-hidden="true" className={`text-[9px] text-accent-ink transition-transform ${on ? "opacity-100" : "opacity-0"} ${on && sort.dir === "asc" ? "rotate-180" : ""}`}>
                      ▾
                    </span>
                  </button>
                );
              })}
            </div>

            {variant === "table" ? (
              visibleDue.map((entry) => <QueueRow key={entry.member_id} {...rowProps(entry)} />)
            ) : (
              typeGroups.map((group) => (
                <div key={group.type}>
                  <GroupHead
                    label={callTypeLabel[group.type]}
                    count={group.rows.length}
                    meta={`$${group.rows.reduce((n, e) => n + e.monthly_fee, 0).toLocaleString("en-AU")} a month in monthly fees`}
                    tint={group.type}
                  />
                  {group.rows.map((entry) => (
                    <QueueRow key={entry.member_id} {...rowProps(entry)} />
                  ))}
                  {group.rows.length === 0 && <Empty>{q ? "Nobody here matches that name." : "Nobody due this call today."}</Empty>}
                </div>
              ))
            )}
            {variant === "table" && visibleDue.length === 0 && (
              <Empty>{q || types.length ? "Nobody due a call matches that." : "Nobody is due a call today."}</Empty>
            )}

            <GroupHead label="Excluded" count={view.counts.total - view.counts.due_total} meta="the agent won't dial these today, and the call route refuses them too" muted />
            {buckets.map((bucket) => {
              const isOpen = bucketIsOpen(bucket);
              return (
                <div key={bucket.key}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setBucketOpen((b) => ({ ...b, [bucket.key]: !isOpen }))}
                    className="sticky top-[66px] z-[4] flex h-8 w-full items-center gap-2.5 border-b border-row-line bg-surface-2 px-3.5 text-left hover:bg-row-hover"
                  >
                    <span aria-hidden="true" className={`inline-block w-3 text-[10px] text-dim transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      ▶
                    </span>
                    <span className="text-[12.5px] font-bold text-ink-2">{blockedLabel[bucket.key]}</span>
                    <span className="rounded-full bg-control px-2 py-px text-[11px] font-bold tabular-nums text-dim">
                      {q ? `${bucket.rows.length} of ${bucket.total}` : bucket.total}
                    </span>
                    <span className="truncate text-[11.5px] text-dim">{BLOCKED_NOTE[bucket.key]}</span>
                  </button>
                  {isOpen && bucket.rows.map((entry) => <QueueRow key={entry.member_id} {...rowProps(entry)} />)}
                </div>
              );
            })}
            <div aria-hidden="true" className="h-10" />
          </div>
        </div>

        <footer className="flex h-8 flex-none items-center gap-5 whitespace-nowrap border-t border-line bg-surface px-3.5 text-[11.5px] text-dim">
          <span>
            <strong className="font-bold text-ink">{visibleDue.length}</strong> due · <strong className="font-bold text-ink">{visibleExcluded}</strong> excluded shown
          </span>
          <span title="Monthly fees of the due members on screen">
            <strong className="font-bold text-ink">${visibleFees.toLocaleString("en-AU")}</strong> a month in the visible queue
          </span>
          {tenureAvgDays !== null && <span>average tenure {tenureLabel(Math.round(tenureAvgDays))}</span>}
          <span className="ml-auto">esc collapse · d theme</span>
        </footer>
      </section>
    </AppShell>
  );
}

function Stat({ value, label, title, muted, flag }: { value: number; label: string; title: string; muted?: boolean; flag?: boolean }) {
  return (
    <div title={title} className="flex flex-col items-end justify-center px-4">
      <span className={`font-display text-[21px] font-bold leading-none tracking-[-0.02em] tabular-nums ${flag ? "text-flag-ink" : muted ? "text-muted" : "text-ink"}`}>
        {value}
      </span>
      <span className={`mt-[3px] text-[9.5px] font-bold uppercase tracking-[0.1em] ${flag ? "text-flag-ink" : "text-dim"}`}>{label}</span>
    </div>
  );
}

function Divider() {
  return <div aria-hidden="true" className="my-2.5 w-px bg-line" />;
}

function Chip({
  on,
  count,
  tint,
  onClick,
  children,
}: {
  on: boolean;
  count: number;
  tint?: CallType;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const t = tint ? CALL_TYPE_TINT[tint] : null;
  const look = on
    ? t
      ? `${t.bg} ${t.ink} ${t.border} font-bold`
      : "bg-accent-wash text-accent-ink border-accent-line font-bold"
    : "bg-surface text-muted border-control-line font-medium hover:text-ink";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-[30px] flex-none items-center gap-2 whitespace-nowrap rounded-[9px] border px-[13px] text-[12.5px] transition-colors ${look}`}
    >
      {children}
      <span className={`text-[11px] font-bold tabular-nums ${on ? "opacity-65" : "text-dim"}`}>{count}</span>
    </button>
  );
}

function GroupHead({ label, count, meta, tint, muted }: { label: string; count: number; meta: string; tint?: CallType; muted?: boolean }) {
  return (
    <div className={`sticky top-7 z-[5] flex h-[38px] items-center gap-[11px] border-y border-b-line border-t-line-strong bg-control px-3.5 ${muted ? "text-muted" : "text-ink"}`}>
      {tint && <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${CALL_TYPE_TINT[tint].bg} border ${CALL_TYPE_TINT[tint].border}`} />}
      <span className="font-display text-[14px] font-bold tracking-[-0.01em]">{label}</span>
      <span className="rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-dim">{count}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span className="text-[11.5px] text-dim">{meta}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-row-line px-3.5 py-5 text-center text-[12.5px] text-dim">{children}</div>;
}
