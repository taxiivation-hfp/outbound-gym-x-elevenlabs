import membersData from "@/data/members_scored.json";
import type { Member } from "@/lib/types";
import MemberTable from "@/components/MemberTable";
import QuadrantView from "@/components/QuadrantView";

const members = membersData as Member[];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-10">
        <header>
          <h1 className="text-2xl font-semibold">Retention Router</h1>
          <p className="mt-1 text-sm text-slate-400">
            Who to contact, who to leave alone, and why.
          </p>
        </header>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Quadrant view
          </h2>
          <QuadrantView members={members} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Member list
          </h2>
          <MemberTable members={members} />
        </section>
      </div>
    </main>
  );
}
