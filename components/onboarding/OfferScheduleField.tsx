"use client";

/**
 * "Every [period], allow the agent to offer [offer]". The offer choices are the
 * offers this gym's own answers configure, so a gym can't schedule something it
 * never set up. The rule itself is enforced in lib/eligibility.ts before a
 * call's incentives are compiled; this only records the choice.
 *
 * Each row's state pill is read from the row and the configured offers, nothing
 * else, in `draftSchedule`'s order: "incomplete" until both selects are chosen
 * (a half-chosen row blocks the save, whatever it names), then "not configured"
 * for an offer the answers no longer grant (the row is ignored), "never" for a
 * never row, "ready" otherwise.
 *
 * `evaluateOffers` in lib/eligibility.ts applies no limit and no habit rule to
 * a call for a member who has asked to cancel, so the one schedulable offer
 * that call carries — the cheaper membership — says so wherever its limit is
 * shown.
 */
import {
  OFFER_PERIODS,
  scheduledOfferLabel,
  type GymFields,
  type OfferPeriod,
  type SchedulableOffer,
} from "@/lib/gymConfig";
import type { Draft } from "@/lib/onboardingDraft";
import { Pill, focusRing, type PillTone } from "./ui";

export const PERIOD_OPTION: Record<OfferPeriod, string> = {
  monthly: "month",
  quarterly: "quarter",
  twice_yearly: "six months",
  yearly: "year",
  never: "— never —",
};

type Rows = Draft["offer_schedule"];

export type RowState = "ready" | "never" | "not_configured" | "incomplete";

export function scheduleRowState(row: Rows[number], configured: SchedulableOffer[]): RowState {
  if (!row.offer || !row.period) return "incomplete";
  if (!configured.includes(row.offer)) return "not_configured";
  if (row.period === "never") return "never";
  return "ready";
}

/** The offer a cancellation call carries regardless of its limit (lib/eligibility.ts). */
export const UNLIMITED_ON_CANCELLATION: SchedulableOffer = "cheaper_tier";

const ROW_STATE: Record<RowState, { label: string; tone: PillTone }> = {
  ready: { label: "ready", tone: "accent" },
  never: { label: "never offered", tone: "plain" },
  not_configured: { label: "not configured — ignored", tone: "flag" },
  incomplete: { label: "choose both", tone: "flag" },
};

function rowPill(row: Rows[number], state: RowState): { label: string; tone: PillTone } {
  if (state === "never" && row.offer === UNLIMITED_ON_CANCELLATION) return { label: "never · except cancellations", tone: "plain" };
  if (state === "ready" && row.offer === UNLIMITED_ON_CANCELLATION) return { label: "ready · except cancellations", tone: "accent" };
  return ROW_STATE[state];
}

const SELECT =
  "h-[34px] rounded-[9px] border border-control-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink outline-none hover:border-accent-line focus:border-accent-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line";

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
    <fieldset data-field="offer_schedule" className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="sr-only">How often each offer can be made</legend>
      <p className="max-w-[66ch] text-[12.5px] leading-[1.5] text-muted text-pretty">
        How often one member can get each offer. No limit means every call. Cancellation calls ignore these limits.
      </p>
      {configured.length === 0 && rows.length === 0 && (
        <p className="rounded-[11px] border border-dashed border-line-strong bg-canvas px-[13px] py-[11px] text-[12.5px] text-dim">
          Choose an offer above first.
        </p>
      )}
      {rows.map((row, i) => {
        const state = scheduleRowState(row, configured);
        const pill = rowPill(row, state);
        // The offer is no longer one the answers grant. Ignored once both are
        // chosen; until then the row blocks the save like any half-chosen row.
        const gone = row.offer !== "" && !configured.includes(row.offer);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2.5 rounded-[11px] border border-line bg-canvas px-[13px] py-[11px]">
            <span className="text-[13px] text-muted">Every</span>
            <select
              aria-label={`Limit ${i + 1}: how often`}
              value={row.period}
              onChange={(e) => update(i, { period: e.target.value as OfferPeriod | "" })}
              className={SELECT}
            >
              <option value="">choose…</option>
              {OFFER_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_OPTION[p]}
                </option>
              ))}
            </select>
            <span className="text-[13px] text-muted">allow the agent to offer</span>
            <select
              aria-label={`Limit ${i + 1}: offer`}
              value={row.offer}
              onChange={(e) => update(i, { offer: e.target.value as SchedulableOffer | "" })}
              className={SELECT}
            >
              <option value="">choose…</option>
              {[...new Set([...configured, ...(gone ? [row.offer as SchedulableOffer] : [])])].map((o) => (
                <option key={o} value={o} disabled={o !== row.offer && used.has(o)}>
                  {scheduledOfferLabel(o, fields)}
                </option>
              ))}
            </select>
            <Pill tone={pill.tone}>{pill.label}</Pill>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              aria-label={`Remove limit ${i + 1}`}
              title="Remove this limit"
              className={`ml-auto grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border border-control-line text-[15px] text-dim transition-colors hover:border-flag hover:text-flag-ink ${focusRing}`}
            >
              ×
            </button>
            {gone && (
              <p className="basis-full text-[11.5px] text-flag-ink">
                {state === "not_configured"
                  ? "This gym doesn't offer that any more, so this row is ignored."
                  : "This gym doesn't offer that any more. Remove this row."}
              </p>
            )}
          </div>
        );
      })}
      {next && (
        <button
          type="button"
          onClick={() => onChange([...rows, { offer: next, period: "" }])}
          className={`mt-0.5 h-[34px] self-start rounded-[9px] border border-control-line bg-control px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:border-accent-line ${focusRing}`}
        >
          Add a limit
        </button>
      )}
      {error && <p className="text-[11.5px] font-semibold text-flag-ink">{error}</p>}
    </fieldset>
  );
}
