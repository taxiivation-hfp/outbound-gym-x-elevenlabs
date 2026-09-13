"use client";

/**
 * Shown under a perk or winback choice while "Something else" is selected: the
 * name of the offer and how it reaches the member. The name is held to the
 * same text rules as every other field that reaches a prompt, and refused with
 * a reason rather than cleaned up. The sentence Charlie reads is still written
 * by lib/incentives.ts; the gym only supplies the noun.
 */
import { fieldSpec, type OtherOfferDelivery } from "@/lib/gymConfig";

export default function OtherOfferFields({
  slot,
  label,
  delivery,
  onLabel,
  onDelivery,
  onBlur,
  labelError,
  deliveryError,
}: {
  slot: "reengagement" | "winback";
  label: string;
  delivery: OtherOfferDelivery | null;
  onLabel: (value: string) => void;
  onDelivery: (value: OtherOfferDelivery | null) => void;
  onBlur: () => void;
  labelError?: string;
  deliveryError?: string;
}) {
  const labelKey = slot === "reengagement" ? "reengagement_other_label" : "winback_other_label";
  const deliveryKey = slot === "reengagement" ? "reengagement_other_delivery" : "winback_other_delivery";
  const labelId = `${labelKey}-input`;
  return (
    <div className="flex flex-col gap-3.5 border-l-2 border-line-strong pl-3.5">
      <div data-field={labelKey} className="flex flex-col gap-2">
        <label className="text-[12.5px] font-bold text-ink" htmlFor={labelId}>
          {fieldSpec(labelKey).label}
        </label>
        <input
          id={labelId}
          type="text"
          autoComplete="off"
          value={label}
          placeholder={`e.g. ${fieldSpec(labelKey).example}`}
          onChange={(e) => onLabel(e.target.value)}
          onBlur={onBlur}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={`${labelId}-hint${labelError ? ` ${labelId}-error` : ""}`}
          className={`h-[38px] w-full max-w-xs rounded-[10px] border bg-canvas px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line ${
            labelError ? "border-flag" : "border-line-strong hover:border-accent-line focus:border-accent-line"
          }`}
        />
        <p id={`${labelId}-hint`} className="text-[11.5px] leading-[1.45] text-dim text-pretty">
          Just the thing, in a few words. Charlie says &ldquo;something to give them from the gym: {label.trim() || "protein shake"}&rdquo;.
        </p>
        {labelError && (
          <p id={`${labelId}-error`} className="text-[11.5px] font-semibold text-flag-ink">
            {labelError}
          </p>
        )}
      </div>
      <fieldset data-field={deliveryKey} className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[12.5px] font-bold text-ink">{fieldSpec(deliveryKey).label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["link", "booking"] as const).map((value) => {
            const checked = delivery === value;
            return (
              <label
                key={value}
                className={`flex h-[34px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3.5 text-[12.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-line ${
                  checked
                    ? "border-accent-line bg-accent-wash font-bold text-accent-ink"
                    : "border-control-line bg-canvas font-semibold text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <input type="radio" name={`${deliveryKey}-choice`} className="sr-only" checked={checked} onChange={() => onDelivery(value)} />
                <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${checked ? "bg-bar" : "bg-line-strong"}`} />
                {fieldSpec(deliveryKey).optionLabels?.[value]}
              </label>
            );
          })}
        </div>
        {deliveryError && <p className="text-[11.5px] font-semibold text-flag-ink">{deliveryError}</p>}
      </fieldset>
    </div>
  );
}
