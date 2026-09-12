import type { Member, Cohort } from "@/lib/types";

// Purple family for everything except sleeping_dog, which stays red —
// that one is a safety/danger signal ("do not contact"), not a style choice.
const cohortMeta: Record<
  Cohort,
  { title: string; hint: string; blockStyle: string; textOnBlock: string }
> = {
  winback: {
    title: "Winback",
    hint: "Contact — nothing left to lose by calling",
    blockStyle: "bg-[#C9A6FF]",
    textOnBlock: "text-black",
  },
  sliding: {
    title: "Sliding",
    hint: "Real drop, not zero — catch it with a floor conversation",
    blockStyle: "bg-fuchsia-100",
    textOnBlock: "text-fuchsia-800",
  },
  new_joiner: {
    title: "New joiners",
    hint: "Too early to read a trend — welcome them in person",
    blockStyle: "bg-violet-100",
    textOnBlock: "text-violet-800",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — contacting them is the harm",
    blockStyle: "bg-red-100",
    textOnBlock: "text-red-700",
  },
  steady: {
    title: "Steady",
    hint: "No red flags — no action needed",
    blockStyle: "bg-zinc-100",
    textOnBlock: "text-zinc-700",
  },
};

// Fixed order, always the same 5 cohorts regardless of data order.
const layout: Cohort[] = ["winback", "sliding", "new_joiner", "sleeping_dog", "steady"];

export default function QuadrantView({ members }: { members: Member[] }) {
  const grouped: Record<Cohort, Member[]> = {
    winback: [],
    sliding: [],
    new_joiner: [],
    sleeping_dog: [],
    steady: [],
  };
  members.forEach((m) => grouped[m.cohort].push(m));

  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible md:pb-0 lg:grid-cols-5">
      {layout.map((c) => {
        const meta = cohortMeta[c];
        const list = grouped[c];
        return (
          <div
            key={c}
            className="w-[75%] flex-shrink-0 snap-start overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-md md:w-auto"
          >
            {/* Color block — title now lives here instead of a big count number */}
            <div
              className={`relative flex h-32 flex-col items-center justify-center px-3 text-center sm:h-40 ${meta.blockStyle}`}
            >
              <span
                className={`absolute right-3 top-3 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold ${meta.textOnBlock}`}
              >
                {list.length}
              </span>
              <p className={`text-lg font-black uppercase tracking-tight ${meta.textOnBlock}`}>
                {meta.title}
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {meta.hint}
              </p>

              <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-3">
                {list.slice(0, 3).map((m) => (
                  <li key={m.member_id} className="truncate text-sm text-zinc-600">
                    {m.name}
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="text-sm text-zinc-400">No members</li>
                )}
                {list.length > 3 && (
                  <li className="text-xs text-zinc-400">+{list.length - 3} more</li>
                )}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
