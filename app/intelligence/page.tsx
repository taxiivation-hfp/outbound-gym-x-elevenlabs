import { longDate } from "@/components/calls/format";
import { Notice } from "@/components/intelligence/Card";
import IntelligenceView from "@/components/intelligence/IntelligenceView";
import RefreshButton from "@/components/intelligence/RefreshButton";
import AppShell, { HeaderPill } from "@/components/shell/AppShell";
import { buildIntelligence } from "@/lib/intelligence";
import { listGyms } from "@/lib/gymStore";

/**
 * The overview: the health of the gym, why members leave — in their own words,
 * because something asked them — and what the calls did and cost.
 *
 * Everything is read from the database and data files by `buildIntelligence`,
 * which `/api/intelligence` returns too; the themed summary of what members
 * said was written by the nightly recompute, so no model is called to render
 * this page. The title is the same default gym the queue speaks for.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Overview — Retention Router",
};

export default async function IntelligencePage() {
  // buildIntelligence reads the gym listing too but doesn't return it, so the
  // header reads it again — and says so when that read fell back or dropped rows.
  const [data, gyms] = await Promise.all([buildIntelligence(), listGyms()]);
  const gymName = gyms.gyms.find((g) => g.gym_id === gyms.default_gym_id)?.gym_name ?? "Retention Router";
  return (
    <AppShell
      current="overview"
      title={gymName}
      eyebrow="Overview"
      headerBody={
        <HeaderPill>
          <span className="font-bold">Member data</span>
          <span className="opacity-75">as of {longDate(data.as_of)}</span>
        </HeaderPill>
      }
      headerActions={<RefreshButton />}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {gyms.notice && (
          <Notice className="mb-3.5">
            <strong className="text-flag-ink">
              {gyms.source === "seed" ? "The header shows a seed gym." : "Check the gyms table."}
            </strong>{" "}
            {gyms.notice}
          </Notice>
        )}
        <IntelligenceView data={data} />
      </div>
    </AppShell>
  );
}
