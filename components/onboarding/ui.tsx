import type { ComponentProps, ReactNode } from "react";

/**
 * The setup screens' shared pieces, in the mockups' vocabulary: one accent
 * primary action per view, bordered secondary buttons on the control fill,
 * notices that carry a word as well as a colour, and the card every section
 * sits in. Kept here rather than inline so the questionnaire, the upload flow
 * and the member-data screen cannot drift into three dialects. Every colour is
 * a theme token from app/globals.css, so both themes hold.
 */

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line";

type Variant = "primary" | "secondary" | "quiet";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-[12.5px] font-bold transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:active:translate-y-0 motion-reduce:transition-none";

/** Button styling as a class string, so a link that acts as a button looks and moves like one. */
export function buttonClass(variant: Variant, tone: "neutral" | "caution" = "neutral"): string {
  const look =
    variant === "primary"
      ? "h-[34px] border border-accent-line bg-accent px-[15px] text-on-accent hover:brightness-[1.04]"
      : variant === "secondary"
        ? tone === "caution"
          ? "h-[30px] border border-flag bg-transparent px-3 text-flag-ink hover:bg-flag-wash"
          : "h-[34px] border border-control-line bg-control px-3.5 text-ink hover:border-accent-line"
        : "h-[30px] px-1.5 font-semibold text-dim hover:text-ink";
  return `${BUTTON_BASE} ${look} ${focusRing}`;
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  /** Secondary buttons inside a flagged notice take its colour. */
  tone?: "neutral" | "caution";
};

export function Button({ variant = "secondary", tone = "neutral", className = "", ...props }: ButtonProps) {
  return <button type="button" className={`${buttonClass(variant, tone)} ${className}`} {...props} />;
}

export function Notice({
  tone,
  title,
  children,
  id,
  role,
  titleId,
}: {
  tone: "caution" | "fault" | "info";
  title: string;
  children?: ReactNode;
  id?: string;
  /** "alert" for a failure the person just caused and must hear about. */
  role?: "alert" | "status";
  titleId?: string;
}) {
  const look =
    tone === "fault"
      ? "border-flag bg-flag-wash"
      : tone === "caution"
        ? "border-line bg-flag-wash"
        : "border-line bg-surface-2";
  const titleColor = tone === "info" ? "text-ink" : "text-flag-ink";
  return (
    <div id={id} role={role} className={`rounded-[11px] border px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2 wrap-anywhere ${look}`}>
      <p id={titleId} className={`font-bold ${titleColor}`}>
        {title}
      </p>
      {children && <div className="mt-1 space-y-1 text-pretty">{children}</div>}
    </div>
  );
}

/**
 * The technical detail behind a notice — an environment variable, a migration
 * to apply — folded away, so the person at the desk reads the plain sentence and
 * whoever runs the deployment can still find exactly what to do.
 */
export function AdminDetail({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-2 text-[11.5px]">
      <summary className={`w-fit cursor-pointer rounded-sm font-semibold text-muted underline decoration-dotted underline-offset-2 hover:text-ink ${focusRing}`}>
        For your admin
      </summary>
      <p className="mt-1 font-mono leading-relaxed text-ink-2 wrap-anywhere">{children}</p>
    </details>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="m-0 font-display text-[19px] font-bold tracking-[-0.02em] text-balance text-ink">
      {children}
    </h2>
  );
}

/** A section of the setup screen: a surface card with a title row. */
export function Card({
  children,
  labelledBy,
  prominent = false,
  className = "",
}: {
  children: ReactNode;
  labelledBy?: string;
  /** The first card on a screen gets the stronger edge and the window shadow. */
  prominent?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface p-[22px] ${
        prominent ? "border-line-strong shadow-window" : "border-line shadow-soft"
      } ${className}`}
    >
      {children}
    </section>
  );
}

/** Title, a quiet note beside it, and anything right-aligned (a count, a state). */
export function CardHeader({ id, title, note, aside }: { id: string; title: ReactNode; note?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <SectionTitle id={id}>{title}</SectionTitle>
      {note && <span className="text-[12.5px] text-dim">{note}</span>}
      {aside && <span className="ml-auto text-[12px] text-dim">{aside}</span>}
    </div>
  );
}

export type PillTone = "accent" | "flag" | "plain" | "ghost";

/** The small uppercase state chip: "from document", "ready", "not built". */
export function Pill({ children, tone = "plain", className = "" }: { children: ReactNode; tone?: PillTone; className?: string }) {
  const look =
    tone === "accent"
      ? "bg-accent-wash text-accent-ink"
      : tone === "flag"
        ? "bg-flag-wash text-flag-ink"
        : tone === "ghost"
          ? "bg-transparent text-dim"
          : "bg-control text-muted";
  return (
    <span className={`inline-flex w-fit flex-none items-center whitespace-nowrap rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em] ${look} ${className}`}>
      {children}
    </span>
  );
}

/** Text a machine wrote or received, byte for byte. Mono means literal. */
export function Literal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[12px] text-ink-2 wrap-anywhere ${className}`}>{children}</code>;
}
