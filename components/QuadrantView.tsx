import type { Member, Quadrant } from "@/lib/types";

const quadrantMeta: Record<
  Quadrant,
  { title: string; hint: string; blockStyle: string; textOnBlock: string }
> = {
  persuadable: {
    title: "Persuadables",
    hint: "Contact — this is where effort pays",
    blockStyle: "bg-[#C9A6FF]",
    textOnBlock: "text-black",
  },
  sure_thing: {
    title: "Sure things",
    hint: "Leave them, they stay anyway",
    blockStyle: "bg-zinc-100",
    textOnBlock: "text-zinc-700",
  },
  lost_cause: {
    title: "Lost causes",
    hint: "Low priority",
    blockStyle: "bg-zinc-50",
    textOnBlock: "text-zinc-500",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — contacting them is the harm",
    blockStyle: "bg-red-100",
    textOnBlock: "text-red-700",
  },
};

// Fixed order, always the same 4 quadrants regardless of data order.
const layout: Quadrant[] = ["persuadable", "sure_thing", "sleeping_dog", "lost_cause"];

export default function QuadrantView({ members }: { members: Member[] }) {
  const grouped: Record<Quadrant, Member[]> = {
    persuadable: [],
    sure_thing: [],
    lost_cause: [],
    sleeping_dog: [],
  };
  members.forEach((m) => grouped[m.quadrant].push(m));

  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible md:pb-0">
      {layout.map((q) => {
        const meta = quadrantMeta[q];
        const list = grouped[q];
        return (
          <div
            key={q}
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