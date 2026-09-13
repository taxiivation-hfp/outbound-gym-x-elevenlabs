"use client";

/**
 * PLACEHOLDER UI — pass one. Correct data, plain layout, no design investment.
 * Pass three replaces this component wholesale; don't polish it.
 *
 * "Every [period], allow the agent to offer [offer]". The offer choices are the
 * offers this gym's own answers above configure, so a gym can't schedule
 * something it never set up. The rule itself is enforced in lib/eligibility.ts
 * before a call's incentives are compiled; this only records the choice.
 */
import {
  OFFER_PERIODS,
  scheduledOfferLabel,
  type GymFields,
  type OfferPeriod,
  type SchedulableOffer,
} from "@/lib/gymConfig";
import type { Draft } from "@/lib/onboardingDraft";

const PERIOD_OPTION: Record<OfferPeriod, string> = {
  monthly: "month",
  quarterly: "quarter",
  twice_yearly: "six months",
  yearly: "year",
  never: "— never —",
};

type Rows = Draft["offer_schedule"];

export default function OfferScheduleField({
  rows,
  configured,
  onChange,
  error,
  fields,
}: {
  /** The answers so far, so an "other" offer is listed by the gym's own name for it. */
  fields: GymFields | null;
  rows: Rows;
  configured: SchedulableOffer[];
  onChange: (rows: Rows) => void;
  error?: string;
}) {
  const used = new Set(rows.map((r) => r.offer));
  const next = configured.find((o) => !used.has(o));
  const update = (i: number, patch: Partial<Rows[number]>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <fieldset data-field="offer_schedule" className="space-y-2">
      <legend className="text-sm font-semibold text-white">
        How often each offer can be made<span className="ml-1.5 text-xs font-normal text-zinc-400">optional</span>
      </legend>
      <p className="text-xs text-zinc-400">
        Per member, per offer. An offer with no limit here can be made on every call it applies to. &ldquo;Never&rdquo; switches
        it off. Offers only ever go to members who stopped coming after a regular habit, or to renewals.
      </p>
      {configured.length === 0 && rows.length === 0 && (
        <p className="text-xs text-zinc-500">This gym has no offers yet, so there is nothing to limit.</p>
      )}
      {rows.map((row, i) => {
        const stale = row.offer !== "" && !configured.includes(row.offer);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            <span>Every</span>
            <select
              aria-label="How often"
              value={row.period}
              onChange={(e) => update(i, { period: e.target.value as OfferPeriod | "" })}
              className="rounded border border-zinc-600 bg-zinc-950 px-2 py-1"
            >
              <option value="">choose…</option>
              {OFFER_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_OPTION[p]}
                </option>
              ))}
            </select>
            <span>allow the agent to offer</span>
            <select
              aria-label="Offer"
              value={row.offer}
              onChange={(e) => update(i, { offer: e.target.value as SchedulableOffer | "" })}
              className="rounded border border-zinc-600 bg-zinc-950 px-2 py-1"
            >
              <option value="">choose…</option>
              {[...new Set([...configured, ...(stale ? [row.offer as SchedulableOffer] : [])])].map((o) => (
                <option key={o} value={o} disabled={o !== row.offer && used.has(o)}>
                  {scheduledOfferLabel(o, fields)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-xs text-zinc-400 underline">
              Remove
            </button>
            {stale && <span className="text-xs text-amber-300">This gym doesn&apos;t offer that any more, so this row is ignored.</span>}
          </div>
        );
      })}
      {next && (
        <button type="button" onClick={() => onChange([...rows, { offer: next, period: "" }])} className="text-xs text-zinc-300 underline">
          Add a limit
        </button>
      )}
      {error && <p className="text-xs font-medium text-red-300">{error}</p>}
    </fieldset>
  );
}
