"use client";

import { useMemo, useState } from "react";
import type { QueueEntry } from "@/lib/queueView";
import type { CallType } from "@/lib/callType";
import { blockedLabel, callTypeLabel, callTypeStyle, cohortLabel } from "@/lib/labels";
import Avatar from "@/components/Avatar";

/**
 * All 500 members and the routing decision for each.
 *
 * The point of this page is auditability: a front-desk manager, or a judge,
 * should be able to search a name and read the sentence that explains why that
 * member is or is not being called today. The filters exist so "show me
 * everyone we are deliberately not ringing" is one click.
 */

type Filter = "all" | CallType | "excluded" | "auto_renew";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "renewal", label: "Renewal" },
  { key: "reengagement", label: "Reengagement" },
  { key: "winback", label: "Winback" },
  { key: "cancellation", label: "Cancellation" },
  { key: "excluded", label: "Not called" },
  { key: "auto_renew", label: "Auto-renew" },
];

export default function MemberTable({ entries }: { entries: QueueEntry[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.member_id.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "all") return true;
      if (filter === "excluded") return e.call_type === null;
      if (filter === "auto_renew") return e.auto_renew;
      return e.call_type === filter;
    });
  }, [entries, query, filter]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key
                  ? "border-transparent bg-[#D6FF3D] text-black"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Search name or member id…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-[#D6FF3D]/50 focus:outline-none sm:w-64"
        />
      </div>

      <p className="mt-3 text-xs text-zinc-600">
        {filtered.length} of {entries.length} members
      </p>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-900 text-sm">
          <thead className="bg-zinc-950/80">
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-5 py-3.5 font-semibold">Member</th>
              <th className="px-5 py-3.5 font-semibold">Cohort</th>
              <th className="px-5 py-3.5 font-semibold">Contract</th>
              <th className="px-5 py-3.5 font-semibold">Today</th>
              <th className="px-5 py-3.5 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-black">
            {filtered.slice(0, 200).map((e) => (
              <tr key={e.member_id} className="align-top text-zinc-200">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar id={e.member_id} size="sm" />
                    <div>
                      <p className="font-bold text-white">{e.name}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{e.member_id}</p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
                  {cohortLabel[e.cohort]}
                  <span className="block text-[11px] text-zinc-600">
                    last in {e.days_since_visit}d · {e.old_rate.toFixed(1)}/wk before
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
                  {e.contract_type}
                  <span className="block text-[11px] text-zinc-600">
                    {e.auto_renew
                      ? "auto-renews"
                      : e.days_to_expiry >= 0
                        ? `${e.days_to_expiry}d left`
                        : `lapsed ${-e.days_to_expiry}d ago`}
                    {" · "}${e.monthly_fee}/mo
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  {e.call_type ? (
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${callTypeStyle[e.call_type]}`}
                    >
                      {callTypeLabel[e.call_type]}
                    </span>
                  ) : (
                    <span className="inline-block rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-500">
                      {blockedLabel[e.blocked_by ?? ""] ?? "not called"}
                    </span>
                  )}
                  {e.attempt_number > 1 && (
                    <span className="block text-[11px] text-zinc-600">
                      attempt {e.attempt_number}
                    </span>
                  )}
                </td>
                <td className="max-w-md px-5 py-4 text-xs leading-relaxed text-zinc-500">
                  {e.trigger ?? e.blocked_reason}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-zinc-600">
                  Nobody matches that.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 200 && (
        <p className="mt-3 text-center text-xs text-zinc-600">
          Showing the first 200. Narrow it with a filter or a search — rendering 500 rows of
          this table is slower than it is useful.
        </p>
      )}
    </div>
  );
}
