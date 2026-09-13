"use client";

import { useEffect, useRef } from "react";
import { fieldSpec } from "@/lib/gymConfig";
import { OFFER_LABEL, type Preview } from "@/lib/onboardingDraft";
import { callTypeLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/incentives";

/**
 * The architecture on one screen: typed answers on the left, the exact text
 * the agent receives on the right, compiled by the same code a live call uses
 * and checked by the same validator. No sentence in this panel was typed by a
 * person or written by a model, and no branch in it lives in a prompt.
 *
 * Ordered like the form — facts about the gym, then what Charlie may offer — so
 * the part being edited is the part in view.
 */

/** Who each block is for, in the form's own words. */
const AUDIENCE: Record<string, string> = {
  renewal: "members due to renew",
  reengagement: "members who've stopped coming",
  winback: "members whose membership has ended",
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
 * which of the three blocks the change landed in (see `.compiled-text` in
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
      className="compiled-text mt-2 rounded-xl border border-zinc-900 bg-black px-3.5 py-3 font-mono text-[0.8125rem] leading-[1.65] text-zinc-300 wrap-anywhere"
    >
      {text}
    </p>
  );
}

export default function PromptPreview({
  preview,
  showWarnings,
  discount,
  tierName,
  tierPrice,
}: {
  preview: Preview;
  /** False while someone is mid-way through typing a value. */
  showWarnings: boolean;
  discount: number | null;
  tierName: string | null;
  tierPrice: number | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 id={PREVIEW_TITLE_ID} className="text-lg font-black uppercase tracking-tight text-white">
        What Charlie will be told
      </h2>
      <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-zinc-400">
        The facts are your answers, word for word. The offer text for each call is written by the app from your
        answers — none of it is typed by a person or written by AI — and checked before it can be used.
      </p>

      {showWarnings && (preview.excluded.length > 0 || preview.tierIncomplete) && (
        <ul className="mt-4 space-y-1 text-xs leading-relaxed text-amber-200">
          {preview.excluded.length > 0 && (
            <li>
              <span className="font-semibold text-amber-300">Check this:</span> treated as not stated until fixed —{" "}
              {preview.excluded.map((k) => fieldSpec(k).shortLabel).join(", ")}.
            </li>
          )}
          {preview.tierIncomplete && (
            <li>
              <span className="font-semibold text-amber-300">Check this:</span> the cheaper membership needs both a name
              and a monthly price before Charlie can mention it.
            </li>
          )}
        </ul>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-white">Facts Charlie may state</h3>
        <dl className="mt-2 divide-y divide-zinc-900 rounded-xl border border-zinc-900 bg-black px-3.5">
          {FACT_ROWS.map((row) => (
            <div key={row.key} className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-xs text-zinc-400">{row.label}</dt>
              <dd className="font-mono text-xs leading-relaxed text-zinc-300 wrap-anywhere">{preview.facts[row.key]}</dd>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-xs text-zinc-400">Renewal price</dt>
            <dd className="text-xs leading-relaxed text-zinc-400">From each member&apos;s own contract.</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 space-y-5 border-t border-zinc-900 pt-5">
        {preview.blocks.map((block) => (
          <div key={block.callType}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">
                {callTypeLabel[block.callType]} call{" "}
                <span className="font-normal text-zinc-400">· {AUDIENCE[block.callType]}</span>
              </h3>
              <p className={`text-xs font-semibold ${block.ok ? "text-signal" : "text-red-300"}`}>
                {block.ok ? "Checked" : "Failed the check"}
              </p>
            </div>
            <CompiledText text={block.text} />
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              {block.offers.length === 0 ? (
                "Offers nothing, and tells Charlie not to offer anything."
              ) : (
                <>
                  Offers{" "}
                  {block.offers
                    .map((o) =>
                      o === "renewal_discount" && discount !== null
                        ? `${discount}% off the renewal`
                        : o === "cheaper_tier" && tierName && tierPrice !== null
                          ? `the ${tierName} at ${formatMoney(tierPrice)} a month`
                          : `a ${OFFER_LABEL[o]}`
                    )
                    .join(" and ")}
                  , then tells Charlie that&apos;s everything he has.
                </>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Sent to Charlie as <code className="font-mono">{"{{incentives}}"}</code>
            </p>
            {!block.ok && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-300">
                {block.violations.map((v, i) => (
                  <li key={`${v.rule}-${i}`}>{v.message}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
