"use client";

import { useState } from "react";
import type { Member } from "@/lib/types";

const cohortLabel: Record<Member["cohort"], string> = {
  new_joiner: "New joiner",
  sliding: "Sliding",
  sleeping_dog: "Sleeping dog",
  winback: "Winback",
  steady: "Steady",
};

// Purple family for everything except sleeping_dog, which stays red —
// that one is a safety/danger signal ("do not contact"), not a style choice.
const cohortColor: Record<Member["cohort"], string> = {
  new_joiner: "border-violet-300 bg-violet-50 text-violet-700",
  sliding: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
  sleeping_dog: "border-red-300 bg-red-50 text-red-700",
  winback: "border-transparent bg-[#C9A6FF] text-black",
  steady: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

export default function MemberTable({ members }: { members: Member[] }) {
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

  function callButtonLabel(id: string) {
    if (loadingId === id) return "Calling…";
    if (calledIds.has(id)) return "Call placed";
    return "Call now";
  }

  return (
    <>
      {/* Desktop / wide screens: table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 md:block">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Cohort</th>
              <th className="px-4 py-3 font-medium">Last visit</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white">
            {members.map((m) => (
              <tr key={m.member_id} className="text-zinc-800">
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-xs ${cohortColor[m.cohort]}`}
                  >
                    {cohortLabel[m.cohort]}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {m.signals.days_since_visit} days ago
                </td>
                <td className="max-w-xs px-4 py-3 text-zinc-500" title={m.reason}>
                  <span className="line-clamp-2">{m.reason}</span>
                </td>
                <td className="px-4 py-3">
                  {m.channel === "ai_call" ? (
                    <button
                      onClick={() => handleCall(m)}
                      disabled={loadingId === m.member_id || calledIds.has(m.member_id)}
                      className="rounded-full bg-[#C9A6FF] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#b98cff] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callButtonLabel(m.member_id)}
                    </button>
                  ) : m.channel === "staff" ? (
                    <span className="text-xs text-zinc-500">Staff conversation</span>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone / narrow screens: stacked cards — a table doesn't fit here */}
      <div className="space-y-3 md:hidden">
        {members.map((m) => (
          <div
            key={m.member_id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <p className="font-bold text-zinc-900">{m.name}</p>

            <span
              className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cohortColor[m.cohort]}`}
            >
              {cohortLabel[m.cohort]}
            </span>

            <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{m.reason}</p>

            <div className="mt-3">
              {m.channel === "ai_call" ? (
                <button
                  onClick={() => handleCall(m)}
                  disabled={loadingId === m.member_id || calledIds.has(m.member_id)}
                  className="w-full rounded-full bg-[#C9A6FF] py-2 text-sm font-bold text-black transition hover:bg-[#b98cff] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {callButtonLabel(m.member_id)}
                </button>
              ) : m.channel === "staff" ? (
                <p className="text-xs text-zinc-500">Staff conversation</p>
              ) : (
                <p className="text-xs text-zinc-400">No action</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}