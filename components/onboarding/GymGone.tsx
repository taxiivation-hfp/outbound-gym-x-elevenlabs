import Link from "next/link";
import AppShell, { type FirstRunStep } from "@/components/shell/AppShell";
import { Card, buttonClass } from "./ui";

/**
 * A gym page whose gym isn't there: a link kept from before a demo reset, or a
 * typed id. Said in words with a way back to the gym list, rather than a bare
 * 404 — someone who pressed Back into a deleted gym should land somewhere they
 * can carry on from.
 */
export default function GymGone({ gymId, firstRunStep }: { gymId: string; firstRunStep?: FirstRunStep }) {
  return (
    <AppShell current="setup" title="Retention Router" eyebrow="Configuration" firstRunStep={firstRunStep}>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
          <Card labelledBy="gym-gone-title" prominent>
            <h2 id="gym-gone-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em] text-ink">
              This gym isn&apos;t set up any more
            </h2>
            <p className="mt-2 text-[13px] text-ink-2 wrap-anywhere">
              No saved gym has the id <span className="font-mono text-[12px]">{gymId}</span>. A demo reset may have cleared it.
            </p>
            <div className="mt-4">
              <Link href="/onboarding" className={buttonClass("primary")}>
                Go to configuration <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
