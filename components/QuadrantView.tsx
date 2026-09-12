import type { Member, Quadrant } from "@/lib/types";

const quadrantMeta: Record<
  Quadrant,
  { title: string; hint: string; style: string }
> = {
  persuadable: {
    title: "Persuadables",
    hint: "Contact — this is where effort pays",
    style: "border-emerald-800 bg-emerald-950/40",
  },
  sure_thing: {
    title: "Sure things",
    hint: "Leave them, they stay anyway",
    style: "border-sky-800 bg-sky-950/40",
  },
  lost_cause: {
    title: "Lost causes",
    hint: "Low priority",
    style: "border-slate-700 bg-slate-900/60",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — contacting them is the harm",
    style: "border-red-800 bg-red-950/40",
  },
};

// fixed layout so it always reads as a 2x2, regardless of data order
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {layout.map((q) => {
        const meta = quadrantMeta[q];
        const list = grouped[q];
        return (
          <div
            key={q}
            className={`rounded-lg border p-4 ${meta.style} ${
              q === "sleeping_dog" ? "ring-1 ring-red-700" : ""
            }`}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-semibold text-slate-100">{meta.title}</h3>
              <span className="text-xs text-slate-400">{list.length}</span>
            </div>
            <p className="mb-3 text-xs text-slate-400">{meta.hint}</p>
            <ul className="space-y-1">
              {list.map((m) => (
                <li key={m.member_id} className="text-sm text-slate-300">
                  {m.name}
                </li>
              ))}
              {list.length === 0 && (
                <li className="text-sm text-slate-600">No members</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
