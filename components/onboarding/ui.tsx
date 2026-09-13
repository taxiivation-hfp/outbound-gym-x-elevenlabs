import type { ComponentProps, ReactNode } from "react";

/**
 * The onboarding screens' shared pieces, in DESIGN.md's vocabulary: one lime
 * primary action per view, hairline secondary buttons, notices that carry a word
 * as well as a colour. Kept here rather than inline so the questionnaire, the
 * upload flow and the member-data screen cannot drift into three dialects.
 * Colours come from the tokens in app/globals.css (`signal` is the lime).
 */

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

type Variant = "primary" | "secondary" | "quiet";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

/** Button styling as a class string, so a link that acts as a button looks and moves like one. */
export function buttonClass(variant: Variant, tone: "neutral" | "caution" = "neutral"): string {
  const look =
    variant === "primary"
      ? "bg-signal px-4 py-2 text-black hover:bg-signal-hover aria-disabled:hover:bg-signal"
      : variant === "secondary"
        ? tone === "caution"
          ? "border border-amber-700/80 px-4 py-2 text-amber-200 hover:border-amber-500 hover:text-amber-100"
          : "border border-zinc-700 px-4 py-2 text-zinc-200 hover:border-zinc-500 hover:text-white"
        : "px-1 py-1 text-zinc-400 hover:text-white";
  return `${BUTTON_BASE} ${look} ${focusRing}`;
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  /** Secondary buttons inside a caution notice take its colour instead of zinc. */
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
    tone === "caution"
      ? "border-amber-800/70 bg-amber-950/30 text-amber-200"
      : tone === "fault"
        ? "border-red-800/70 bg-red-950/30 text-red-200"
        : "border-zinc-800 bg-zinc-950/60 text-zinc-300";
  const titleColor = tone === "caution" ? "text-amber-300" : tone === "fault" ? "text-red-300" : "text-white";
  return (
    <div id={id} role={role} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed wrap-anywhere ${look}`}>
      <p id={titleId} className={`font-semibold ${titleColor}`}>
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
    <details className="group mt-2 text-xs">
      <summary className={`w-fit cursor-pointer rounded-sm font-semibold underline decoration-dotted underline-offset-2 ${focusRing}`}>
        For your admin
      </summary>
      <p className="mt-1 font-mono leading-relaxed wrap-anywhere">{children}</p>
    </details>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-black uppercase tracking-tight text-balance text-white">
      {children}
    </h2>
  );
}

/** Text a machine wrote or received, byte for byte. DESIGN.md: "Mono means literal". */
export function Literal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[0.8125rem] text-zinc-200 wrap-anywhere ${className}`}>{children}</code>;
}
