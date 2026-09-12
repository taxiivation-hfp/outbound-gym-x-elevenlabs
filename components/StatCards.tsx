export interface StatCardData {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
  deltaTone?: "good" | "bad";
  accent?: string;
}

export default function StatCards({ stats }: { stats: StatCardData[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {stat.label}
          </p>
          <div className="mt-3 flex items-end justify-between gap-2">
            <p
              className={`text-3xl font-black tracking-tight ${
                stat.accent ?? "text-white"
              }`}
            >
              {stat.value}
            </p>
            {stat.delta && (
              <span
                className={`flex items-center gap-1 pb-1 text-xs font-bold ${
                  stat.deltaTone === "bad" ? "text-red-400" : "text-[#D6FF3D]"
                }`}
              >
                <TrendArrow direction={stat.deltaDirection ?? "up"} />
                {stat.delta}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendArrow({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={direction === "down" ? "rotate-180" : ""}
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
