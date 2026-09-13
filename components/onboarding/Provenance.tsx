"use client";

import type { FieldOutcome } from "@/lib/extraction/sanitize";
import { Button } from "./ui";

/**
 * Where a prefilled value came from, under its field.
 *
 * A gym owner checking eleven fields needs to see why the discount says 20%.
 * The sentence from the document turns the review from a chore into a
 * verification. A value with no sentence behind it was not prefilled at all; it
 * is shown as something to check, with the extractor's suggestion one click
 * away, so accepting a guess is a decision someone makes rather than a default
 * they miss.
 */

function QuoteText({ text }: { text: string }) {
  return (
    <blockquote className="m-0 text-[11.5px] leading-[1.45] text-ink-2 text-pretty wrap-anywhere">
      <span aria-hidden="true">“</span>
      {text}
      <span aria-hidden="true">”</span>
    </blockquote>
  );
}

function Source({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-dim wrap-anywhere">{children}</span>;
}

export default function Provenance({
  outcome,
  fileName,
  changed,
  accepted,
  suggestionLabel,
  onUseSuggestion,
}: {
  outcome: FieldOutcome;
  fileName: string;
  /** The field no longer holds the value the document supplied. */
  changed: boolean;
  /** The person accepted an unsupported suggestion. */
  accepted: boolean;
  suggestionLabel: string | null;
  onUseSuggestion: () => void;
}) {
  if (outcome.status === "blank") {
    return (
      <p className="text-[11.5px] text-dim">
        Not in <span className="font-mono text-[11px] text-muted wrap-anywhere">{fileName}</span>.
      </p>
    );
  }

  if (outcome.status === "filled") {
    return (
      <div className="flex gap-[9px] rounded-[9px] border border-accent-line bg-accent-wash px-[11px] py-[9px]">
        <span aria-hidden="true" className="text-[11px] font-bold text-accent-ink">
          ✓
        </span>
        <div className="flex min-w-0 flex-col gap-[3px]">
          {changed && <span className="text-[11.5px] font-bold text-ink">You changed this. The document says:</span>}
          <QuoteText text={outcome.quote} />
          <Source>found in {fileName}</Source>
        </div>
      </div>
    );
  }

  if (outcome.status === "unsupported") {
    return (
      <div className="flex flex-col gap-2 rounded-[9px] border border-line-strong bg-surface-2 px-[11px] py-[9px]">
        <p className="text-[11.5px] leading-[1.45] text-ink-2 text-pretty">
          <strong className="text-ink">
            {accepted ? "You filled this in. The document doesn't back it up." : "Couldn't support this, so it's left blank."}
          </strong>{" "}
          {outcome.reason}
        </p>
        {outcome.quote && <QuoteText text={outcome.quote} />}
        {!accepted && suggestionLabel && (
          <div>
            <Button variant="secondary" onClick={onUseSuggestion}>
              Use {suggestionLabel}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[9px] border border-line-strong bg-surface-2 px-[11px] py-[9px]">
      <p className="text-[11.5px] leading-[1.45] text-ink-2 text-pretty">
        <strong className="text-ink">Not used from the document.</strong> {outcome.reason}
      </p>
      {outcome.quote && <QuoteText text={outcome.quote} />}
    </div>
  );
}
