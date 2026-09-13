"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Pill, focusRing } from "./ui";

/**
 * The questionnaire's controls. Every one has a visible label, a state chip
 * (from the document, set, blank), an "if you leave this blank" line, room for
 * provenance from a document, and an error slot tied to the input with
 * aria-describedby. Blank is a first-class answer: the tri-state and choice
 * controls have an explicit "Not stated" option rather than an unticked box that
 * could mean "no".
 *
 * The hint and the "if you leave this blank" line appear while the field has
 * focus, so a form of eighteen questions reads as eighteen questions. Errors and
 * provenance stay visible: they are about the value, not the question. The
 * preview beside the form shows what every blank answer compiles to.
 */

/** Where a field's current value stands. Computed by the form from the draft and the extraction review. */
export type FieldStatus = "document" | "set" | "nothing" | "blank";

export interface FieldChrome {
  label: string;
  required?: boolean;
  /** What the agent does when this is blank. Shown while the field is blank. */
  blankNote?: string | null;
  /** Whether the field is currently blank (or, for a choice, set to "Nothing"). */
  blank: boolean;
  /** How that state is named beside its consequence: "Not stated:" or "Nothing:". */
  blankLabel?: string;
  error?: string;
  /** Provenance or a flagged suggestion, rendered under the control. */
  provenance?: ReactNode;
  hint?: string;
  status?: FieldStatus;
  /** Inside a group whose legend already carries the state: no tag beside the label. */
  untagged?: boolean;
}

const INPUT =
  "h-[38px] w-full rounded-[10px] border bg-canvas px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line";

function inputBorder(error?: string) {
  return error ? "border-flag focus:border-flag" : "border-line-strong hover:border-accent-line focus:border-accent-line";
}

const STATUS_PILL: Record<FieldStatus, { label: string; tone: "accent" | "plain" | "ghost" }> = {
  document: { label: "from document", tone: "accent" },
  set: { label: "set", tone: "plain" },
  nothing: { label: "nothing", tone: "plain" },
  blank: { label: "blank", tone: "ghost" },
};

export function StatusPill({ status }: { status: FieldStatus }) {
  return <Pill tone={STATUS_PILL[status].tone}>{STATUS_PILL[status].label}</Pill>;
}

function Captions({
  ids,
  chrome,
}: {
  ids: { blank: string; error: string; provenance: string; hint: string };
  chrome: FieldChrome;
}) {
  return (
    <>
      {chrome.hint && (
        <p id={ids.hint} className="hidden text-[11.5px] leading-[1.45] text-dim text-pretty group-focus-within/field:block">
          {chrome.hint}
        </p>
      )}
      {chrome.error && (
        <p id={ids.error} className="text-[11.5px] font-semibold leading-[1.45] text-flag-ink">
          {chrome.error}
        </p>
      )}
      {!chrome.error && chrome.blank && chrome.blankNote && (
        <p id={ids.blank} className="hidden text-[11.5px] leading-[1.45] text-dim text-pretty group-focus-within/field:block">
          <span className="font-semibold text-muted">{chrome.blankLabel ?? "Not stated:"}</span> {chrome.blankNote}
        </p>
      )}
      {chrome.provenance && <div id={ids.provenance}>{chrome.provenance}</div>}
    </>
  );
}

function useFieldIds() {
  const base = useId();
  return {
    control: `${base}-control`,
    blank: `${base}-blank`,
    error: `${base}-error`,
    provenance: `${base}-provenance`,
    hint: `${base}-hint`,
  };
}

function describedBy(ids: ReturnType<typeof useFieldIds>, chrome: FieldChrome): string | undefined {
  const parts: string[] = [];
  if (chrome.hint) parts.push(ids.hint);
  if (chrome.error) parts.push(ids.error);
  else if (chrome.blank && chrome.blankNote) parts.push(ids.blank);
  if (chrome.provenance) parts.push(ids.provenance);
  return parts.length ? parts.join(" ") : undefined;
}

/** The label row: the label, then "required" or the field's state. */
function LabelRow({ chrome, htmlFor, as = "label" }: { chrome: FieldChrome; htmlFor?: string; as?: "label" | "legend" }) {
  const inner = (
    <>
      <span className="text-[12.5px] font-bold text-ink">{chrome.label}</span>
      {chrome.untagged ? null : chrome.required ? (
        <Pill tone="ghost">required</Pill>
      ) : chrome.status ? (
        <StatusPill status={chrome.status} />
      ) : (
        <span className="text-[11px] text-dim">optional</span>
      )}
    </>
  );
  if (as === "legend") {
    return <legend className="mb-2 flex flex-wrap items-baseline gap-x-[9px] gap-y-1 p-0">{inner}</legend>;
  }
  return (
    <label htmlFor={htmlFor} className="flex flex-wrap items-baseline gap-x-[9px] gap-y-1">
      {inner}
    </label>
  );
}

export function TextField({
  chrome,
  value,
  onChange,
  onBlur,
  placeholder,
  name,
}: {
  chrome: FieldChrome;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder?: string;
  name: string;
}) {
  const ids = useFieldIds();
  return (
    <div data-field={name} className="group/field flex min-w-0 flex-col gap-2">
      <LabelRow chrome={chrome} htmlFor={ids.control} />
      <input
        id={ids.control}
        name={name}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder ? `e.g. ${placeholder}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={chrome.error ? true : undefined}
        aria-required={chrome.required || undefined}
        aria-describedby={describedBy(ids, chrome)}
        className={`${INPUT} ${inputBorder(chrome.error)}`}
      />
      <Captions ids={ids} chrome={chrome} />
    </div>
  );
}

export function AffixField({
  chrome,
  value,
  onChange,
  onBlur,
  prefix,
  suffix,
  placeholder,
  inputMode,
  name,
  labelOverride,
}: {
  chrome: FieldChrome;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  inputMode: "numeric" | "decimal";
  name: string;
  /** A shorter visible label when the field sits under a group legend. */
  labelOverride?: string;
}) {
  const ids = useFieldIds();
  return (
    <div data-field={name} className="group/field flex min-w-0 flex-col gap-2">
      {labelOverride ? (
        <label htmlFor={ids.control} className="whitespace-nowrap text-[11.5px] font-semibold text-muted">
          {labelOverride}
          <span className="sr-only"> ({chrome.label})</span>
        </label>
      ) : (
        <LabelRow chrome={chrome} htmlFor={ids.control} />
      )}
      <div
        className={`flex h-[38px] w-full max-w-[12rem] items-center gap-2 rounded-[10px] border bg-canvas px-3 focus-within:bg-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-line ${
          chrome.error ? "border-flag" : "border-line-strong hover:border-accent-line focus-within:border-accent-line"
        }`}
      >
        {prefix && (
          <span className="text-[13px] text-dim" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={ids.control}
          name={name}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          placeholder={placeholder ? `e.g. ${placeholder}` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={chrome.error ? true : undefined}
          aria-describedby={describedBy(ids, chrome)}
          className="h-full w-full min-w-0 bg-transparent text-[13px] tabular-nums text-ink placeholder:text-faint outline-none"
        />
        {suffix && (
          <span className="whitespace-nowrap text-[12px] font-semibold text-dim" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      <Captions ids={ids} chrome={chrome} />
    </div>
  );
}

export function ChoiceField<T extends string | boolean>({
  chrome,
  value,
  onChange,
  options,
  name,
}: {
  chrome: FieldChrome;
  value: T | null;
  onChange: (value: T | null) => void;
  options: Array<{ value: T; label: string; note?: string }>;
  name: string;
}) {
  const ids = useFieldIds();
  const all: Array<{ value: T | null; label: string; note?: string }> = [...options, { value: null, label: "Not stated" }];
  const description = describedBy(ids, chrome);
  return (
    <fieldset data-field={name} className="group/field m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <LabelRow chrome={chrome} as="legend" />
      <div className="flex flex-wrap gap-1.5">
        {all.map((option) => {
          const checked = option.value === value;
          const optionId = `${ids.control}-${String(option.value)}`;
          return (
            <label
              key={String(option.value)}
              htmlFor={optionId}
              className={`relative flex h-[34px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3.5 text-[12.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-line ${
                checked
                  ? "border-accent-line bg-accent-wash font-bold text-accent-ink"
                  : "border-control-line bg-canvas font-semibold text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <input
                id={optionId}
                type="radio"
                name={`${name}-choice`}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(option.value)}
                aria-describedby={description}
              />
              {/* The selected option carries a mark, not just a tint. */}
              <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${checked ? "bg-bar" : "bg-line-strong"}`} />
              <span className={option.value === null ? "italic" : undefined}>{option.label}</span>
              {option.note && <span className="text-[11px] font-normal text-dim">{option.note}</span>}
            </label>
          );
        })}
      </div>
      <Captions ids={ids} chrome={chrome} />
    </fieldset>
  );
}

export function ListField({
  chrome,
  values,
  onChange,
  placeholder,
  name,
  itemNoun,
  onPendingChange,
}: {
  chrome: FieldChrome;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  name: string;
  itemNoun: string;
  /** Told about text typed but not yet added, so the form can refuse to drop it silently. */
  onPendingChange?: (pending: string) => void;
}) {
  const ids = useFieldIds();
  const [pending, setPendingText] = useState("");
  const setPending = (text: string) => {
    setPendingText(text);
    onPendingChange?.(text);
  };
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const count = (n: number) => `${n} ${itemNoun}${n === 1 ? "" : "s"}`;

  const add = () => {
    const next = pending.trim().replace(/\s+/g, " ");
    if (!next) return;
    if (!values.includes(next)) {
      onChange([...values, next]);
      setAnnouncement(`Added ${next}. ${count(values.length + 1)}.`);
    } else {
      setAnnouncement(`${next} is already listed.`);
    }
    setPending("");
  };

  const remove = (index: number) => {
    const removed = values[index];
    const next = values.filter((_, i) => i !== index);
    onChange(next);
    setAnnouncement(`Removed ${removed}. ${next.length ? count(next.length) : `No ${itemNoun}s`}.`);
    // Focus stays in the list: the next chip's remove button, or the input.
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
      const target = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)];
      (target ?? inputRef.current)?.focus();
    });
  };

  return (
    <div data-field={name} className="group/field flex min-w-0 flex-col gap-2">
      <LabelRow chrome={chrome} htmlFor={ids.control} />
      {values.length > 0 && (
        <ul ref={listRef} className="m-0 flex list-none flex-wrap gap-[7px] p-0" aria-label={`${chrome.label} added`}>
          {values.map((v, index) => (
            <li
              key={v}
              className="flex h-8 max-w-full items-center gap-2 rounded-[9px] border border-line bg-control pl-3 pr-1.5 text-[12.5px] font-semibold text-ink"
            >
              <span className="wrap-anywhere">{v}</span>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove ${v}`}
                className={`grid h-5 w-5 flex-none place-items-center rounded-md text-dim transition-colors hover:bg-flag-wash hover:text-flag-ink motion-reduce:transition-none ${focusRing}`}
              >
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2.5">
        <input
          ref={inputRef}
          id={ids.control}
          type="text"
          autoComplete="off"
          value={pending}
          placeholder={placeholder ? `e.g. ${placeholder}` : undefined}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-invalid={chrome.error ? true : undefined}
          aria-describedby={describedBy(ids, chrome)}
          className={`${INPUT} ${inputBorder(chrome.error)} flex-1`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!pending.trim()}
          className={`h-[38px] flex-none rounded-[10px] border border-control-line bg-control px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:border-accent-line disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none ${focusRing}`}
        >
          Add {itemNoun}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <Captions ids={ids} chrome={chrome} />
    </div>
  );
}
