import type { Member, Cohort } from "@/lib/types";

const cohortMeta: Record<
  Cohort,
  { title: string; hint: string; style: string }
> = {
  winback: {
    title: "Winback",
    hint: "Contact — nothing left to lose by calling",
    style: "border-emerald-800 bg-emerald-950/40",
  },
  sliding: {
    title: "Sliding",
    hint: "Real drop, not zero — catch it with a floor conversation",
    style: "border-amber-800 bg-amber-950/40",
  },
  new_joiner: {
    title: "New joiners",
    hint: "Too early to read a trend — welcome them in person",
    style: "border-sky-800 bg-sky-950/40",
  },
  sleeping_dog: {
    title: "Sleeping dogs",
    hint: "Do not contact — contacting them is the harm",
    style: "border-red-800 bg-red-950/40",
  },
  steady: {
    title: "Steady",
    hint: "No red flags — no action needed",
    style: "border-slate-700 bg-slate-900/60",
  },
};

// fixed layout so it always reads the same way, regardless of data order
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {layout.map((c) => {
        const meta = cohortMeta[c];
        const list = grouped[c];
        return (
          <div
            key={c}
            className={`rounded-lg border p-4 ${meta.style} ${
              c === "sleeping_dog" ? "ring-1 ring-red-700" : ""
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
