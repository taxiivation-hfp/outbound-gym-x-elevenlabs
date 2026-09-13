import type { Metadata } from "next";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { MAX_UPLOAD_BYTES } from "@/lib/extraction/documentText";
import { extractionConfigured } from "@/lib/extraction/extract";
import { firstRunState } from "@/lib/firstRun";
import { listGyms } from "@/lib/gymStore";
import { memberDataCounts } from "@/lib/memberStore";
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
  const [listing, firstRun] = await Promise.all([listGyms(), firstRunState()]);
  const extractionAvailable = extractionConfigured();
  const writesEnabled = onboardingWritesEnabled();
  const saveAvailable = listing.source === "supabase" && writesEnabled;
  const saveAdminDetail = listing.source !== "supabase" ? listing.notice : writesEnabled ? null : ONBOARDING_WRITES_OFF;
  const defaultGym = listing.gyms.find((g) => g.gym_id === listing.default_gym_id) ?? null;
  // How far each saved gym has got, so the list can say which one is waiting on
  // member data. A count that can't be read shows as unknown, never as zero.
  const existingGyms =
    listing.source === "supabase"
      ? await Promise.all(
          listing.gyms.map(async (g) => ({
            gym_id: g.gym_id,
            gym_name: g.gym_name,
            members: await memberDataCounts(g.gym_id).then(
              (c) => c.members,
              () => null
            ),
          }))
        )
      : [];

  return (
    <OnboardingFlow
      saveAvailable={saveAvailable}
      saveAdminDetail={saveAdminDetail}
      extractionAvailable={extractionAvailable}
      extractionAdminDetail={extractionAvailable ? null : "Set ANTHROPIC_API_KEY on the deployment to turn on document reading (model: claude-haiku-4-5)."}
      existingGyms={existingGyms}
      defaultGym={defaultGym ? { gym_id: defaultGym.gym_id, gym_name: defaultGym.gym_name } : null}
      maxUploadMb={MAX_UPLOAD_BYTES / 1024 / 1024}
      firstRunStep={firstRun.gated ? firstRun.step : null}
    />
  );
}
