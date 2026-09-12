import type { QueueCounts, QueueView } from "@/lib/queueView";

/**
 * What the queue costs and what it is worth.
 *
 * The assumptions are on screen next to the numbers they produce, because an
 * unaudited ROI figure is worth nothing and an auditable one is worth arguing
 * about. The figure that carries the weight is the break-even conversion rate:
 * it takes no guess about how often a call works, and says instead what the
 * success rate would have to be for the exercise to pay for itself.
 */
export default function EconomicsPanel({
  economics,
  counts,
}: {
  economics: QueueView["economics"];
  counts: QueueCounts;
}) {
  const breakEvenPct = economics.break_even_conversion * 100;
  const oneInN = economics.break_even_conversion
    ? Math.round(1 / economics.break_even_conversion)
    : 0;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-black uppercase tracking-tight">What this costs</h2>
        <p className="text-xs text-zinc-600">
          Today&apos;s queue: {counts.due_total} calls
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure
          label="Per call"
          value={`$${economics.cost_per_call.toFixed(2)}`}
          note="voice, telephony and the text, all in"
        />
        <Figure
          label="Whole queue"
          value={`$${economics.total_cost.toFixed(2)}`}
          note={`${counts.due_total} calls`}
        />
        <Figure
          label="A saved member is worth"
          value={`$${Math.round(economics.average_retained_value)}`}
          note={`their fee across ${economics.retained_months} more months`}
          accent
        />
        <Figure
          label="Break-even"
          value={breakEvenPct < 1 ? `${breakEvenPct.toFixed(2)}%` : `${breakEvenPct.toFixed(1)}%`}
          note={oneInN ? `one save in ${oneInN.toLocaleString()} calls` : ""}
          accent
        />
      </div>

      <p className="mt-5 max-w-3xl text-sm leading-relaxed text-zinc-400">
        Calling everyone due today costs{" "}
        <span className="text-white">${economics.total_cost.toFixed(2)}</span>. If the calls
        saved every one of them it would be worth{" "}
        <span className="text-white">
          ${economics.total_value_if_all_saved.toLocaleString()}
        </span>{" "}
        — which nobody should believe. The number that does not need believing is the
        break-even: {economics.break_even_saves === 1 ? "a single save" : `${economics.break_even_saves} saves`}{" "}
        covers the entire run.
      </p>

      <details className="mt-4 rounded-xl border border-zinc-800 bg-black/60 p-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Every assumption behind those numbers
        </summary>
        <dl className="mt-3 space-y-2.5">
          {economics.assumptions.map((a) => (
            <div key={a.key} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[11rem_7rem_1fr] sm:gap-3">
              <dt className="text-xs font-semibold text-zinc-300">{a.label}</dt>
              <dd className="font-mono text-xs text-[#D6FF3D]">{a.value}</dd>
              <dd className="text-xs leading-relaxed text-zinc-500">{a.source}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-zinc-900 pt-3 text-xs leading-relaxed text-zinc-500">
          Not assumed anywhere: how often a call works. That is the one number this build
          cannot know, because no call has been placed to a real member. Every figure above
          is arithmetic on the queue and on published per-minute rates.
        </p>
      </details>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-black tabular-nums tracking-tight ${
          accent ? "text-[#D6FF3D]" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">{note}</p>
    </div>
  );
}
