"use client";

/**
 * PLACEHOLDER UI — pass one. Correct data, plain layout, no design investment.
 * Pass three replaces this component wholesale; don't polish it.
 *
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
  return (
    <div className="ml-4 space-y-3 border-l border-zinc-800 pl-4">
      <div data-field={labelKey}>
        <label className="block text-sm font-semibold text-white" htmlFor={`${labelKey}-input`}>
          {fieldSpec(labelKey).label}
        </label>
        <p className="text-xs text-zinc-400">
          Just the thing, up to four words — Charlie says &ldquo;something to give them from the gym: {label.trim() || "protein shake"}&rdquo;.
        </p>
        <input
          id={`${labelKey}-input`}
          type="text"
          value={label}
          placeholder={`e.g. ${fieldSpec(labelKey).example}`}
          onChange={(e) => onLabel(e.target.value)}
          onBlur={onBlur}
          className="mt-1 w-full max-w-xs rounded border border-zinc-500 bg-zinc-950 px-2 py-1 text-sm text-white"
        />
        {labelError && <p className="mt-1 text-xs font-medium text-red-300">{labelError}</p>}
      </div>
      <fieldset data-field={deliveryKey}>
        <legend className="text-sm font-semibold text-white">{fieldSpec(deliveryKey).label}</legend>
        <div className="mt-1 flex gap-4 text-sm text-zinc-300">
          {(["link", "booking"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name={`${deliveryKey}-choice`} checked={delivery === value} onChange={() => onDelivery(value)} />
              {fieldSpec(deliveryKey).optionLabels?.[value]}
            </label>
          ))}
        </div>
        {deliveryError && <p className="mt-1 text-xs font-medium text-red-300">{deliveryError}</p>}
      </fieldset>
    </div>
  );
}
