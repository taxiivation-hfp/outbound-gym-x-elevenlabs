import type { Cohort, Member } from "@/lib/types";
import Avatar from "@/components/Avatar";

const cohortMeta: Record<
  Cohort,
  {
    title: string;
    hint: string;
    titleColor: string;
    badgeColor: string;
    ringColor: string;
  }
> = {
  winback: {
    title: "Winback",
    hint: "Outbound reactivation call",
    titleColor: "text-[#D6FF3D]",
    badgeColor: "bg-[#D6FF3D] text-black",
    ringColor: "",
  },
  sliding: {
    title: "Sliding",
    hint: "Floor conversation on next visit",
    titleColor: "text-amber-400",
    badgeColor: "bg-amber-500 text-black",
    ringColor: "",
  },
  new_joiner: {
    title: "New joiners",
    hint: "In-person welcome conversation",
    titleColor: "text-cyan-400",
    badgeColor: "bg-cyan-500 text-black",
    ringColor: "",
  },
  steady: {
    title: "Steady",
    hint: "Leave them; they stay anyway",
    titleColor: "text-zinc-400",
    badgeColor: "bg-zinc-700 text-zinc-200",
    ringColor: "",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — risks cancel trigger",
    titleColor: "text-red-400",
    badgeColor: "bg-red-500 text-black",
    ringColor: "ring-1 ring-red-900/60",
  },
};

// Fixed order, always the same 5 cohorts regardless of data order.
const layout: Cohort[] = ["winback", "sliding", "new_joiner", "steady", "sleeping_dog"];

const BUCKET_LIMIT = 5;

export default function OpportunityRoutingMap({ members }: { members: Member[] }) {
  const grouped: Record<Cohort, Member[]> = {
    winback: [],
    sliding: [],
    new_joiner: [],
    steady: [],
    sleeping_dog: [],
  };
  members.forEach((m) => grouped[m.cohort].push(m));
  // most-dormant-first within each bucket, same head/N pattern as the Action Queue
  (Object.keys(grouped) as Cohort[]).forEach((c) => {
    grouped[c].sort((a, b) => b.signals.days_since_visit - a.signals.days_since_visit);
  });

  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0">
      {layout.map((q) => {
        const meta = cohortMeta[q];
        const list = grouped[q];
        const visible = list.slice(0, BUCKET_LIMIT);
        const overflow = list.length - visible.length;
        return (
          <div
            key={q}
            className={`w-[80%] flex-shrink-0 snap-start rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 lg:w-auto ${meta.ringColor}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={`text-base font-black uppercase tracking-tight ${meta.titleColor}`}>
                  {meta.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">{meta.hint}</p>
              </div>
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${meta.badgeColor}`}
              >
                {list.length}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {visible.map((m) => (
                <div
                  key={m.member_id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-black/40 p-3"
                >
                  <Avatar id={m.member_id} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{m.name}</p>
                    <p className="text-xs font-medium text-zinc-500">
                      Last visit: {m.signals.days_since_visit} days ago
                    </p>
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <p className="rounded-xl border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-700">
                  No members
                </p>
              )}
              {overflow > 0 && (
                <p className="pt-1 text-center text-xs text-zinc-600">
                  +{overflow} more
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
