"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/onboarding/ui";

/**
 * The last line under every screen: if one throws while rendering, this shows
 * instead of the framework's bare "couldn't load" page. Its way out is a link to
 * configuration, never the browser's Back, which after a demo reset can lead to
 * a gym that no longer exists.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[520px] flex-col gap-3 rounded-2xl border border-line-strong bg-surface p-[22px] shadow-window">
        <h1 className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">This screen hit a problem</h1>
        <p className="m-0 text-[13px] text-ink-2">Try the screen again, or go back to configuration and carry on from there.</p>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            Try again
          </button>
          <Link href="/onboarding" className={buttonClass("secondary")}>
            Go to configuration
          </Link>
        </div>
      </div>
    </main>
  );
}
