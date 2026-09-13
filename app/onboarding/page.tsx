import AppShell from "@/components/shell/AppShell";
import type { Metadata } from "next";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { extractionConfigured } from "@/lib/extraction/extract";
import { listGyms } from "@/lib/gymStore";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";

export const metadata: Metadata = {
  title: "Set up a gym — Retention Router",
};

/**
 * Where a gym goes from nothing to a working agent.
 *
 * Server-rendered so the page says up front what this deployment can actually
 * do — whether new gyms can be saved (the gyms table exists), whether documents
 * can be read (an extraction key is set) — instead of letting someone fill in
 * eleven fields and discover it at the Save button.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const listing = await listGyms();
  const extractionAvailable = extractionConfigured();
  const writesEnabled = onboardingWritesEnabled();
  const saveAvailable = listing.source === "supabase" && writesEnabled;
  const saveAdminDetail = listing.source !== "supabase" ? listing.notice : writesEnabled ? null : ONBOARDING_WRITES_OFF;

  return (
    <AppShell current="setup" title="Retention Router" eyebrow="Voice agent setup">
      <div className="min-h-0 flex-1 overflow-auto">
<main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-black uppercase tracking-tight text-balance sm:text-4xl">Set up a gym</h1>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-zinc-400 text-pretty">
          Charlie is the voice agent that calls your members. Tell him what this gym can offer and what he can say
          about it. You pick numbers, yes or no, and choices; the app writes the words Charlie reads, and you can read
          them before anything is saved.
        </p>
      </header>

      <div className="mt-8">
        <OnboardingFlow
          saveAvailable={saveAvailable}
          saveAdminDetail={saveAdminDetail}
          extractionAvailable={extractionAvailable}
          extractionAdminDetail={extractionAvailable ? null : "Set ANTHROPIC_API_KEY on the deployment to turn on document reading (model: claude-haiku-4-5)."}
          existingGyms={listing.gyms.map((g) => ({ gym_id: g.gym_id, gym_name: g.gym_name }))}
        />
      </div>
    </main>
      </div>
    </AppShell>
  );
}
