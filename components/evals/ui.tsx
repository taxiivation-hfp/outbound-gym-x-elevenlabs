import type { ReactNode } from "react";
import { BADGE_TONE } from "@/components/evals/format";

/** One panel of the evals screen: a claim for a title, a line under it, and an optional right-hand aside. */
export function Section({
  title,
  sub,
  aside,
  lead = false,
  id,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  /** The headline panels: a stronger edge and the window shadow. */
  lead?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={typeof title === "string" ? title : undefined}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface p-[22px] ${lead ? "border-line-strong shadow-window" : "border-line shadow-soft"}`}
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 font-display text-[20px] font-bold tracking-[-0.025em] text-ink">{title}</h2>
        {sub && <span className="text-[13px] text-dim text-pretty">{sub}</span>}
        {aside && <span className="ml-auto flex items-center gap-2">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Badge({
  tone,
  tip,
  children,
  className = "",
}: {
  tone: keyof typeof BADGE_TONE;
  tip?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      title={tip}
      className={`inline-block justify-self-start whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.07em] ${BADGE_TONE[tone]} ${
        tip ? "cursor-help underline decoration-dotted underline-offset-[3px]" : ""
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** Where a static claim on this screen comes from. */
export function Source({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-3 text-[11px] leading-snug text-faint">Source: {children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-canvas p-[22px] text-center text-[12.5px] text-dim">{children}</div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[5px] bg-control px-1.5 py-px font-mono text-[11.5px] text-ink-2">{children}</code>;
}

/** The row expansion's label/value pair, as on the call queue. */
export function Field({ label, children, tone = "ink" }: { label: string; children: ReactNode; tone?: "ink" | "dim" | "flag" }) {
  const color = tone === "dim" ? "text-dim" : tone === "flag" ? "text-flag-ink" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-dim">{label}</span>
      <span className={`text-[13px] leading-[1.4] text-pretty ${color}`}>{children}</span>
    </div>
  );
}
