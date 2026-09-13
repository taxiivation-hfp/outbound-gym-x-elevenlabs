/** The localStorage key the theme toggle writes and app/layout.tsx reads before paint. */
export const THEME_STORAGE_KEY = "retention-router.theme";

/** The nav's collapsed state, remembered per browser. */
export const NAV_STORAGE_KEY = "retention-router.nav";

export type Theme = "light" | "dark";

/** Keyboard shortcuts belong to the page, not to a field someone is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
