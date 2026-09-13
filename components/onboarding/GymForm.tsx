"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExtractionReview } from "@/lib/extraction/sanitize";
import {
  FIELD_SPECS,
  fieldSpec,
  type FieldErrors,
  type GymFieldKey,
  type ReengagementPerk,
  type WinbackOffer,
} from "@/lib/gymConfig";
import { formatMoney } from "@/lib/incentives";
import { isDraftBlank, valueToDraft, type Draft } from "@/lib/onboardingDraft";
import { AffixField, ChoiceField, ListField, TextField, type FieldChrome } from "./fields";
import Provenance from "./Provenance";
import { AdminDetail, Button, Literal, Notice, SectionTitle, focusRing } from "./ui";

/**
 * The review screen's form. Both onboarding paths arrive here — empty from
 * "fill it in by hand", prefilled from a document — and it is the only way a
 * gym is saved, so every value a document supplied has been in front of a
 * person first.
 *
 * The Save bar is a separate component attached to this form by id, so on a
 * narrow screen it can sit below the preview of what Charlie will be told
 * rather than above it.
 */

export const GYM_FORM_ID = "gym-form";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string; errors?: FieldErrors };

function suggestionLabel(key: GymFieldKey, value: unknown): string | null {
  const spec = fieldSpec(key);
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "“yes”" : "“no”";
  if (key === "renewal_discount_percent" && typeof value === "number") return `${value}%`;
  if (key === "cheaper_tier_price" && typeof value === "number") return `${formatMoney(value)} a month`;
  if (Array.isArray(value)) return value.map((v) => `“${v}”`).join(", ");
  if (spec.kind === "enum" && typeof value === "string") {
    return `“${(spec.optionLabels?.[value] ?? value).replace(/ \(.*\)$/, "")}”`;
  }
  return `“${String(value)}”`;
}

function sameValue(key: GymFieldKey, draft: Draft, value: unknown): boolean {
  return JSON.stringify(draft[key]) === JSON.stringify(valueToDraft(key, value));
}

/** Focus a field from a summary link: the chosen option of a choice, or the input. */
function focusField(key: GymFieldKey) {
  const container = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!container) return;
  const target =
    container.querySelector<HTMLInputElement>("input[type=radio]:checked") ??
    container.querySelector<HTMLInputElement>("input:not([type=radio])") ??
    container.querySelector<HTMLInputElement>("input");
  container.scrollIntoView({ block: "center", behavior: "auto" });
  target?.focus({ preventScroll: true });
}

export default function GymForm({
  draft,
  onChange,
  validationErrors,
  review,
  fileName,
  saveAvailable,
  saveState,
  onSave,
}: {
  draft: Draft;
  onChange: <K extends GymFieldKey>(key: K, value: Draft[K]) => void;
  /** Current parse errors for the whole draft. Shown per field once touched. */
  validationErrors: FieldErrors;
  review: ExtractionReview | null;
  fileName: string | null;
  saveAvailable: boolean;
  saveState: SaveState;
  onSave: () => void;
}) {
  const [touched, setTouched] = useState<Partial<Record<GymFieldKey, boolean>>>({});
  const [attempts, setAttempts] = useState(0);
  const [accepted, setAccepted] = useState<Partial<Record<GymFieldKey, boolean>>>({});
  const summaryRef = useRef<HTMLDivElement>(null);

  const serverErrors = saveState.kind === "error" ? (saveState.errors ?? {}) : {};
  const errorFor = (key: GymFieldKey): string | undefined =>
    serverErrors[key] ?? (touched[key] || attempts > 0 ? validationErrors[key] : undefined);

  const touch = (key: GymFieldKey) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  const fieldErrorKeys = (Object.keys(validationErrors) as Array<GymFieldKey | "_form" | "gym_id">).filter(
    (k): k is GymFieldKey => k !== "_form" && k !== "gym_id"
  );

  // After a Save press finds problems, the summary has rendered by the time this
  // runs, so focus lands on it — on the first press, not the second.
  useEffect(() => {
    if (attempts > 0 && fieldErrorKeys.length > 0) summaryRef.current?.focus();
    // Only a new attempt moves focus; typing a fix must not pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  const chrome = (key: GymFieldKey, extra: Partial<FieldChrome> = {}): FieldChrome => {
    const spec = fieldSpec(key);
    const outcome = review?.outcomes[key];
    return {
      label: spec.label,
      required: spec.required,
      blankNote: spec.whenBlank,
      blank: isDraftBlank(draft, key) || draft[key] === "none",
      blankLabel: draft[key] === "none" ? "Nothing:" : "Not stated:",
      error: errorFor(key),
      provenance:
        outcome && fileName ? (
          <Provenance
            outcome={outcome}
            fileName={fileName}
            changed={outcome.status === "filled" && !sameValue(key, draft, outcome.value)}
            accepted={Boolean(accepted[key])}
            suggestionLabel={outcome.status === "unsupported" ? suggestionLabel(key, outcome.suggestion) : null}
            onUseSuggestion={() => {
              if (outcome.status !== "unsupported") return;
              onChange(key, valueToDraft(key, outcome.suggestion));
              setAccepted((a) => ({ ...a, [key]: true }));
              touch(key);
              // The button just pressed disappears with this change. Focus goes to
              // the value it filled in, which is also the thing to look at next.
              requestAnimationFrame(() => focusField(key));
            }}
          />
        ) : undefined,
      ...extra,
    };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!saveAvailable || saveState.kind === "saving") return;
    setAttempts((n) => n + 1);
    if (fieldErrorKeys.length > 0) return;
    onSave();
  };

  const flagged = review
    ? FIELD_SPECS.filter((s) => review.outcomes[s.key].status === "unsupported" || review.outcomes[s.key].status === "rejected")
    : [];

  return (
    <form id={GYM_FORM_ID} onSubmit={submit} noValidate className="space-y-10">
      {review && fileName && (
        <div className="max-w-xl">
          <Notice tone={flagged.length > 0 ? "caution" : "info"} title={`Prefilled from ${fileName}`}>
            <p>
              {review.summary.filled} answer{review.summary.filled === 1 ? "" : "s"} came from the document, each shown
              with the sentence it came from. {review.summary.blank} {review.summary.blank === 1 ? "isn't" : "aren't"} in
              the document and {review.summary.blank === 1 ? "is" : "are"} left as not stated.
              {flagged.length > 0 && (
                <>
                  {" "}
                  {flagged.length} to check:{" "}
                  {flagged.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 ? ", " : ""}
                      <button
                        type="button"
                        onClick={() => focusField(s.key)}
                        className={`rounded-sm underline decoration-amber-600 underline-offset-2 hover:decoration-amber-300 ${focusRing}`}
                      >
                        {s.shortLabel}
                      </button>
                    </span>
                  ))}
                  .
                </>
              )}{" "}
              Nothing is saved until you press Save gym.
            </p>
            {review.ignored_keys.length > 0 && (
              <p className="mt-1">
                The document reader also returned{" "}
                {review.ignored_keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? (i === review.ignored_keys.length - 1 ? " and " : ", ") : ""}
                    <Literal className="text-amber-100">{k}</Literal>
                  </span>
                ))}
                , which {review.ignored_keys.length === 1 ? "isn't a question" : "aren't questions"} on this form, so{" "}
                {review.ignored_keys.length === 1 ? "it was" : "they were"} ignored.
              </p>
            )}
          </Notice>
        </div>
      )}

      {attempts > 0 && fieldErrorKeys.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="form-error-summary-title"
          className="max-w-xl rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          <Notice
            tone="fault"
            titleId="form-error-summary-title"
            title={`${fieldErrorKeys.length} answer${fieldErrorKeys.length === 1 ? " needs" : "s need"} fixing before saving`}
          >
            <ul className="list-disc space-y-0.5 pl-5">
              {fieldErrorKeys.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => focusField(key)}
                    className={`rounded-sm text-left underline decoration-red-700 underline-offset-2 hover:decoration-red-300 ${focusRing}`}
                  >
                    {fieldSpec(key).label}
                  </button>{" "}
                  — {validationErrors[key]}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <section aria-labelledby="about-gym" className="space-y-6">
        <div>
          <SectionTitle id="about-gym">The gym</SectionTitle>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-zinc-400">
            Facts Charlie can state if a member asks. Write them the way you&apos;d say them on the phone.
          </p>
        </div>
        <div className="max-w-xl space-y-6">
          <TextField
            name="gym_name"
            chrome={chrome("gym_name", { hint: "Charlie says this in his first sentence: “It's Charlie from …”" })}
            value={draft.gym_name}
            onChange={(v) => onChange("gym_name", v)}
            onBlur={() => touch("gym_name")}
            placeholder={fieldSpec("gym_name").example}
          />
          <TextField
            name="opening_hours"
            chrome={chrome("opening_hours")}
            value={draft.opening_hours}
            onChange={(v) => onChange("opening_hours", v)}
            onBlur={() => touch("opening_hours")}
            placeholder={fieldSpec("opening_hours").example}
          />
          <TextField
            name="quiet_hours"
            chrome={chrome("quiet_hours")}
            value={draft.quiet_hours}
            onChange={(v) => onChange("quiet_hours", v)}
            onBlur={() => touch("quiet_hours")}
            placeholder={fieldSpec("quiet_hours").example}
          />
          <ListField
            name="other_locations"
            itemNoun="site"
            chrome={chrome("other_locations")}
            values={draft.other_locations}
            onChange={(v) => {
              onChange("other_locations", v);
              touch("other_locations");
            }}
            placeholder={fieldSpec("other_locations").example}
          />
          <ChoiceField<boolean>
            name="has_online"
            chrome={chrome("has_online")}
            value={draft.has_online}
            onChange={(v) => {
              onChange("has_online", v);
              touch("has_online");
            }}
            options={[
              { value: true, label: "Yes" },
              { value: false, label: "No" },
            ]}
          />
          <ChoiceField<boolean>
            name="books_classes"
            chrome={chrome("books_classes")}
            value={draft.books_classes}
            onChange={(v) => {
              onChange("books_classes", v);
              touch("books_classes");
            }}
            options={[
              { value: true, label: "Yes" },
              { value: false, label: "No" },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="offers" className="space-y-6">
        <div>
          <SectionTitle id="offers">What Charlie can offer</SectionTitle>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-zinc-400">
            The only things Charlie may put on the table. How each is delivered — a texted link, or a call from the
            gym to book — follows from the offer itself.
          </p>
        </div>
        <div className="max-w-xl space-y-6">
          <AffixField
            name="renewal_discount_percent"
            chrome={chrome("renewal_discount_percent", { hint: "Offered once, only if a renewing member hesitates. A whole number from 1 to 50 — for example 15." })}
            value={draft.renewal_discount_percent}
            onChange={(v) => onChange("renewal_discount_percent", v)}
            onBlur={() => touch("renewal_discount_percent")}
            suffix="% off"
            inputMode="numeric"
          />
          <ChoiceField<ReengagementPerk>
            name="reengagement_perk"
            layout="column"
            chrome={chrome("reengagement_perk", { hint: "For a member whose membership is live but who has stopped coming." })}
            value={draft.reengagement_perk}
            onChange={(v) => {
              onChange("reengagement_perk", v);
              touch("reengagement_perk");
            }}
            options={[
              { value: "guest_pass", label: "Guest pass", note: "texted" },
              { value: "free_session", label: "Free session", note: "gym calls to book" },
              { value: "none", label: "Nothing" },
            ]}
          />
          <ChoiceField<WinbackOffer>
            name="winback_offer"
            layout="column"
            chrome={chrome("winback_offer", { hint: "For someone whose membership has already ended." })}
            value={draft.winback_offer}
            onChange={(v) => {
              onChange("winback_offer", v);
              touch("winback_offer");
            }}
            options={[
              { value: "free_pt_session", label: "Free PT session", note: "gym calls to book" },
              { value: "guest_pass", label: "Guest pass", note: "texted" },
              { value: "none", label: "Nothing" },
            ]}
          />
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-white">
              Cheaper membership<span className="ml-1.5 text-xs font-normal text-zinc-400">optional</span>
            </legend>
            <p className="-mt-1 text-xs leading-relaxed text-zinc-400">
              Mentioned only to a lapsed member who stopped because of money. It needs both a name and a monthly price, for example 45 or 39.50.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <TextField
                name="cheaper_tier_name"
                chrome={chrome("cheaper_tier_name", { label: "Name" })}
                value={draft.cheaper_tier_name}
                onChange={(v) => onChange("cheaper_tier_name", v)}
                onBlur={() => touch("cheaper_tier_name")}
                placeholder={fieldSpec("cheaper_tier_name").example}
              />
              <AffixField
                name="cheaper_tier_price"
                labelOverride="Monthly price"
                chrome={chrome("cheaper_tier_price", { blankNote: null })}
                value={draft.cheaper_tier_price}
                onChange={(v) => onChange("cheaper_tier_price", v)}
                onBlur={() => touch("cheaper_tier_price")}
                prefix="$"
                suffix="a month"
                inputMode="decimal"
              />
            </div>
          </fieldset>
        </div>
      </section>
    </form>
  );
}

/**
 * Save, attached to the form by id. Stays focusable when unavailable
 * (aria-disabled rather than disabled), so its reason is reachable by keyboard.
 */
export function SaveBar({
  saveAvailable,
  saveTitle,
  saveBody,
  saveAdminDetail,
  saveState,
}: {
  saveAvailable: boolean;
  saveTitle: string;
  saveBody: string;
  saveAdminDetail: string | null;
  saveState: SaveState;
}) {
  const unavailable = !saveAvailable || saveState.kind === "saving";
  return (
    <div className="max-w-xl space-y-3 border-t border-zinc-900 pt-6">
      {saveState.kind === "error" && (
        <Notice tone="fault" title="Not saved" role="alert">
          {saveState.message}
        </Notice>
      )}
      {!saveAvailable && (
        <Notice tone="caution" title={saveTitle} id="save-unavailable">
          <p>{saveBody}</p>
          {saveAdminDetail && <AdminDetail>{saveAdminDetail}</AdminDetail>}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          form={GYM_FORM_ID}
          variant="primary"
          aria-disabled={unavailable || undefined}
          aria-describedby={!saveAvailable ? "save-unavailable" : "save-help"}
        >
          {saveState.kind === "saving" ? "Saving…" : "Save gym"}
        </Button>
        <p id="save-help" className="text-xs leading-relaxed text-zinc-400">
          Saving checks every answer again and stores the gym. The next call placed for it uses the words in the preview.
        </p>
      </div>
    </div>
  );
}
