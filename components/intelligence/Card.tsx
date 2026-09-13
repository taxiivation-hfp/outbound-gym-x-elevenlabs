import type { ReactNode } from "react";

/**
 * The overview's building blocks: a section heading, a card, a notice and an
 * empty state. Static markup only, so the page renders from data alone (the
 * guards render it with `renderToStaticMarkup`).
 */

export function SectionHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="col-span-full flex items-baseline gap-3 px-0.5 pt-1.5">
      <h2 className="m-0 font-display text-[17px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
      {sub && <span className="text-[12px] text-dim">{sub}</span>}
      <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />
    </div>
  );
}

export function Card({
  title,
  sub,
  lead,
  className = "",
  children,
}: {
  title: string;
  sub?: ReactNode;
  /** The screen's headline panels: a stronger edge and a larger title. */
  lead?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-surface ${
        lead ? "border-line-strong shadow-window" : "border-line shadow-soft"
      } ${className}`}
    >
      <div className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 ${lead ? "px-4 pb-[11px] pt-[15px]" : "px-3.5 pb-[9px] pt-3"}`}>
        <h3
          className={`m-0 font-bold uppercase ${
            lead ? "text-[13.5px] tracking-[0.01em] text-ink" : "text-[11px] tracking-[0.09em] text-dim"
          }`}
        >
          {title}
        </h3>
        {sub && <span className="text-[11.5px] text-dim">{sub}</span>}
      </div>
      <div className={`flex flex-1 flex-col ${lead ? "px-4 pb-4" : "px-3.5 pb-3.5"}`}>{children}</div>
    </section>
  );
}

/** Something that couldn't be read, or is missing, said in one beat. */
export function Notice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`rounded-[10px] border border-flag bg-flag-wash px-3 py-2 text-[12px] leading-snug text-ink-2 ${className}`}>
      {children}
    </p>
  );
}

export function Empty({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`py-3 text-[12.5px] leading-snug text-dim text-pretty ${className}`}>{children}</p>;
}

/** A big figure beside its unit, as the mockup's panel headlines. */
export function Headline({ value, note }: { value: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <span className="font-display text-[26px] font-bold leading-none tracking-[-0.025em] tabular-nums text-ink">{value}</span>
      {note && <span className="text-[11.5px] text-dim">{note}</span>}
    </div>
  );
}

/** A labelled horizontal bar row: label, bar, count, optional share. */
export function BarRow({
  label,
  value,
  max,
  count,
  shareText,
  barClass = "bg-bar",
  title,
  labelWidth = "112px",
}: {
  label: ReactNode;
  value: number;
  max: number;
  count: ReactNode;
  shareText?: string;
  barClass?: string;
  title?: string;
  labelWidth?: string;
}) {
  return (
    <div
      title={title}
      className="grid items-center gap-2.5 py-[5px]"
      style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr) 34px${shareText !== undefined ? " 40px" : ""}` }}
    >
      <span className="truncate text-[12.5px] text-ink-2">{label}</span>
      <div className="h-[9px] overflow-hidden rounded-[5px] bg-row-line">
        <div className={`h-full rounded-[5px] ${barClass}`} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
      </div>
      <span className="text-right text-[12.5px] font-bold tabular-nums text-ink">{count}</span>
      {shareText !== undefined && <span className="text-right text-[11.5px] tabular-nums text-dim">{shareText}</span>}
    </div>
  );
}
