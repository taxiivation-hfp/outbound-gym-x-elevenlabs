"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY, isTypingTarget, type Theme } from "@/components/shell/theme";

function toggleTheme() {
  const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode: the theme still changes, it just isn't remembered.
  }
}

/**
 * Light or dark, remembered per browser. "d" toggles it from anywhere but a
 * field. One per page. The glyph follows <html data-theme> through CSS, so the
 * button holds no state that could disagree with the page.
 */
export default function ThemeToggle() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "d" || e.key === "D") toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch between light and dark theme"
      title="Switch theme (d)"
      className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border border-line bg-control text-[14px] text-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      <span aria-hidden="true" className="theme-glyph-dark">
        ☀
      </span>
      <span aria-hidden="true" className="theme-glyph-light">
        ☾
      </span>
    </button>
  );
}
