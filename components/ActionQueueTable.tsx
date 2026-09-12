"use client";

import { useState } from "react";
import type { Member } from "@/lib/types";
import Avatar from "@/components/Avatar";

const cohortLabel: Record<Member["cohort"], string> = {
  new_joiner: "New Joiner",
  sliding: "Sliding",
  sleeping_dog: "Sleeping Dog",
  winback: "Winback",
  steady: "Steady",
};

const cohortColor: Record<Member["cohort"], string> = {
  new_joiner: "border-[#D6FF3D]/50 bg-[#D6FF3D]/10 text-[#D6FF3D]",
  sliding: "border-amber-600/60 bg-amber-950/30 text-amber-400",
  sleeping_dog: "border-red-700/60 bg-red-950/30 text-red-400",
  winback: "border-[#D6FF3D]/50 bg-[#D6FF3D]/10 text-[#D6FF3D]",
  steady: "border-cyan-600/60 bg-cyan-950/30 text-cyan-400",
};

export default function ActionQueueTable({ members }: { members: Member[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [calledIds, setCalledIds] = useState<Set<string>>(new Set());

  async function handleCall(member: Member) {
    setLoadingId(member.member_id);
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: member.member_id,
          name: member.name,
          phone: member.phone,
          last_visit: member.last_visit,
          expiry: member.expiry,
          offer: member.offer,
        }),
      });
      if (!res.ok) throw new Error(`Call trigger failed: ${res.status}`);
      setCalledIds((prev) => new Set(prev).add(member.member_id));
    } catch (err) {
      console.error("Failed to place call", err);
    } finally {
      setLoadingId(null);
    }
  }

  function QuickAction({ m }: { m: Member }) {
    if (m.channel === "ai_call") {
      const isLoading = loadingId === m.member_id;
      const isCalled = calledIds.has(m.member_id);
      return (
        <button
          onClick={() => handleCall(m)}
          disabled={isLoading || isCalled}
          className="rounded-md bg-[#D6FF3D] px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-black transition hover:bg-[#c2eb2b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Calling…" : isCalled ? "Call Placed" : "Call Now"}
        </button>
      );
    }
    if (m.channel === "staff") {
      return <span className="text-xs font-medium text-zinc-600">Staff Completed</span>;
    }
    return <span className="text-xs text-zinc-700">—</span>;
  }

  return (
    <>
      {/* Desktop / wide screens: table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 lg:block">
        <table className="min-w-full divide-y divide-zinc-900 text-sm">
          <thead className="bg-zinc-950/80">
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-5 py-3.5 font-semibold">Member</th>
              <th className="px-5 py-3.5 font-semibold">Opportunity Cohort</th>
              <th className="px-5 py-3.5 font-semibold">Last Visit</th>
              <th className="px-5 py-3.5 font-semibold">Est. Uplift</th>
              <th className="px-5 py-3.5 font-semibold">Context / Churn Root Cause</th>
              <th className="px-5 py-3.5 text-right font-semibold">Quick Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-black">
            {members.map((m) => (
              <tr key={m.member_id} className="text-zinc-200">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar id={m.member_id} size="sm" />
                    <span className="font-bold text-white">{m.name}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-block rounded border px-2.5 py-1 text-xs font-semibold ${cohortColor[m.cohort]}`}
                  >
                    {cohortLabel[m.cohort]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-zinc-500">
                  {m.signals.days_since_visit} days ago
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`font-bold ${
                      m.uplift >= 0 ? "text-[#D6FF3D]" : "text-red-400"
                    }`}
                  >
                    {m.uplift >= 0 ? "+" : ""}
                    {(m.uplift * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="max-w-sm px-5 py-4 text-zinc-500" title={m.reason}>
                  <span className="line-clamp-2">{m.reason}</span>
                </td>
                <td className="px-5 py-4 text-right">
                  <QuickAction m={m} />
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-zinc-600">
                  No members match this search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone / narrow screens: stacked cards — a table doesn't fit here */}
      <div className="space-y-3 lg:hidden">
        {members.map((m) => (
          <div
            key={m.member_id}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar id={m.member_id} size="sm" />
                <p className="truncate font-bold text-white">{m.name}</p>
              </div>
              <span
                className={`flex-shrink-0 text-xs font-bold ${
                  m.uplift >= 0 ? "text-[#D6FF3D]" : "text-red-400"
                }`}
              >
                {m.uplift >= 0 ? "+" : ""}
                {(m.uplift * 100).toFixed(0)}%
              </span>
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <span
                className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${cohortColor[m.cohort]}`}
              >
                {cohortLabel[m.cohort]}
              </span>
              <span className="text-xs text-zinc-600">
                {m.signals.days_since_visit} days ago
              </span>
            </div>

            <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{m.reason}</p>

            <div className="mt-3">
              <QuickAction m={m} />
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-600">
            No members match this search.
          </p>
        )}
      </div>
    </>
  );
}
