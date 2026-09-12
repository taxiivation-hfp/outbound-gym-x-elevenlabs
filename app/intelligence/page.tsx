import { buildIntelligence } from "@/lib/intelligence";
import { TENURE_BANDS } from "@/lib/economics";
import { callTypeLabel, cohortLabel, outcomeClass, outcomeText, reasonLabel } from "@/lib/labels";
import type { CallType } from "@/lib/callType";
import type { Cohort } from "@/lib/types";

/**
 * Why members leave — in their own words, because something asked them.
 *
 * Every retention product records *that* a member churned. This records *why*,
 * broken down by the cohort they were in, the call that reached them, and how
 * long they had been a member. It is the output no competitor has, because
 * nobody else is having the conversation.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Why they leave — Retention Router",
};

export default async function IntelligencePage() {
  const data = await buildIntelligence();
  const hasReasons = Object.keys(data.why_they_leave.overall).length > 0;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
          Why they leave
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Every retention tool records that a member churned. This records why, in the words
          they used, because an agent asked them and wrote the answer down. A gym that has
          never had this can act on it in a week: if the reason is the six o&apos;clock crowd,
          that is a rota change, not a discount.
        </p>
        <p className="mt-3 text-xs text-zinc-600">
          {data.calls.dials} dials · {data.calls.completed} completed ·{" "}
          {data.calls.conversations} reached the member ·{" "}
          {data.calls.with_a_stated_reason} gave a reason
        </p>
      </header>

      {data.db_error && (
        <p className="mt-6 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          Supabase could not be read: {data.db_error}
        </p>
      )}

      {!hasReasons && (
        <section className="mt-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 p-6">
          <h2 className="text-base font-bold text-zinc-200">Nothing here yet, and that is real</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
            This page shows what the calls actually extracted. No completed call has yet
            returned a stated reason, so there is nothing to aggregate — rather than fill the
            space with example data, it says so. Place a call from the queue, let it finish,
            and the breakdown below fills in from the webhook.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-500">
            Two things have to be true for a reason to land here: the post-call webhook must be
            registered on the three agents, and{" "}
            <code className="font-mono text-xs text-zinc-400">
              supabase/migrations/20260913120000_call_records_analysis.sql
            </code>{" "}
            must have been applied — before that migration the eight most valuable extracted
            fields have no column to land in.
          </p>
        </section>
      )}

      {hasReasons && (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-black uppercase tracking-tight">The reasons</h2>
            <div className="mt-4">
              <ReasonBars counts={data.why_they_leave.overall} />
            </div>
          </section>

          <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CrossTable
              title="By call type"
              rows={Object.keys(data.why_they_leave.by_call_type)}
              rowLabel={(r) => callTypeLabel[r as CallType] ?? r}
              data={data.why_they_leave.by_call_type}
            />
            <CrossTable
              title="By cohort"
              rows={Object.keys(data.why_they_leave.by_cohort)}
              rowLabel={(r) => cohortLabel[r as Cohort] ?? r}
              data={data.why_they_leave.by_cohort}
            />
            <CrossTable
              title="By tenure"
              rows={TENURE_BANDS.filter((b) => data.why_they_leave.by_tenure_band[b])}
              rowLabel={(r) => r}
              data={data.why_they_leave.by_tenure_band}
            />
          </section>

          {data.quotes.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-black uppercase tracking-tight">In their words</h2>
              <p className="mt-1 text-sm text-zinc-500">
                The histogram is the summary; these are the artefact. A category cannot tell a
                gym to change the rota.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.quotes.map((q, i) => (
                  <blockquote
                    key={`${q.member_id}-${i}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
                  >
                    <p className="text-sm italic leading-relaxed text-zinc-200">
                      &ldquo;{q.quote}&rdquo;
                    </p>
                    <footer className="mt-2.5 text-xs text-zinc-600">
                      {q.member_name} · {reasonLabel[q.reason ?? ""] ?? q.reason}
                      {q.sentiment ? ` · sounded ${q.sentiment}` : ""}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-lg font-black uppercase tracking-tight">Expected at the desk</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Members who named a day. Someone who names a day turns up more often than someone
            who says &ldquo;this week&rdquo;, and the front desk can greet them by name.
          </p>
          {data.commitments.length === 0 ? (
            <p className="mt-4 text-sm italic text-zinc-600">
              Nobody has committed to a day yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-900">
              {data.commitments.map((c, i) => (
                <li key={`${c.member_id}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{c.member_name}</p>
                    <p className="text-xs text-zinc-600">
                      {c.call_type ? callTypeLabel[c.call_type as CallType] : "call"}
                      {c.reason ? ` · ${reasonLabel[c.reason] ?? c.reason}` : ""}
                    </p>
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-[#D6FF3D] px-2.5 py-0.5 text-xs font-bold text-black">
                    {c.day}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-lg font-black uppercase tracking-tight">Needs a person</h2>
          <p className="mt-1 text-sm text-zinc-500">
            What the agent could not do itself. Populated whenever it said it did not have
            something in front of it, promised a callback, or hit a booking it could not make.
          </p>
          {data.follow_ups.length === 0 ? (
            <p className="mt-4 text-sm italic text-zinc-600">Nothing outstanding.</p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-900">
              {data.follow_ups.map((f, i) => (
                <li key={`${f.member_id}-${i}`} className="py-2.5">
                  <p className="text-sm font-semibold text-white">{f.member_name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{f.task}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-lg font-black uppercase tracking-tight">How the calls ended</h2>
          {Object.keys(data.outcomes.overall).length === 0 ? (
            <p className="mt-4 text-sm italic text-zinc-600">No completed calls yet.</p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {Object.entries(data.outcomes.overall)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, count]) => (
                  <li
                    key={outcome}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${outcomeClass(outcome)}`}
                  >
                    {outcomeText(outcome)} · {count}
                  </li>
                ))}
            </ul>
          )}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Small label="Offers made" value={data.offers.made} />
            <Small label="Accepted" value={data.offers.accepted} />
            <Small label="Links texted" value={data.offers.links_sent} />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-lg font-black uppercase tracking-tight">
            Guardrails, on real calls
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            The same three criteria the agents are evaluated on in the simulated suite, scored
            by ElevenLabs on every live call. The suite is the controlled measurement; this is
            the field.
          </p>
          <ul className="mt-4 space-y-2.5">
            {Object.entries(data.live_criteria).map(([name, s]) => (
              <li key={name} className="flex items-center justify-between gap-3">
                <span className="text-sm text-zinc-300">
                  {name.replace(/_/g, " ")}
                </span>
                <span className="font-mono text-sm tabular-nums text-zinc-400">
                  {s.scored === 0 ? "not scored yet" : `${s.passed}/${s.scored}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

function ReasonBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n), 1);

  return (
    <div className="space-y-2.5 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      {entries.map(([reason, count]) => (
        <div key={reason} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-3">
          <span className="text-sm text-zinc-300">{reasonLabel[reason] ?? reason}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-[#D6FF3D]"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="text-right font-mono text-sm tabular-nums text-zinc-400">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

function CrossTable({
  title,
  rows,
  rowLabel,
  data,
}: {
  title: string;
  rows: string[];
  rowLabel: (row: string) => string;
  data: Record<string, Record<string, number>>;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm italic text-zinc-600">Not enough calls yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => {
            const inner = Object.entries(data[row] ?? {}).sort((a, b) => b[1] - a[1]);
            return (
              <li key={row}>
                <p className="text-xs font-semibold text-zinc-400">{rowLabel(row)}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {inner.map(([reason, count]) => (
                    <span
                      key={reason}
                      className="rounded border border-zinc-800 bg-black px-2 py-0.5 text-[11px] text-zinc-400"
                    >
                      {reasonLabel[reason] ?? reason} · {count}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Small({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-black p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
