"use client";

import { useEffect, useRef } from "react";
import { CALL_TYPE_TINT } from "@/components/calls/format";
import type { CallType } from "@/lib/callType";
import { OFFER_PERIOD_LABEL, fieldSpec, hasCheaperTier, scheduledOfferLabel, type GymFieldKey, type GymFields } from "@/lib/gymConfig";
import { OFFER_LABEL, isDraftBlank, type Draft, type Preview } from "@/lib/onboardingDraft";
import { callTypeLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/incentives";
import { UNLIMITED_ON_CANCELLATION } from "./OfferScheduleField";
import { Pill } from "./ui";

/**
 * The architecture on one screen: typed answers on the left, the exact text
 * the agent receives on the right, compiled by the same code a live call uses
 * and checked by the same validator. No sentence in this panel was typed by a
 * person or written by a model, and no branch in it lives in a prompt.
 */

/** Who each block is for, in the form's own words. */
const AUDIENCE: Record<CallType, string> = {
  renewal: "members due to renew",
  reengagement: "members who've stopped coming",
  winback: "members whose membership has ended",
  cancellation: "members who have asked to cancel",
};

/**
 * The answers each call type's block is compiled from (see
 * `incentiveSentenceIds` in lib/incentives.ts). A pair is one answer with two
 * halves, and counts as unsaid only when both halves are blank; a half-filled
 * pair is named by the warnings above instead. `readWhen` narrows an answer to
 * the branch of `incentiveSentenceIds` that actually reads it.
 */
const READS: Record<CallType, Array<{ label: string; keys: GymFieldKey[]; readWhen?: (fields: GymFields) => boolean }>> = {
  renewal: [{ label: fieldSpec("renewal_discount_percent").shortLabel, keys: ["renewal_discount_percent"] }],
  reengagement: [{ label: fieldSpec("reengagement_perk").shortLabel, keys: ["reengagement_perk"] }],
  winback: [
    { label: fieldSpec("winback_offer").shortLabel, keys: ["winback_offer"] },
    { label: "cheaper membership", keys: ["cheaper_tier_name", "cheaper_tier_price"] },
    {
      label: fieldSpec("quiet_hours").shortLabel,
      keys: ["quiet_hours"],
      // Only the winback block with no offer and no cheaper membership mentions quiet times.
      readWhen: (f) => (f.winback_offer === null || f.winback_offer === "none") && !hasCheaperTier(f),
    },
  ],
  cancellation: [
    { label: "membership freeze", keys: ["freeze_max_weeks", "freeze_weekly_fee"] },
    { label: "cheaper membership", keys: ["cheaper_tier_name", "cheaper_tier_price"] },
  ],
};

const FACT_ROWS: Array<{ key: keyof Preview["facts"]; label: string }> = [
  { key: "opening_hours", label: "Open" },
  { key: "quiet_hours", label: "Quiet times" },
  { key: "other_locations", label: "Other locations" },
  { key: "has_online", label: "Online training" },
  { key: "books_classes", label: "Can book classes" },
];

export const PREVIEW_TITLE_ID = "preview-title";

/**
 * One call's compiled text. Typing a price or a membership name rewrites it on
 * every keystroke, so the words themselves never fade or remount — they stay
 * readable mid-edit. What marks a rewrite is the block's edge, which shows
 * which of the four blocks the change landed in (see `.compiled-text` in
 * globals.css). The first render isn't a rewrite and isn't marked.
 */
function CompiledText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const previous = useRef(text);

  useEffect(() => {
    const el = ref.current;
    if (!el || previous.current === text) return;
    previous.current = text;
    el.dataset.rewritten = "";
    // Commit the lit edge before removing it, or the browser folds the two
    // changes together and nothing is seen.
    void getComputedStyle(el).borderColor;
    delete el.dataset.rewritten;
  }, [text]);

  return (
    <p
      ref={ref}
      className="compiled-text m-0 rounded-[9px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2 text-pretty wrap-anywhere"
    >
      {text}
    </p>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.09em] text-dim">{children}</h3>;
}

export default function PromptPreview({
  preview,
  draft,
  showWarnings,
  discount,
  tierName,
  tierPrice,
}: {
  preview: Preview;
  /** The draft the preview was compiled from, to say which answers are still unsaid. */
  draft: Draft;
  /** False while someone is mid-way through typing a value. */
  showWarnings: boolean;
  discount: number | null;
  tierName: string | null;
  tierPrice: number | null;
}) {
  const unsaid = (callType: CallType) =>
    READS[callType]
      .filter((r) => (r.readWhen ? r.readWhen(preview.fields) : true) && r.keys.every((k) => isDraftBlank(draft, k)))
      .map((r) => r.label);

  // Offer cadence: every offer the answers configure, with its limit from the
  // schedule rows, and any row that names an offer the answers no longer grant.
  const rowFor = (offer: string) => draft.offer_schedule.find((r) => r.offer === offer);
  const cadence = preview.configured.map((offer) => {
    const row = rowFor(offer);
    const freq = !row ? "no limit" : !row.period ? "not chosen yet" : row.period === "never" ? "never" : `every ${OFFER_PERIOD_LABEL[row.period]}`;
    // A cancellation call applies no limit (lib/eligibility.ts), so a limit on
    // the offer that call carries says where it stops.
    const except = offer === UNLIMITED_ON_CANCELLATION && row?.period ? "not on cancellations" : null;
    return { key: offer, offer: scheduledOfferLabel(offer, preview.fields), freq, except, quiet: freq === "never" || freq === "no limit" };
  });
  // Ignored only once both selects are chosen; a half-chosen row blocks the save instead (draftSchedule).
  const ignored = draft.offer_schedule.filter((r) => r.offer !== "" && r.period !== "" && !preview.configured.includes(r.offer)).length;

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-line-strong bg-surface p-[18px] shadow-window">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id={PREVIEW_TITLE_ID} className="m-0 font-display text-[17px] font-bold tracking-[-0.02em] text-ink">
          What the agent will say
        </h2>
        <span className="ml-auto text-[11.5px] text-dim">rewritten as you type</span>
      </div>

      {showWarnings && (preview.excluded.length > 0 || preview.tierIncomplete || preview.freezeIncomplete || preview.otherIncomplete.length > 0) && (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-[11px] border border-flag bg-flag-wash px-3 py-2.5 text-[11.5px] leading-[1.45] text-ink-2">
          {preview.excluded.length > 0 && (
            <li>
              <strong className="text-flag-ink">Check this:</strong> treated as not stated until fixed —{" "}
              {preview.excluded.map((k) => fieldSpec(k).shortLabel).join(", ")}.
            </li>
          )}
          {preview.tierIncomplete && (
            <li>
              <strong className="text-flag-ink">Check this:</strong> the cheaper membership needs both a name and a monthly
              price before Charlie can mention it.
            </li>
          )}
          {preview.freezeIncomplete && (
            <li>
              <strong className="text-flag-ink">Check this:</strong> the freeze needs both its longest pause and a weekly fee
              (0 if it&apos;s free) before Charlie can offer it.
            </li>
          )}
          {preview.otherIncomplete.map((slot) => (
            <li key={slot}>
              <strong className="text-flag-ink">Check this:</strong> &ldquo;Something else&rdquo; for{" "}
              {slot === "reengagement" ? "a member who's stopped coming" : "a lapsed member"} needs its name and how it&apos;s
              delivered before Charlie can offer it.
            </li>
          ))}
        </ul>
      )}

      {preview.blocks.map((block) => {
        const tint = CALL_TYPE_TINT[block.callType];
        const left = unsaid(block.callType);
        return (
          <div key={block.callType} className="flex flex-col gap-[9px] rounded-xl border border-line bg-canvas p-3.5">
            <div className="flex flex-wrap items-center gap-x-[9px] gap-y-1">
              <h3 className={`m-0 rounded-md px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.11em] ${tint.bg} ${tint.ink}`}>
                {callTypeLabel[block.callType]}
              </h3>
              <span className="text-[11.5px] text-dim">{AUDIENCE[block.callType]}</span>
              <span className="ml-auto">
                <Pill tone={block.ok ? "accent" : "flag"}>{block.ok ? "checked" : "failed the check"}</Pill>
              </span>
            </div>
            <CompiledText text={block.text} />
            {block.offers.length > 0 && (
              <p className="text-[11.5px] leading-[1.45] text-muted text-pretty">
                <>
                  Offers{" "}
                  {block.offers
                    .map((o) =>
                      o === "renewal_discount" && discount !== null
                        ? `${discount}% off the renewal`
                        : o === "cheaper_tier" && tierName && tierPrice !== null
                          ? `the ${tierName} at ${formatMoney(tierPrice)} a month`
                          : o === "freeze" && preview.fields.freeze_max_weeks !== null && preview.fields.freeze_weekly_fee !== null
                            ? `a freeze of up to ${preview.fields.freeze_max_weeks} weeks${preview.fields.freeze_weekly_fee > 0 ? ` at ${formatMoney(preview.fields.freeze_weekly_fee)} a week` : ", free"}`
                            : o === "other"
                              ? "an offer of the gym's own"
                              : `a ${OFFER_LABEL[o]}`
                    )
                    .join(" and ")}
                  .
                </>
              </p>
            )}
            {left.length > 0 && (
              <p className="text-[11.5px] leading-[1.45] text-dim text-pretty">Not set: {left.join(", ")}.</p>
            )}
            {!block.ok && (
              <ul className="m-0 list-disc space-y-1 pl-5 text-[11.5px] text-flag-ink">
                {block.violations.map((v, i) => (
                  <li key={`${v.rule}-${i}`}>{v.message}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <div className="flex flex-col gap-2 border-t border-line pt-[13px]">
        <Eyebrow>Facts Charlie may state</Eyebrow>
        <dl className="m-0 flex flex-col gap-1.5">
          {FACT_ROWS.map((row) => (
            <div key={row.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2.5 text-[12px]">
              <dt className="text-dim">{row.label}</dt>
              <dd className="m-0 font-mono text-[11.5px] leading-relaxed text-ink-2 wrap-anywhere">{preview.facts[row.key]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-[7px] border-t border-line pt-[13px]">
        <Eyebrow>Offer cadence</Eyebrow>
        {cadence.length === 0 ? (
          <p className="text-[12px] text-dim">No offers yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
            {cadence.map((c) => (
              <li key={c.key} className="flex items-baseline gap-[9px] text-[12.5px]">
                <span className="min-w-0 flex-1 text-ink-2 wrap-anywhere">{c.offer}</span>
                <span className="text-right">
                  <span className={`text-[11.5px] font-bold uppercase tracking-[0.05em] ${c.quiet ? "text-dim" : "text-accent-ink"}`}>{c.freq}</span>
                  {c.except && <span className="block text-[11px] text-dim">{c.except}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {ignored > 0 && (
          <p className="text-[11.5px] text-flag-ink">
            {ignored} limit{ignored === 1 ? " names an offer" : "s name offers"} the answers no longer configure, so {ignored === 1 ? "it is" : "they are"} ignored.
          </p>
        )}
      </div>
    </div>
  );
}
