/**
 * PLACEHOLDER UI — pass one. Correct data, plain layout, no design investment.
 * Pass three replaces this component wholesale; don't polish it.
 *
 * Shows the themed summary the nightly recompute stored. This component only
 * reads it — no model is called to render the page — and the summary is text
 * for a person, never anything a call is built from.
 */
import type { Intelligence } from "@/lib/intelligence";

export default function ReasonThemes({ themes }: { themes: Intelligence["why_they_leave"]["themes"] }) {
  return (
    <section className="mt-6 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">What they said, grouped</h3>
      {!themes.enough ? (
        <p className="mt-1 text-sm text-zinc-500">
          {themes.statements} completed call{themes.statements === 1 ? "" : "s"} recorded the member&apos;s own words. The themed
          summary needs at least {themes.minimum}, so for now the breakdown above is the whole picture.
        </p>
      ) : !themes.stored ? (
        <p className="mt-1 text-sm text-zinc-500">
          {themes.statements} statements are ready to summarise. The summary is written by the nightly recompute, not on page
          load. {themes.notice}
        </p>
      ) : themes.stored.status === "summarised" ? (
        <>
          <p className="mt-1 text-xs text-zinc-500">
            Grouped from {themes.stored.statements} statements by {themes.stored.model} in the nightly run of{" "}
            {themes.ran_at?.slice(0, 10)}. Counts are the statements in each theme; {themes.stored.unthemed} didn&apos;t share a
            reason with anyone else.
          </p>
          {themes.stored.themes.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No reason was shared by more than one member.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {themes.stored.themes.map((t) => (
                <li key={t.theme}>
                  <span className="tabular-nums font-semibold text-white">{t.count}</span> — {t.theme}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : themes.stored.status === "insufficient" ? (
        <p className="mt-1 text-sm text-zinc-500">
          The last nightly run had {themes.stored.statements} statements, under the {themes.minimum} it needs. The next run will
          summarise.
        </p>
      ) : (
        <p className="mt-1 text-sm text-amber-300">The last nightly summary didn&apos;t run: {themes.stored.reason}</p>
      )}
    </section>
  );
}
