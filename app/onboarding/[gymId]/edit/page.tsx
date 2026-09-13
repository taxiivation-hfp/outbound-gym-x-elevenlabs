import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import GymGone from "@/components/onboarding/GymGone";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { Notice } from "@/components/onboarding/ui";
import { MAX_UPLOAD_BYTES } from "@/lib/extraction/documentText";
import { extractionConfigured } from "@/lib/extraction/extract";
import { firstRunState } from "@/lib/firstRun";
import { listGyms, resolveGym } from "@/lib/gymStore";
import { memberDataCounts } from "@/lib/memberStore";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";

export const metadata: Metadata = {
  title: "Edit a gym — Retention Router",
};

export const dynamic = "force-dynamic";

/**
 * The setup form, prefilled with a gym's current config, saving with PATCH.
 * Server-rendered from the gyms table so what's in the form is what's stored —
 * a gym read from the repo's seed can be looked at but not saved, because there
 * is no row to change.
 */
export default async function EditGymPage({ params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const [lookup, listing, firstRun, counts] = await Promise.all([
    resolveGym(gymId),
    listGyms(),
    firstRunState(),
    memberDataCounts(gymId).catch(() => null),
  ]);
  if (!lookup.ok && lookup.status === 404) return <GymGone gymId={gymId} firstRunStep={firstRun.gated ? firstRun.step : undefined} />;

  const writesEnabled = onboardingWritesEnabled();
  const saveAvailable = lookup.ok && lookup.source === "supabase" && writesEnabled;
  const saveAdminDetail = !lookup.ok
    ? null
    : lookup.source !== "supabase"
      ? "This gym is read from data/gyms.json because the gyms table isn't available, so there's no row to save changes to."
      : writesEnabled
        ? null
        : ONBOARDING_WRITES_OFF;
  const defaultGym = listing.gyms.find((g) => g.gym_id === listing.default_gym_id) ?? null;

  if (!lookup.ok) {
    return (
      <AppShell current="setup" title="Retention Router" eyebrow="Configuration" firstRunStep={firstRun.gated ? firstRun.step : undefined}>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="max-w-xl">
            <Notice tone="fault" title="This gym can't be edited right now">
              {lookup.error}
            </Notice>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <OnboardingFlow
      editing={lookup.gym}
      saveAvailable={saveAvailable}
      saveAdminDetail={saveAdminDetail}
      extractionAvailable={extractionConfigured()}
      extractionAdminDetail={null}
      existingGyms={[]}
      defaultGym={defaultGym ? { gym_id: defaultGym.gym_id, gym_name: defaultGym.gym_name } : null}
      maxUploadMb={MAX_UPLOAD_BYTES / 1024 / 1024}
      firstRunStep={firstRun.gated ? firstRun.step : null}
      editingMembersDone={Boolean(counts && counts.members > 0 && counts.contracts > 0 && counts.checkins > 0)}
    />
  );
}
