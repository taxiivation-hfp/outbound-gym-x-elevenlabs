/**
 * "In members' own words": the themed summary the nightly recompute stored
 * (`queue_runs.reason_themes`, read by lib/reasonThemes.ts). This only reads
 * it — no model is called to render the page — and the summary is text for a
 * person, never anything a call is built from.
 *
 * Every state is its own sentence: not enough statements yet, enough but no
 * run yet, summarised, a run that found too few, and a run that failed. Counts
 * are the statements the check in lib assigned to each theme; there are no
 * per-theme quotes or trends, because nothing stores them.
 */
import { Card, Empty, Notice } from "@/components/intelligence/Card";
import { dayMonth, plural } from "@/components/intelligence/format";
import type { Intelligence } from "@/lib/intelligence";

type Themes = Intelligence["why_they_leave"]["themes"];

export default function ReasonThemes({ themes, className = "" }: { themes: Themes; className?: string }) {
  const stored = themes.stored;
  const sub =
    stored?.status === "summarised"
      ? `themes from ${plural(stored.statements, "statement")} · nightly run of ${themes.ran_at ? dayMonth(themes.ran_at) : "—"}`
      : "themes grouped nightly from what members said";

  return (
    <Card lead title="In members’ own words" sub={sub} className={className}>
      {!themes.enough ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] leading-normal text-ink-2 text-pretty">
            {plural(themes.statements, "completed call")} recorded the member&apos;s own words. The themed summary needs at least{" "}
            {themes.minimum}, so the reason breakdown is the whole picture for now.
          </p>
          <div className="flex items-center gap-2.5" title={`${themes.statements} of the ${themes.minimum} statements needed`}>
            <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-row-line">
              <div className="h-full rounded-[4px] bg-bar" style={{ width: `${Math.min(1, themes.statements / themes.minimum) * 100}%` }} />
            </div>
            <span className="text-[11.5px] tabular-nums text-dim">
              {themes.statements} / {themes.minimum}
            </span>
          </div>
        </div>
      ) : !stored ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] leading-normal text-ink-2 text-pretty">
            {plural(themes.statements, "statement")} are ready to summarise. The nightly recompute writes the summary; the page never
            does.
          </p>
          {themes.notice && <Notice>{themes.notice}</Notice>}
        </div>
      ) : stored.status === "summarised" ? (
        <>
          {stored.themes.length === 0 ? (
            <Empty>No reason was shared by more than one member.</Empty>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-[18px] gap-y-0.5 p-0">
              {stored.themes.map((t) => (
                <li key={t.theme} className="grid grid-cols-[40px_minmax(0,1fr)] items-baseline gap-3 border-b border-row-line py-2.5">
                  <span className="text-right font-display text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
                    {t.count}
                  </span>
                  <span className="text-[13px] font-bold text-ink text-pretty">{t.theme}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto pt-3 text-[11.5px] leading-snug text-dim text-pretty">
            Grouped by {stored.model}. Counts are statements per theme; {stored.unthemed} didn&apos;t share a reason with anyone else.
          </p>
        </>
      ) : stored.status === "insufficient" ? (
        <p className="text-[13px] leading-normal text-ink-2 text-pretty">
          The last nightly run had {plural(stored.statements, "statement")}, under the {themes.minimum} it needs. The next run will
          summarise.
        </p>
      ) : (
        <Notice>The last nightly summary didn&apos;t run: {stored.reason}</Notice>
      )}
    </Card>
  );
}
