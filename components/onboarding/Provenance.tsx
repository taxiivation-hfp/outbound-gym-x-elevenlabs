"use client";

import type { FieldOutcome } from "@/lib/extraction/sanitize";
import { Button, Literal } from "./ui";

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

function Quote({ text, framed = true }: { text: string; framed?: boolean }) {
  return (
    <blockquote
      className={`text-xs leading-relaxed text-pretty wrap-anywhere ${
        framed ? "rounded-lg border border-zinc-900 bg-zinc-950/60 px-3 py-2 text-zinc-300" : "text-amber-100"
      }`}
    >
      <span aria-hidden="true">“</span>
      {text}
      <span aria-hidden="true">”</span>
    </blockquote>
  );
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
      <p className="text-xs text-zinc-400">
        Not in <Literal className="text-xs text-zinc-400">{fileName}</Literal>.
      </p>
    );
  }

  if (outcome.status === "filled") {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-400">
          {changed ? (
            <>
              <span className="font-semibold text-zinc-200">You changed this.</span>{" "}
              <Literal className="text-xs text-zinc-400">{fileName}</Literal> says:
            </>
          ) : (
            <>
              From <Literal className="text-xs text-zinc-400">{fileName}</Literal>:
            </>
          )}
        </p>
        <Quote text={outcome.quote} />
      </div>
    );
  }

  if (outcome.status === "unsupported") {
    return (
      <div className="space-y-2 rounded-lg border border-amber-800/70 bg-amber-950/30 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-amber-200">
          <span className="font-semibold text-amber-300">
            {accepted ? "You filled this in — the document doesn't back it up." : "Check this — not filled in."}
          </span>{" "}
          {outcome.reason}
        </p>
        {outcome.quote && <Quote text={outcome.quote} framed={false} />}
        {!accepted && suggestionLabel && (
          <Button variant="secondary" tone="caution" onClick={onUseSuggestion}>
            Use {suggestionLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-800/70 bg-amber-950/30 px-3 py-2.5">
      <p className="text-xs leading-relaxed text-amber-200">
        <span className="font-semibold text-amber-300">Not used from the document.</span> {outcome.reason}
      </p>
      {outcome.quote && <Quote text={outcome.quote} framed={false} />}
    </div>
  );
}
