import membersData from "@/data/members_scored.json";
import type { Member } from "@/lib/types";
import MemberTable from "@/components/MemberTable";
import QuadrantView from "@/components/QuadrantView";
import TranscriptPanel from "@/components/TranscriptPanel";
import { applyFallbackReasons } from "@/lib/reasoningFallback";

// Flip this to true if the LLM reasoning layer falls behind or breaks —
// every member's `reason` field gets regenerated from a template instead,
// grounded only in the signals already in the JSON. No other code changes.
const USE_FALLBACK_REASONING = false;

const rawMembers = membersData as Member[];
const members = USE_FALLBACK_REASONING
  ? applyFallbackReasons(rawMembers)
  : rawMembers;

const winbackMembers = members.filter((m) => m.channel === "ai_call");

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Purple band: header */}
      <div className="bg-[#C9A6FF] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">
            Retention Router
          </h1>
          <p className="mt-1 text-sm text-black/70">
            Who to contact, who to leave alone, and why.
          </p>
        </div>
      </div>

      {/* White band: quadrant view */}
      <div className="bg-white px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-3 text-xl font-black uppercase tracking-tight text-zinc-900">
            Quadrant view
          </h2>
          <QuadrantView members={members} />
        </div>
      </div>

      {/* Purple band: everything after the quadrant view */}
      <div className="bg-[#C9A6FF] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-8 sm:space-y-10">
          <section>
            <h2 className="mb-3 text-xl font-black uppercase tracking-tight text-black">
              Member list
            </h2>
            <MemberTable members={members} />
          </section>

          <section>
            <h2 className="mb-3 text-xl font-black uppercase tracking-tight text-black">
              Winback calls
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {winbackMembers.map((m) => (
                // callRecord is null until Dan's webhook is writing to Supabase —
                // swap this for a real fetch by member_id once /api/webhook is live
                <TranscriptPanel key={m.member_id} member={m} callRecord={null} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}