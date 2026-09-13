import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { Notice } from "@/components/onboarding/ui";
import { extractionConfigured } from "@/lib/extraction/extract";
import { resolveGym } from "@/lib/gymStore";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";

export const metadata: Metadata = {
  title: "Edit a gym — Retention Router",
};

export const dynamic = "force-dynamic";

/**
 * The onboarding form, prefilled with a gym's current config, saving with
 * PATCH. Server-rendered from the gyms table so what's in the form is what's
 * stored — a gym read from the repo's seed can be looked at but not saved,
 * because there is no row to change.
 */
export default async function EditGymPage({ params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const lookup = await resolveGym(gymId);
  if (!lookup.ok && lookup.status === 404) notFound();

  const writesEnabled = onboardingWritesEnabled();
  const saveAvailable = lookup.ok && lookup.source === "supabase" && writesEnabled;
  const saveAdminDetail = !lookup.ok
    ? null
    : lookup.source !== "supabase"
      ? "This gym is read from data/gyms.json because the gyms table isn't available, so there's no row to save changes to."
      : writesEnabled
        ? null
        : ONBOARDING_WRITES_OFF;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">Edit {lookup.ok ? lookup.gym.gym_name : "a gym"}</h1>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          The same questions as setting a gym up, with its current answers filled in. The next call placed for this gym uses
          whatever you save.
        </p>
      </header>
      <div className="mt-8">
        {lookup.ok ? (
          <OnboardingFlow
            editing={lookup.gym}
            saveAvailable={saveAvailable}
            saveAdminDetail={saveAdminDetail}
            extractionAvailable={extractionConfigured()}
            extractionAdminDetail={null}
            existingGyms={[]}
          />
        ) : (
          <div className="max-w-xl">
            <Notice tone="fault" title="This gym can't be edited right now">
              {lookup.error}
            </Notice>
          </div>
        )}
      </div>
    </main>
  );
}
