import type { Metadata } from "next";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { MAX_UPLOAD_BYTES } from "@/lib/extraction/documentText";
import { extractionConfigured } from "@/lib/extraction/extract";
import { listGyms } from "@/lib/gymStore";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";

export const metadata: Metadata = {
  title: "Configuration — Retention Router",
};

/**
 * Where a gym goes from nothing to a working agent.
 *
 * Server-rendered so the page says up front what this deployment can actually
 * do — whether new gyms can be saved (the gyms table exists and writes are on),
 * whether documents can be read (an extraction key is set) — instead of letting
 * someone fill in the form and discover it at the Save button.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const listing = await listGyms();
  const extractionAvailable = extractionConfigured();
  const writesEnabled = onboardingWritesEnabled();
  const saveAvailable = listing.source === "supabase" && writesEnabled;
  const saveAdminDetail = listing.source !== "supabase" ? listing.notice : writesEnabled ? null : ONBOARDING_WRITES_OFF;
  const defaultGym = listing.gyms.find((g) => g.gym_id === listing.default_gym_id) ?? null;

  return (
    <OnboardingFlow
      saveAvailable={saveAvailable}
      saveAdminDetail={saveAdminDetail}
      extractionAvailable={extractionAvailable}
      extractionAdminDetail={extractionAvailable ? null : "Set ANTHROPIC_API_KEY on the deployment to turn on document reading (model: claude-haiku-4-5)."}
      existingGyms={listing.gyms.map((g) => ({ gym_id: g.gym_id, gym_name: g.gym_name }))}
      defaultGym={defaultGym ? { gym_id: defaultGym.gym_id, gym_name: defaultGym.gym_name } : null}
      maxUploadMb={MAX_UPLOAD_BYTES / 1024 / 1024}
    />
  );
}
