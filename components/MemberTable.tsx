"use client";

import { useMemo, useState } from "react";
import type { QueueEntry } from "@/lib/queueView";
import type { CallType } from "@/lib/callType";
import { blockedLabel, callTypeLabel, cohortLabel } from "@/lib/labels";
import { CALL_TYPE_TINT } from "@/components/calls/format";

/**
 * All members and the routing decision for each.
 *
 * The point of this page is auditability: a front-desk manager, or a judge,
 * should be able to search a name and read the sentence that explains why that
 * member is or is not being called today. The filters exist so "show me
 * everyone we are deliberately not ringing" is one click.
 */

type Filter = "all" | CallType | "excluded" | "auto_renew";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "cancellation", label: "Cancellation" },
  { key: "renewal", label: "Renewal" },
  { key: "reengagement", label: "Reengagement" },
  { key: "winback", label: "Winback" },
  { key: "excluded", label: "Not called" },
  { key: "auto_renew", label: "Auto-renew" },
];

const PAGE = 200;

export default function MemberTable({ entries }: { entries: QueueEntry[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.member_id.toLowerCase().includes(q)) return false;
      if (filter === "all") return true;
      if (filter === "excluded") return e.call_type === null;
      if (filter === "auto_renew") return e.auto_renew;
      return e.call_type === filter;
    });
  }, [entries, query, filter]);

  const countFor = (key: Filter) =>
    key === "all"
      ? entries.length
      : key === "excluded"
        ? entries.filter((e) => e.call_type === null).length
        : key === "auto_renew"
          ? entries.filter((e) => e.auto_renew).length
          : entries.filter((e) => e.call_type === key).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-window">
      <div className="flex h-[46px] flex-none items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-line bg-surface-2 px-3.5">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.key)}
              className={`flex h-[30px] flex-none items-center gap-2 rounded-[9px] border px-[13px] text-[12.5px] transition-colors ${
                on ? "border-accent-line bg-accent-wash font-bold text-accent-ink" : "border-control-line bg-surface font-medium text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`text-[11px] font-bold tabular-nums ${on ? "opacity-65" : "text-dim"}`}>{countFor(f.key)}</span>
            </button>
          );
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Name or member id"
          aria-label="Find a member by name or id"
          className="ml-auto h-[30px] w-[190px] flex-none rounded-[9px] border border-control-line bg-surface px-[11px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent-line"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="sticky top-0 z-[2] bg-surface">
            <tr className="border-b border-line-strong text-[10.5px] font-bold uppercase tracking-[0.08em] text-dim">
              <th className="px-3.5 py-2 font-bold">Member</th>
              <th className="px-3 py-2 font-bold">Cohort</th>
              <th className="px-3 py-2 font-bold">Contract</th>
              <th className="px-3 py-2 font-bold">Today</th>
              <th className="px-3 py-2 font-bold">Why</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, PAGE).map((e) => (
              <tr key={e.member_id} className={`border-b border-row-line align-top ${e.call_type ? "" : "bg-row-excl"}`}>
                <td className="px-3.5 py-2.5">
                  <p className="text-[13.5px] font-semibold text-ink">{e.name}</p>
                  <p className="font-mono text-[11px] text-dim">{e.member_id}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink-2">
                  {cohortLabel[e.cohort]}
                  <span className="block text-[11px] text-dim">
                    last in {e.days_since_visit}d · {e.old_rate.toFixed(1)}/wk before
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink-2">
                  {e.contract_type}
                  <span className="block text-[11px] text-dim">
                    {e.auto_renew ? "auto-renews" : e.days_to_expiry >= 0 ? `${e.days_to_expiry}d left` : `lapsed ${-e.days_to_expiry}d ago`}
                    {" · "}${e.monthly_fee}/mo
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {e.call_type ? (
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em] ${CALL_TYPE_TINT[e.call_type].bg} ${CALL_TYPE_TINT[e.call_type].ink}`}
                    >
                      {callTypeLabel[e.call_type]}
                    </span>
                  ) : (
                    <span className="inline-block rounded-md bg-off-bg px-2 py-0.5 text-[11px] font-semibold text-off-ink">
                      {blockedLabel[e.blocked_by ?? ""] ?? "not called"}
                    </span>
                  )}
                  {e.attempt_number > 1 && <span className="block text-[11px] text-dim">conversation #{e.attempt_number}</span>}
                </td>
                <td className="max-w-md px-3 py-2.5 text-[12px] leading-relaxed text-muted">{e.trigger ?? e.blocked_reason}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3.5 py-10 text-center text-[12.5px] text-dim">
                  Nobody matches that.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > PAGE && (
          <p className="py-3 text-center text-[12px] text-dim">
            Showing the first {PAGE} of {filtered.length}. Narrow it with a filter or a search.
          </p>
        )}
      </div>
    </section>
  );
}
