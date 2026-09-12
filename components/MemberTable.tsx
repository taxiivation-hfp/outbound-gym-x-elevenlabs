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

const cohortColor: Record<Member["cohort"], string> = {
  new_joiner: "bg-sky-950 text-sky-300 border-sky-800",
  sliding: "bg-amber-950 text-amber-300 border-amber-800",
  sleeping_dog: "bg-red-950 text-red-300 border-red-800",
  winback: "bg-emerald-950 text-emerald-300 border-emerald-800",
  steady: "bg-slate-800 text-slate-300 border-slate-700",
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

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-900">
          <tr className="text-left text-slate-400">
            <th className="px-4 py-3 font-medium">Member</th>
            <th className="px-4 py-3 font-medium">Cohort</th>
            <th className="px-4 py-3 font-medium">Last visit</th>
            <th className="px-4 py-3 font-medium">Uplift</th>
            <th className="px-4 py-3 font-medium">Reason</th>
            <th className="px-4 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-950">
          {members.map((m) => (
            <tr key={m.member_id} className="text-slate-200">
              <td className="px-4 py-3 font-medium">{m.name}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded border px-2 py-0.5 text-xs ${cohortColor[m.cohort]}`}
                >
                  {cohortLabel[m.cohort]}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-400">
                {m.signals.days_since_visit} days ago
              </td>
              <td className="px-4 py-3">
                <span
                  className={m.uplift >= 0 ? "text-emerald-400" : "text-red-400"}
                >
                  {m.uplift >= 0 ? "+" : ""}
                  {(m.uplift * 100).toFixed(0)}%
                </span>
              </td>
              <td className="max-w-xs px-4 py-3 text-slate-400" title={m.reason}>
                <span className="line-clamp-2">{m.reason}</span>
              </td>
              <td className="px-4 py-3">
                {m.channel === "ai_call" ? (
                  <button
                    onClick={() => handleCall(m)}
                    disabled={loadingId === m.member_id || calledIds.has(m.member_id)}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingId === m.member_id
                      ? "Calling…"
                      : calledIds.has(m.member_id)
                      ? "Call placed"
                      : "Call now"}
                  </button>
                ) : m.channel === "staff" ? (
                  <span className="text-xs text-slate-400">Staff conversation</span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
