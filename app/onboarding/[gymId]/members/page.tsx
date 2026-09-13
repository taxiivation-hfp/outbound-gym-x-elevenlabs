import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import GymGone from "@/components/onboarding/GymGone";
import MemberImport, { type ColumnHelp } from "@/components/onboarding/MemberImport";
import SetupSteps, { SamplesHint } from "@/components/onboarding/SetupSteps";
import { AdminDetail, Card, CardHeader, Notice } from "@/components/onboarding/ui";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";
import { routeMember } from "@/lib/callType";
import { today } from "@/lib/clock";
import { firstRunState } from "@/lib/firstRun";
import { resolveGym } from "@/lib/gymStore";
import { currentMemberSource } from "@/lib/memberSource";
import { IMPORT_COLUMNS, IMPORT_KINDS, type ImportKind } from "@/lib/memberImport";
import { MemberStoreError, loadGymMembers, memberDataCounts, type MemberDataCounts } from "@/lib/memberStore";

export const metadata: Metadata = {
  title: "Member data — Retention Router",
};

export const dynamic = "force-dynamic";

function Tally({ rows }: { rows: ReadonlyArray<readonly [string, number]> }) {
  return (
    <dl className="m-0 flex flex-col gap-1.5 text-[12.5px]">
      {rows.map(([label, n]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 font-bold tabular-nums text-ink">{n.toLocaleString("en-AU")}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Step two of setup: a gym's member data. The three CSV uploads, what is stored
 * now, and who the router would call from it — all read at request time, so an
 * import refreshes the counts and, once all three files are in, the setup steps
 * offer the call queue as the next step.
 */
export default async function MemberDataPage({ params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const [gym, firstRun, queueSource] = await Promise.all([
    resolveGym(gymId),
    firstRunState(),
    currentMemberSource().catch(() => null),
  ]);
  const queueUsesThisGym = queueSource?.kind === "supabase" && queueSource.gymId === gymId;
  if (!gym.ok && gym.status === 404) return <GymGone gymId={gymId} firstRunStep={firstRun.gated ? firstRun.step : undefined} />;

  const asOf = today();
  const uploadsAvailable = gym.ok && gym.source === "supabase";
  const writesEnabled = onboardingWritesEnabled();

  let counts: MemberDataCounts | null = null;
  let dataError: string | null = null;
  let routing: { renewal: number; reengagement: number; winback: number; cancellation: number; autoRenew: number; notDue: number; unrouted: number } | null = null;

  if (uploadsAvailable) {
    try {
      counts = await memberDataCounts(gymId);
      if (counts.members > 0) {
        const loaded = await loadGymMembers(gymId, asOf);
        const tally = { renewal: 0, reengagement: 0, winback: 0, cancellation: 0, autoRenew: 0, notDue: 0, unrouted: loaded.unrouted.length };
        for (const member of loaded.members) {
          const r = routeMember(member, asOf);
          if (r.auto_renew_excluded) tally.autoRenew += 1;
          else if (r.call_type) tally[r.call_type] += 1;
          else tally.notDue += 1;
        }
        routing = tally;
      }
    } catch (err) {
      dataError = err instanceof MemberStoreError ? err.message : `Member data couldn't be read: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const columns = Object.fromEntries(
    IMPORT_KINDS.map((kind) => [kind, IMPORT_COLUMNS[kind].map(({ key, label, required, example }) => ({ key, label, required, example }))])
  ) as Record<ImportKind, ColumnHelp[]>;

  const gymName = gym.ok ? gym.gym.gym_name : gymId;
  // Done means all three tables have rows: without contracts nobody can be
  // routed, and without check-ins every member looks like they stopped coming.
  const filesIn = counts ? [counts.members, counts.contracts, counts.checkins].filter((n) => n > 0).length : 0;
  const membersDone = filesIn === 3;
  const status = !counts ? undefined : membersDone ? "All three files imported." : `${filesIn} of 3 files imported.`;

  return (
    <AppShell current="setup" title={gymName} eyebrow="Member data" firstRunStep={firstRun.gated ? firstRun.step : undefined}>
      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        <div className="flex flex-col gap-4">
          <SetupSteps current="members" gymId={gym.ok ? gymId : null} gymDone={gym.ok} membersDone={membersDone} status={status} />

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card labelledBy="upload-title" prominent>
              <CardHeader id="upload-title" title="Import member data" note="three CSV files, in order" />
              <div className="mb-4 mt-1">
                <SamplesHint />
              </div>

              <div className="mb-4 flex flex-col gap-2.5 empty:hidden">
                {!gym.ok && (
                  <Notice tone="fault" title="This gym's settings can't be used">
                    {gym.error}
                  </Notice>
                )}
                {gym.ok && !uploadsAvailable && (
                  <Notice tone="caution" title="Uploads aren't available here yet">
                    <AdminDetail>Apply supabase/migrations/20260914000000_create_gyms.sql and 20260914010000_member_data.sql.</AdminDetail>
                  </Notice>
                )}
                {dataError && (
                  <Notice tone="caution" title="Member data isn't readable yet">
                    {dataError}
                  </Notice>
                )}
                {uploadsAvailable && !dataError && !writesEnabled && (
                  <Notice tone="caution" title="Imports are switched off here">
                    <AdminDetail>{ONBOARDING_WRITES_OFF}</AdminDetail>
                  </Notice>
                )}
              </div>

              <MemberImport gymId={gymId} columns={columns} uploadsAvailable={uploadsAvailable && !dataError} importAvailable={writesEnabled} />
            </Card>

            <aside aria-labelledby="imported-title" className="min-w-0 lg:sticky lg:top-0">
              <div className="flex flex-col gap-3.5 rounded-2xl border border-line-strong bg-surface p-[18px] shadow-window">
                <h2 id="imported-title" className="m-0 font-display text-[17px] font-bold tracking-[-0.02em] text-ink">
                  Stored now
                </h2>
                {counts ? (
                  <dl className="m-0 grid grid-cols-3 gap-3">
                    {(
                      [
                        ["Members", counts.members],
                        ["Contracts", counts.contracts],
                        ["Check-ins", counts.checkins],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <dt className="text-[11.5px] font-semibold text-dim">{label}</dt>
                        <dd className="m-0 font-display text-[22px] font-bold tabular-nums tracking-[-0.02em] text-ink">{n.toLocaleString("en-AU")}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[12.5px] text-dim">Nothing stored yet.</p>
                )}

                {routing && (
                  <div className="flex flex-col gap-2 border-t border-line pt-[13px]">
                    <h3 className="m-0 flex items-baseline justify-between gap-2 text-[13px] font-bold text-ink">
                      Who would be called
                      <span className="text-[11.5px] font-normal text-dim">as of {asOf.toISOString().slice(0, 10)}</span>
                    </h3>
                    <Tally
                      rows={[
                        ["Renewal", routing.renewal],
                        ["Reengagement", routing.reengagement],
                        ["Winback", routing.winback],
                        ["Asked to cancel", routing.cancellation],
                        ["Never called: auto-renews", routing.autoRenew],
                        ["Nothing due", routing.notDue],
                        ["No contract on file", routing.unrouted],
                      ]}
                    />
                  </div>
                )}

                {counts && counts.members > 0 && !queueUsesThisGym && (
                  <div className="border-t border-line pt-[13px] text-[12px] text-ink-2">
                    The call queue isn&apos;t reading this gym&apos;s members on this deployment.
                    <AdminDetail>Set MEMBER_SOURCE=onboarded and DATASET_CLOCK=live, or MEMBER_SOURCE=supabase with MEMBER_SOURCE_GYM_ID={gymId}.</AdminDetail>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
