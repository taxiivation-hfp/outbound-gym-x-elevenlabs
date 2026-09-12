import membersData from "@/data/members_scored.json";
import type { Member } from "@/lib/types";
import { sortMembersByPriority } from "@/lib/sortMembers";
import ActionQueueTable from "@/components/ActionQueueTable";

// Minimal placeholder for the full member list (Sprint 3 will build this out
// with real filtering/search/pagination — see the retention-router plan).
export default function MembersPage() {
  const members = sortMembersByPriority(membersData as Member[]);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
        <header>
          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
            All Members
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Full priority-ordered member list — {members.length} total.
          </p>
        </header>

        <section className="mt-8">
          <ActionQueueTable members={members} />
        </section>
      </main>
    </div>
  );
}
