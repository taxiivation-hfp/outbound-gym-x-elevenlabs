"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { NAV_STORAGE_KEY } from "@/components/shell/theme";
import ThemeToggle from "@/components/shell/ThemeToggle";

/**
 * The frame every screen sits in: a header bar (whose title, eyebrow and
 * right-hand content are the screen's), and a collapsible nav beside the
 * content. Only screens that exist are in the nav — the mockups' Call log,
 * Numbers and Settings have no page behind them and are left out rather than
 * linked to nothing.
 */

export type NavKey = "overview" | "queue" | "members" | "setup" | "evals" | "about";

const ICON = {
  overview: (
    <>
      <rect x="2.2" y="2.2" width="5" height="5" rx="1.2" />
      <rect x="8.8" y="2.2" width="5" height="5" rx="1.2" />
      <rect x="2.2" y="8.8" width="5" height="5" rx="1.2" />
      <rect x="8.8" y="8.8" width="5" height="5" rx="1.2" />
    </>
  ),
  queue: (
    <>
      <path d="M2 4h12M2 8h12M2 12h12" />
      <circle cx="13.2" cy="4" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  members: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <path d="M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" />
      <path d="M11 5.2a2.2 2.2 0 0 1 0 4.1" />
      <path d="M12 13c0-1.6-.6-2.7-1.6-3.3" />
    </>
  ),
  setup: <path d="M2 8h1.6M5 5v6M8 3v10M11 5.5v5M14 8h-1.6" />,
  evals: (
    <>
      <path d="M2.5 8.6 5 11l3-4 2.6 2.4 3-4.4" />
      <path d="M2.5 13.5h11" />
    </>
  ),
  about: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7v4.2M8 4.9v.2" />
    </>
  ),
} satisfies Record<NavKey, ReactNode>;

const PRIMARY: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "overview", href: "/intelligence", label: "Overview" },
  { key: "queue", href: "/", label: "Call queue" },
  { key: "members", href: "/members", label: "Members" },
  { key: "setup", href: "/onboarding", label: "Voice agent" },
];

const SECONDARY: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "evals", href: "/evals", label: "Evals" },
  { key: "about", href: "/about", label: "About" },
];

const NAV_EVENT = "retention-router:nav";

function subscribeNav(onChange: () => void) {
  window.addEventListener(NAV_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NAV_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readNavOpen(): boolean {
  try {
    return localStorage.getItem(NAV_STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

export default function AppShell({
  current,
  title,
  eyebrow,
  headerBody,
  headerActions,
  memberCount,
  children,
}: {
  current: NavKey;
  /** The gym's name on an operator screen, the product's on Evals and About. */
  title: string;
  /** What this screen is, under the title. */
  eyebrow: string;
  /** Beside the title: a status pill, a date. */
  headerBody?: ReactNode;
  /** Right-aligned, before the theme toggle. */
  headerActions?: ReactNode;
  /** Shown beside Members in the nav, when the screen already has it. */
  memberCount?: number;
  children: ReactNode;
}) {
  const open = useSyncExternalStore(subscribeNav, readNavOpen, () => true);
  const toggleNav = () => {
    try {
      localStorage.setItem(NAV_STORAGE_KEY, open ? "collapsed" : "open");
    } catch {
      // Not remembered.
    }
    window.dispatchEvent(new Event(NAV_EVENT));
  };

  const item = (entry: { key: NavKey; href: string; label: string }) => {
    const active = entry.key === current;
    return (
      <Link
        key={entry.key}
        href={entry.href}
        aria-current={active ? "page" : undefined}
        title={open ? undefined : entry.label}
        className={`flex h-9 items-center gap-[11px] rounded-[9px] text-[12.5px] no-underline transition-colors ${
          open ? "justify-start px-[11px]" : "justify-center px-0"
        } ${
          active
            ? "bg-control font-bold text-ink shadow-[inset_2px_0_0_var(--bar)]"
            : "font-semibold text-muted hover:bg-row-hover hover:text-ink"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-none"
        >
          {ICON[entry.key]}
        </svg>
        <span className={open ? "flex-1 overflow-hidden whitespace-nowrap text-left" : "sr-only"}>{entry.label}</span>
        {open && entry.key === "members" && memberCount !== undefined && (
          <span className="flex-none text-[11px] font-bold tabular-nums text-dim">{memberCount}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-dvh min-w-[980px] flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-[70px] flex-none items-center gap-[26px] whitespace-nowrap border-b border-line-strong bg-surface px-3.5">
        <div className="flex flex-none flex-col gap-px">
          <h1 className="m-0 font-display text-[22px] font-bold leading-[1.05] tracking-[-0.03em]">{title}</h1>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">{eyebrow}</span>
        </div>
        {headerBody}
        <div className="ml-auto flex flex-none items-center gap-2.5">
          {headerActions}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3.5 p-3.5">
        <aside
          aria-label="Sections"
          className={`flex flex-none flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] ${
            open ? "w-[208px]" : "w-[58px]"
          }`}
        >
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded={open}
            aria-label={open ? "Collapse navigation" : "Expand navigation"}
            className={`mx-2 mt-2 flex h-[38px] items-center gap-2.5 rounded-[9px] text-[11px] font-bold uppercase tracking-[0.08em] text-dim hover:text-ink ${
              open ? "justify-start px-2.5" : "justify-center px-0"
            }`}
          >
            <span aria-hidden="true" className={`inline-block text-[15px] leading-none transition-transform ${open ? "" : "rotate-180"}`}>
              ‹
            </span>
            {open && <span>Collapse</span>}
          </button>
          <nav className="flex flex-col gap-[3px] px-2 pt-2">{PRIMARY.map(item)}</nav>
          <div className="mt-auto flex flex-col gap-[3px] border-t border-line p-2">{SECONDARY.map(item)}</div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

/** The small bordered pill beside the title: a date, a state. Never animated — nothing on these screens is live. */
export function HeaderPill({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "flag" | "plain" }) {
  const look =
    tone === "flag"
      ? "bg-flag-wash text-flag-ink"
      : tone === "plain"
        ? "bg-control text-muted"
        : "bg-accent-wash text-accent-ink";
  return (
    <div className={`flex h-[30px] flex-none items-center gap-[7px] rounded-[9px] border border-line px-[11px] text-[12px] ${look}`}>
      {children}
    </div>
  );
}
