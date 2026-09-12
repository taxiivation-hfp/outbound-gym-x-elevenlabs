"use client";

import { useMemo, useState } from "react";
import type { Member } from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import StatCards, { type StatCardData } from "@/components/StatCards";
import OpportunityRoutingMap from "@/components/OpportunityRoutingMap";
import ActionQueueTable from "@/components/ActionQueueTable";
import TranscriptPanel from "@/components/TranscriptPanel";

export default function Dashboard({ members }: { members: Member[] }) {
  const [query, setQuery] = useState("");

  const filteredMembers = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.trim().toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, query]);

  const winbackMembers = members.filter((m) => m.channel === "ai_call");

  const atRiskCount = members.filter(
    (m) => m.quadrant === "sleeping_dog" || m.quadrant === "lost_cause"
  ).length;
  const callQueueCount = members.filter((m) => m.channel === "ai_call").length;

  // Rescue rate isn't derivable from this snapshot (it needs historical
  // outcome data from completed calls) — shown as an illustrative KPI
  // until /api/webhook is wired up to real call_records.
  const stats: StatCardData[] = [
    {
      label: "Total Members Tracked",
      value: members.length.toLocaleString(),
      delta: "+3.2%",
      deltaDirection: "up",
    },
    {
      label: "Active At-Risk",
      value: String(atRiskCount),
      delta: "-12.4%",
      deltaDirection: "down",
      accent: "text-[#D6FF3D]",
    },
    {
      label: "Call Queue Priority",
      value: `${callQueueCount}`,
      delta: "High Value",
      deltaDirection: "up",
    },
    {
      label: "Monthly Rescued Rate",
      value: "78.3%",
      delta: "+5.1%",
      deltaDirection: "up",
    },
  ];

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
                Retention Router
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Route members by retention opportunity. Know who to contact, who
                to leave alone, and why.
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-3">
              <div className="relative">
                <SearchIcon />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  type="text"
                  placeholder="Search members…"
                  className="w-48 rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-[#D6FF3D]/50 focus:outline-none sm:w-56"
                />
              </div>
              <button
                type="button"
                className="whitespace-nowrap rounded-lg bg-[#D6FF3D] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#c2eb2b]"
              >
                Trigger Sync
              </button>
            </div>
          </header>

          <section className="mt-8">
            <StatCards stats={stats} />
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-black uppercase tracking-tight text-white">
              Opportunity Routing Map
            </h2>
            <div className="mt-4">
              <OpportunityRoutingMap members={members} />
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-black uppercase tracking-tight text-white">
                Operational Action Queue
              </h2>
              <span className="text-xs font-semibold text-[#D6FF3D]">
                Showing {filteredMembers.length} Key Priorities
              </span>
            </div>
            <div className="mt-4">
              <ActionQueueTable members={filteredMembers} />
            </div>
          </section>

          {winbackMembers.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-black uppercase tracking-tight text-white">
                Winback Call Transcripts
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {winbackMembers.map((m) => (
                  // callRecord is null until the webhook is writing to
                  // Supabase — swap this for a real fetch by member_id
                  // once /api/webhook is live
                  <TranscriptPanel key={m.member_id} member={m} callRecord={null} />
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
