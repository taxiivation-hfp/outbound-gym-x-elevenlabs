"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { focusRing } from "./ui";

/**
 * The questionnaire's controls. Every one has a visible label, an optional
 * "if you leave this blank" line, room for provenance from a document, and an
 * error slot tied to the input with aria-describedby. Blank is a first-class
 * answer: the tri-state and choice controls have an explicit "Not stated"
 * option rather than an unticked box that could mean "no".
 */

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
}

// Form controls take a 4.3:1 boundary rather than the 1.4:1 panel hairline, so
// an empty field is findable on a black page (WCAG 1.4.11).
//
// Controls don't transition. Focus arrives by Tab dozens of times a form, and a
// colour transition there fades the ring in from white; a selected option has to
// read as selected the instant it is chosen.
const INPUT =
  "w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

function inputBorder(error?: string) {
  return error ? "border-red-600 focus:border-red-400" : "border-zinc-500 hover:border-zinc-400 focus:border-signal";
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
        <p id={ids.hint} className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          {chrome.hint}
        </p>
      )}
      {chrome.error && (
        <p id={ids.error} className="mt-1.5 text-xs font-medium leading-relaxed text-red-300">
          {chrome.error}
        </p>
      )}
      {!chrome.error && chrome.blank && chrome.blankNote && (
        <p id={ids.blank} className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          <span className="font-semibold text-zinc-300">{chrome.blankLabel ?? "Not stated:"}</span> {chrome.blankNote}
        </p>
      )}
      {chrome.provenance && (
        <div id={ids.provenance} className="mt-2">
          {chrome.provenance}
        </div>
      )}
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

function LabelText({ chrome }: { chrome: FieldChrome }) {
  return (
    <>
      {chrome.label}
      <span className="ml-1.5 text-xs font-normal text-zinc-400">{chrome.required ? "required" : "optional"}</span>
    </>
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
    <div data-field={name}>
      <label htmlFor={ids.control} className="block text-sm font-semibold text-white">
        <LabelText chrome={chrome} />
      </label>
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
        className={`mt-1.5 ${INPUT} ${inputBorder(chrome.error)}`}
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
    <div data-field={name}>
      <label htmlFor={ids.control} className="block whitespace-nowrap text-sm font-semibold text-white">
        {labelOverride ? (
          <>
            {labelOverride}
            <span className="sr-only"> ({chrome.label})</span>
          </>
        ) : (
          <LabelText chrome={chrome} />
        )}
      </label>
      <div
        className={`mt-1.5 flex w-full max-w-[14rem] items-center rounded-lg border bg-zinc-950 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal ${
          chrome.error ? "border-red-600 focus-within:border-red-400" : "border-zinc-500 hover:border-zinc-400 focus-within:border-signal"
        }`}
      >
        {prefix && (
          <span className="pl-3 text-sm text-zinc-400" aria-hidden="true">
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
          className="w-full min-w-0 bg-transparent px-2 py-2 text-sm tabular-nums text-white placeholder:text-zinc-400 focus:outline-none"
        />
        {suffix && (
          <span className="whitespace-nowrap pr-3 text-sm text-zinc-400" aria-hidden="true">
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
  layout = "row",
}: {
  chrome: FieldChrome;
  value: T | null;
  onChange: (value: T | null) => void;
  options: Array<{ value: T; label: string; note?: string }>;
  name: string;
  layout?: "row" | "column";
}) {
  const ids = useFieldIds();
  const all: Array<{ value: T | null; label: string; note?: string }> = [...options, { value: null, label: "Not stated" }];
  const description = describedBy(ids, chrome);
  return (
    <fieldset data-field={name}>
      <legend className="text-sm font-semibold text-white">
        <LabelText chrome={chrome} />
      </legend>
      <div
        className={`mt-1.5 inline-flex max-w-full gap-0.5 rounded-lg border border-zinc-600 p-0.5 ${
          layout === "column" ? "flex-col sm:flex-row sm:flex-wrap" : "flex-wrap"
        }`}
      >
        {all.map((option) => {
          const checked = option.value === value;
          const optionId = `${ids.control}-${String(option.value)}`;
          return (
            <label
              key={String(option.value)}
              htmlFor={optionId}
              className={`relative flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal ${
                checked
                  ? "bg-zinc-800 font-semibold text-white ring-1 ring-inset ring-zinc-300"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
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
              {/* The selected option carries a mark, not just a lighter fill. */}
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${checked ? "bg-white" : "bg-zinc-700"}`}
              />
              <span className={option.value === null ? "italic" : undefined}>{option.label}</span>
              {option.note && <span className="text-xs font-normal text-zinc-400">{option.note}</span>}
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
}: {
  chrome: FieldChrome;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  name: string;
  itemNoun: string;
}) {
  const ids = useFieldIds();
  const [pending, setPending] = useState("");
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
    <div data-field={name}>
      <label htmlFor={ids.control} className="block text-sm font-semibold text-white">
        <LabelText chrome={chrome} />
      </label>
      {values.length > 0 && (
        <ul ref={listRef} className="mt-1.5 flex flex-wrap gap-2" aria-label={`${chrome.label} added`}>
          {values.map((v, index) => (
            <li
              key={v}
              className="flex max-w-full items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 py-1 pl-2.5 pr-1 text-sm text-zinc-200"
            >
              <span className="wrap-anywhere">{v}</span>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove ${v}`}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-400 transition-[background-color,color] duration-150 ease-out hover:bg-zinc-800 hover:text-white motion-reduce:transition-none ${focusRing}`}
              >
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex max-w-md gap-2">
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
          className={`${INPUT} ${inputBorder(chrome.error)}`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!pending.trim()}
          className={`shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition-[border-color,color] duration-150 ease-out hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${focusRing}`}
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
