"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExtractionReview } from "@/lib/extraction/sanitize";
import {
  FIELD_SPECS,
  GYM_FIELD_KEYS,
  RENEWAL_DISCOUNT_MAX,
  RENEWAL_DISCOUNT_MIN,
  fieldSpec,
  type ExtractableFieldKey,
  type FieldErrors,
  type GymFieldKey,
  type GymFields,
  type ReengagementPerk,
  type SchedulableOffer,
  type WinbackOffer,
} from "@/lib/gymConfig";
import { formatMoney } from "@/lib/incentives";
import { isDraftBlank, valueToDraft, type Draft } from "@/lib/onboardingDraft";
import { AffixField, ChoiceField, ListField, StatusPill, TextField, type FieldChrome, type FieldStatus } from "./fields";
import OfferScheduleField, { scheduleRowState } from "./OfferScheduleField";
import OtherOfferFields from "./OtherOfferFields";
import Provenance from "./Provenance";
import { AdminDetail, Card, CardHeader, Literal, Notice, focusRing } from "./ui";

/**
 * The setup screen's form: "The gym's details" and "Offer limits". Both
 * onboarding paths fill it — by hand, or prefilled from a document — and it is
 * the only way a gym is saved, so every value a document supplied has been in
 * front of a person first.
 *
 * Save lives in the screen's header (`SaveControls`), attached to this form by
 * id, so it stays in reach however far down the form someone has scrolled.
 */

export const GYM_FORM_ID = "gym-form";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string; errors?: FieldErrors };

/** The "other" offer's name and delivery are asked only while "Something else" is chosen. */
const SUB_FIELDS: GymFieldKey[] = ["reengagement_other_label", "reengagement_other_delivery", "winback_other_label", "winback_other_delivery"];

/** The optional answers the filled count is out of: every typed field but the name and the "other" sub-fields. */
export const OPTIONAL_FIELD_KEYS = GYM_FIELD_KEYS.filter((k) => !fieldSpec(k).required && !SUB_FIELDS.includes(k));

function suggestionLabel(key: GymFieldKey, value: unknown): string | null {
  const spec = fieldSpec(key);
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "“yes”" : "“no”";
  if (key === "renewal_discount_percent" && typeof value === "number") return `${value}%`;
  if (key === "cheaper_tier_price" && typeof value === "number") return `${formatMoney(value)} a month`;
  if (key === "freeze_max_weeks" && typeof value === "number") return `${value} weeks`;
  if (key === "freeze_weekly_fee" && typeof value === "number") return `${formatMoney(value)} a week`;
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
function focusField(key: GymFieldKey | "offer_schedule") {
  const container = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!container) return;
  const target =
    container.querySelector<HTMLInputElement>("input[type=radio]:checked") ??
    container.querySelector<HTMLInputElement>("input:not([type=radio]), select") ??
    container.querySelector<HTMLInputElement>("input");
  container.scrollIntoView({ block: "center", behavior: "auto" });
  target?.focus({ preventScroll: true });
}

const FLAG_LINK = `rounded-sm font-semibold text-flag-ink underline decoration-flag underline-offset-2 hover:text-ink ${focusRing}`;
/** A field the document left to check isn't an error, so its link isn't in the error colour. */
const CHECK_LINK = `rounded-sm font-semibold text-accent-ink underline decoration-accent-line underline-offset-2 hover:text-ink ${focusRing}`;

export default function GymForm({
  draft,
  onChange,
  validationErrors,
  review,
  fileName,
  saveAvailable,
  saveState,
  onSave,
  configuredOffers,
  validationFields,
}: {
  /** The parsed answers when they parse, for naming offers in the schedule. */
  validationFields: GymFields | null;
  draft: Draft;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  /** The offers the answers so far configure: what the schedule may name. */
  configuredOffers: SchedulableOffer[];
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
  // Text typed into the site box but never added would otherwise be dropped on
  // save, and a blank site list tells Charlie there are no other sites. So it
  // blocks saving until it is added or cleared.
  const [pendingSite, setPendingSite] = useState("");
  const formErrors: FieldErrors =
    pendingSite.trim() && !validationErrors.other_locations
      ? { ...validationErrors, other_locations: `"${pendingSite.trim()}" is typed but not added. Press Add site, or clear the box.` }
      : validationErrors;

  const serverErrors = saveState.kind === "error" ? (saveState.errors ?? {}) : {};
  const errorFor = (key: GymFieldKey): string | undefined =>
    serverErrors[key] ?? (touched[key] || attempts > 0 ? formErrors[key] : undefined);

  const touch = (key: GymFieldKey) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  const fieldErrorKeys = (Object.keys(formErrors) as Array<GymFieldKey | "_form" | "gym_id" | "offer_schedule">).filter(
    (k): k is GymFieldKey | "offer_schedule" => k !== "_form" && k !== "gym_id"
  );
  const errorLabel = (key: GymFieldKey | "offer_schedule") => (key === "offer_schedule" ? "How often each offer can be made" : fieldSpec(key).label);

  // After a Save press finds problems, the summary has rendered by the time this
  // runs, so focus lands on it — on the first press, not the second.
  useEffect(() => {
    if (attempts > 0 && fieldErrorKeys.length > 0) summaryRef.current?.focus();
    // Only a new attempt moves focus; typing a fix must not pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  const outcomeFor = (key: GymFieldKey) =>
    (review?.outcomes as Partial<Record<GymFieldKey, ExtractionReview["outcomes"][ExtractableFieldKey]>> | undefined)?.[key];

  /** A field's state chip, read from the draft and the extraction review. */
  const statusFor = (key: GymFieldKey): FieldStatus => {
    if (isDraftBlank(draft, key)) return "blank";
    if (draft[key] === "none") return "nothing";
    const outcome = outcomeFor(key);
    return outcome?.status === "filled" && sameValue(key, draft, outcome.value) ? "document" : "set";
  };

  /** A two-part answer (the cheaper tier, the freeze): blank only when both halves are. */
  const groupStatus = (keys: GymFieldKey[]): FieldStatus => {
    const each = keys.map(statusFor);
    if (each.every((s) => s === "blank")) return "blank";
    if (each.every((s) => s === "document")) return "document";
    return "set";
  };

  const chrome = (key: GymFieldKey, extra: Partial<FieldChrome> = {}): FieldChrome => {
    const spec = fieldSpec(key);
    const outcome = outcomeFor(key);
    return {
      label: spec.label,
      required: spec.required,
      blankNote: spec.whenBlank,
      blank: isDraftBlank(draft, key) || draft[key] === "none",
      blankLabel: draft[key] === "none" ? "Nothing:" : "Not stated:",
      error: errorFor(key),
      status: statusFor(key),
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
    ? FIELD_SPECS.filter((s) => {
        const status = (review.outcomes as Partial<Record<GymFieldKey, { status: string }>>)[s.key]?.status;
        return status === "unsupported" || status === "rejected";
      })
    : [];

  const filled = OPTIONAL_FIELD_KEYS.filter((k) => !isDraftBlank(draft, k)).length;
  const limitStates = draft.offer_schedule.map((row) => scheduleRowState(row, configuredOffers));

  return (
    <form id={GYM_FORM_ID} onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      {review && fileName && (
        <Notice tone="info" title={`Prefilled from ${fileName}`}>
          <p>
            {review.summary.filled} filled from the document, {review.summary.blank} not in it.
            {flagged.length > 0 && (
              <>
                {" "}
                {flagged.length} to check:{" "}
                {flagged.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 ? ", " : ""}
                    <button type="button" onClick={() => focusField(s.key)} className={CHECK_LINK}>
                      {s.shortLabel}
                    </button>
                  </span>
                ))}
                .
              </>
            )}{" "}
            Check them, then save.
          </p>
          {review.ignored_keys.length > 0 && (
            <p>
              Ignored, not on this form:{" "}
              {review.ignored_keys.map((k, i) => (
                <span key={k}>
                  {i > 0 ? ", " : ""}
                  <Literal>{k}</Literal>
                </span>
              ))}
              .
            </p>
          )}
        </Notice>
      )}

      {attempts > 0 && fieldErrorKeys.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="group" aria-labelledby="form-error-summary-title" className={`rounded-[11px] outline-none ${focusRing}`}>
          <Notice
            tone="fault"
            titleId="form-error-summary-title"
            title={`${fieldErrorKeys.length} answer${fieldErrorKeys.length === 1 ? " needs" : "s need"} fixing before saving`}
          >
            <ul className="list-disc space-y-0.5 pl-5">
              {fieldErrorKeys.map((key) => (
                <li key={key}>
                  <button type="button" onClick={() => focusField(key)} className={`text-left ${FLAG_LINK}`}>
                    {errorLabel(key)}
                  </button>{" "}
                  — {formErrors[key]}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <Card labelledBy="details-title" className="@container">
        <CardHeader
          id="details-title"
          title="The gym’s details"
          aside={`${filled} of ${OPTIONAL_FIELD_KEYS.length} optional fields filled`}
        />
        <p className="mb-5 text-[13px] text-muted">Only the name is required. Leave blank anything you don&apos;t offer.</p>

        <div className="grid grid-cols-1 items-start gap-x-[26px] gap-y-6 @xl:grid-cols-2">
          <div className="@xl:col-span-2">
            <TextField
              name="gym_name"
              chrome={chrome("gym_name", { hint: "Charlie says this in his first sentence: “It's Charlie from …”" })}
              value={draft.gym_name}
              onChange={(v) => onChange("gym_name", v)}
              onBlur={() => touch("gym_name")}
              placeholder={fieldSpec("gym_name").example}
            />
          </div>
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
          <div className="@xl:col-span-2">
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
              onPendingChange={setPendingSite}
            />
          </div>
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

          <div className="@xl:col-span-2 border-t border-line pt-5">
            <h3 className="m-0 text-[14px] font-bold text-ink">What Charlie can offer</h3>
          </div>

          <div className="@xl:col-span-2">
            <AffixField
              name="renewal_discount_percent"
              chrome={chrome("renewal_discount_percent", { hint: `Offered once, if a renewing member hesitates. ${RENEWAL_DISCOUNT_MIN}–${RENEWAL_DISCOUNT_MAX}.` })}
              value={draft.renewal_discount_percent}
              onChange={(v) => onChange("renewal_discount_percent", v)}
              onBlur={() => touch("renewal_discount_percent")}
              suffix="% off"
              inputMode="numeric"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3.5 @xl:col-span-2">
            <ChoiceField<ReengagementPerk>
              name="reengagement_perk"
              chrome={chrome("reengagement_perk", { hint: "For a current member who has stopped coming." })}
              value={draft.reengagement_perk}
              onChange={(v) => {
                onChange("reengagement_perk", v);
                touch("reengagement_perk");
              }}
              options={[
                { value: "guest_pass", label: "Guest pass", note: "texted" },
                { value: "free_session", label: "Free session", note: "gym calls to book" },
                { value: "other", label: "Something else" },
                { value: "none", label: "Nothing" },
              ]}
            />
            {draft.reengagement_perk === "other" && (
              <OtherOfferFields
                slot="reengagement"
                label={draft.reengagement_other_label}
                delivery={draft.reengagement_other_delivery}
                onLabel={(v) => onChange("reengagement_other_label", v)}
                onDelivery={(v) => {
                  onChange("reengagement_other_delivery", v);
                  touch("reengagement_other_delivery");
                }}
                onBlur={() => touch("reengagement_other_label")}
                labelError={errorFor("reengagement_other_label")}
                deliveryError={errorFor("reengagement_other_delivery")}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3.5 @xl:col-span-2">
            <ChoiceField<WinbackOffer>
              name="winback_offer"
              chrome={chrome("winback_offer", { hint: "For someone whose membership has ended." })}
              value={draft.winback_offer}
              onChange={(v) => {
                onChange("winback_offer", v);
                touch("winback_offer");
              }}
              options={[
                { value: "free_pt_session", label: "Free PT session", note: "gym calls to book" },
                { value: "guest_pass", label: "Guest pass", note: "texted" },
                { value: "other", label: "Something else" },
                { value: "none", label: "Nothing" },
              ]}
            />
            {draft.winback_offer === "other" && (
              <OtherOfferFields
                slot="winback"
                label={draft.winback_other_label}
                delivery={draft.winback_other_delivery}
                onLabel={(v) => onChange("winback_other_label", v)}
                onDelivery={(v) => {
                  onChange("winback_other_delivery", v);
                  touch("winback_other_delivery");
                }}
                onBlur={() => touch("winback_other_label")}
                labelError={errorFor("winback_other_label")}
                deliveryError={errorFor("winback_other_delivery")}
              />
            )}
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-2 flex flex-wrap items-baseline gap-x-[9px] gap-y-1 p-0">
              <span className="text-[12.5px] font-bold text-ink">A cheaper membership</span>
              <StatusPill status={groupStatus(["cheaper_tier_name", "cheaper_tier_price"])} />
            </legend>
            <p className="-mt-1 text-[11.5px] leading-[1.45] text-dim text-pretty">
              Needs a name and a monthly price.
            </p>
            <TextField
              name="cheaper_tier_name"
              chrome={chrome("cheaper_tier_name", { label: "Name", untagged: true })}
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
              suffix="/mo"
              inputMode="decimal"
            />
          </fieldset>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-2 flex flex-wrap items-baseline gap-x-[9px] gap-y-1 p-0">
              <span className="text-[12.5px] font-bold text-ink">Membership freeze</span>
              <StatusPill status={groupStatus(["freeze_max_weeks", "freeze_weekly_fee"])} />
            </legend>
            <p className="-mt-1 text-[11.5px] leading-[1.45] text-dim text-pretty">
              Only for members who ask to cancel. Needs the longest pause and a weekly fee (0 if free).
            </p>
            <AffixField
              name="freeze_max_weeks"
              labelOverride="Longest pause"
              chrome={chrome("freeze_max_weeks")}
              value={draft.freeze_max_weeks}
              onChange={(v) => onChange("freeze_max_weeks", v)}
              onBlur={() => touch("freeze_max_weeks")}
              suffix="weeks"
              inputMode="numeric"
            />
            <AffixField
              name="freeze_weekly_fee"
              labelOverride="Fee"
              chrome={chrome("freeze_weekly_fee", { blankNote: null })}
              value={draft.freeze_weekly_fee}
              onChange={(v) => onChange("freeze_weekly_fee", v)}
              onBlur={() => touch("freeze_weekly_fee")}
              prefix="$"
              suffix="/wk"
              inputMode="decimal"
            />
          </fieldset>
        </div>
      </Card>

      <Card labelledBy="limits-title">
        <CardHeader
          id="limits-title"
          title="Offer limits"
          note="optional"
          aside={
            configuredOffers.length === 0 ? (
              "nothing configured"
            ) : (
              <>
                {limitStates.filter((s) => s === "ready" || s === "never").length} of {configuredOffers.length} offer
                {configuredOffers.length === 1 ? "" : "s"} limited
              </>
            )
          }
        />
        <div className="mt-3">
          <OfferScheduleField
            rows={draft.offer_schedule}
            configured={configuredOffers}
            fields={validationFields}
            onChange={(rows) => onChange("offer_schedule", rows)}
            error={serverErrors.offer_schedule ?? (attempts > 0 ? formErrors.offer_schedule : undefined)}
          />
        </div>
      </Card>
    </form>
  );
}

/**
 * The header's save state and Save button, attached to the form by id. The
 * button stays focusable when unavailable (aria-disabled rather than disabled),
 * so its reason is reachable by keyboard.
 */
export function SaveControls({
  saveAvailable,
  saveState,
  label,
  stateText,
  stateTone,
}: {
  saveAvailable: boolean;
  saveState: SaveState;
  label: string;
  /** What the screen knows about saving right now, in words. */
  stateText: string;
  stateTone: "ink" | "dim" | "flag";
}) {
  const unavailable = !saveAvailable || saveState.kind === "saving";
  return (
    <>
      <span
        id="save-state"
        className={`text-[12px] ${stateTone === "flag" ? "font-bold text-flag-ink" : stateTone === "ink" ? "font-bold text-ink" : "text-dim"}`}
      >
        {stateText}
      </span>
      <button
        type="submit"
        form={GYM_FORM_ID}
        aria-disabled={unavailable || undefined}
        aria-describedby={!saveAvailable ? "save-state save-unavailable" : "save-state"}
        className={`h-[34px] whitespace-nowrap rounded-[10px] border px-[15px] text-[12.5px] font-bold transition-colors ${focusRing} ${
          unavailable ? "cursor-not-allowed border-line bg-control text-dim" : "border-accent-line bg-accent text-on-accent hover:brightness-[1.04]"
        }`}
      >
        {saveState.kind === "saving" ? "Saving…" : label}
      </button>
    </>
  );
}

/** What saving needs said in the page itself: a failed save, and saving being off. */
export function SaveNotices({
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
  if (saveState.kind !== "error" && saveAvailable) return null;
  return (
    <div className="flex flex-col gap-2.5">
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
    </div>
  );
}
