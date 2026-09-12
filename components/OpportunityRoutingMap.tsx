import type { Member, Quadrant } from "@/lib/types";
import Avatar from "@/components/Avatar";

const quadrantMeta: Record<
  Quadrant,
  {
    title: string;
    hint: string;
    titleColor: string;
    badgeColor: string;
    ringColor: string;
  }
> = {
  persuadable: {
    title: "Persuadables",
    hint: "This is where contact drives uplift",
    titleColor: "text-[#D6FF3D]",
    badgeColor: "bg-[#D6FF3D] text-black",
    ringColor: "",
  },
  sure_thing: {
    title: "Sure things",
    hint: "Leave them; they stay anyway",
    titleColor: "text-cyan-400",
    badgeColor: "bg-cyan-500 text-black",
    ringColor: "",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — risks cancel trigger",
    titleColor: "text-red-400",
    badgeColor: "bg-red-500 text-black",
    ringColor: "ring-1 ring-red-900/60",
  },
  lost_cause: {
    title: "Lost causes",
    hint: "Low priority, low engagement history",
    titleColor: "text-zinc-400",
    badgeColor: "bg-zinc-700 text-zinc-200",
    ringColor: "",
  },
};

// Fixed order, always the same 4 quadrants regardless of data order.
const layout: Quadrant[] = ["persuadable", "sure_thing", "sleeping_dog", "lost_cause"];

export default function OpportunityRoutingMap({ members }: { members: Member[] }) {
  const grouped: Record<Quadrant, Member[]> = {
    persuadable: [],
    sure_thing: [],
    lost_cause: [],
    sleeping_dog: [],
  };
  members.forEach((m) => grouped[m.quadrant].push(m));

  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
      {layout.map((q) => {
        const meta = quadrantMeta[q];
        const list = grouped[q];
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
              {list.map((m) => (
                <div
                  key={m.member_id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-black/40 p-3"
                >
                  <Avatar id={m.member_id} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{m.name}</p>
                    <p
                      className={`text-xs font-medium ${
                        m.uplift >= 0 ? "text-[#D6FF3D]" : "text-red-400"
                      }`}
                    >
                      Uplift Potential: {m.uplift >= 0 ? "+" : ""}
                      {(m.uplift * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <p className="rounded-xl border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-700">
                  No members
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
