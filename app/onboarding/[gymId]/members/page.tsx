import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import Connectors from "@/components/onboarding/Connectors";
import MemberImport, { type ColumnHelp } from "@/components/onboarding/MemberImport";
import { SampleCsvs } from "@/components/onboarding/SampleFiles";
import { AdminDetail, Card, CardHeader, Notice, focusRing } from "@/components/onboarding/ui";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";
import { routeMember } from "@/lib/callType";
import { today } from "@/lib/clock";
import { firstRunState } from "@/lib/firstRun";
import { resolveGym } from "@/lib/gymStore";
import { IMPORT_COLUMNS, IMPORT_KINDS, type ImportKind } from "@/lib/memberImport";
import { MemberStoreError, loadGymMembers, memberDataCounts, type MemberDataCounts } from "@/lib/memberStore";
import { latestRun } from "@/lib/queueRecompute";

export const metadata: Metadata = {
  title: "Member data — Retention Router",
};

export const dynamic = "force-dynamic";

/** A run's timestamp in UTC, labelled, so it can't be misread as local time. */
function formatRanAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.09em] text-dim">{children}</h3>;
}

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
 * Connecting a gym's member data: the CSV uploads that work today, what the
 * gym's data looks like once imported, and the platform connections that are
 * not built. Everything on the page is read at request time — counts, routing
 * and the clock they were measured against — so it never shows a stale picture
 * as current.
 */
export default async function MemberDataPage({ params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const [gym, firstRun] = await Promise.all([resolveGym(gymId), firstRunState()]);
  if (!gym.ok && gym.status === 404) notFound();

  const asOf = today();
  const liveClock = process.env.DATASET_CLOCK === "live";
  const uploadsAvailable = gym.ok && gym.source === "supabase";
  const writesEnabled = onboardingWritesEnabled();

  let counts: MemberDataCounts | null = null;
  let dataError: string | null = null;
  let routing: { renewal: number; reengagement: number; winback: number; cancellation: number; autoRenew: number; notDue: number; unrouted: number } | null = null;

  // Started now, read below: it never rejects, and it doesn't wait on the counts.
  const lastRunRead = uploadsAvailable ? latestRun(gymId) : null;

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
  const lastRun = lastRunRead ? await lastRunRead : null;

  return (
    <AppShell current="setup" title={gymName} eyebrow="Member data" firstRunStep={firstRun.gated ? firstRun.step : undefined}>
      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-[12.5px] text-muted">
              <Link href="/onboarding" className={`rounded-sm font-semibold text-accent-ink hover:text-ink ${focusRing}`}>
                <span aria-hidden="true">←</span> Configuration
              </Link>
              {gym.ok && (
                <>
                  {" · "}
                  <Link href={`/onboarding/${gymId}/edit`} className={`rounded-sm font-semibold text-accent-ink hover:text-ink ${focusRing}`}>
                    Edit {gymName}
                  </Link>
                </>
              )}
            </p>

            <Card labelledBy="upload-title" prominent>
              <CardHeader id="upload-title" title="Member data" note="three CSVs, checked before anything is written" />
              <p className="mb-4 max-w-[68ch] text-[13px] leading-[1.55] text-muted text-pretty">
                For <span className="font-semibold text-ink-2">{gymName}</span>. Upload the three tables your platform already
                exports — the same files you&apos;d send an accountant. Each file is checked before anything is written, and
                imported whole or not at all.
              </p>
              <div className="mb-4">
                <SampleCsvs />
              </div>

              <div className="mb-4 flex flex-col gap-2.5 empty:hidden">
                {!gym.ok && (
                  <Notice tone="fault" title="This gym's config can't be used">
                    {gym.error}
                  </Notice>
                )}
                {gym.ok && !uploadsAvailable && (
                  <Notice tone="caution" title="Uploads aren't available on this deployment yet">
                    Member data is stored in Supabase against the gyms table, which hasn&apos;t been created here. Apply{" "}
                    <code className="font-mono break-all">supabase/migrations/20260914000000_create_gyms.sql</code> and{" "}
                    <code className="font-mono break-all">20260914010000_member_data.sql</code>. The checks below still show exactly
                    what each file needs.
                  </Notice>
                )}
                {dataError && (
                  <Notice tone="caution" title="Member data isn't readable yet">
                    {dataError}
                  </Notice>
                )}
                {uploadsAvailable && !dataError && !writesEnabled && (
                  <Notice tone="caution" title="Imports are switched off here">
                    <p>Files can be checked, but nothing can be imported until your admin switches imports on.</p>
                    <AdminDetail>{ONBOARDING_WRITES_OFF}</AdminDetail>
                  </Notice>
                )}
              </div>

              <MemberImport gymId={gymId} columns={columns} uploadsAvailable={uploadsAvailable && !dataError} importAvailable={writesEnabled} />

              <div className="mt-[26px]">
                <Connectors />
              </div>
            </Card>
          </div>

          <aside aria-labelledby="imported-title" className="min-w-0 lg:sticky lg:top-0">
            <div className="flex flex-col gap-3.5 rounded-2xl border border-line-strong bg-surface p-[18px] shadow-window">
              <h2 id="imported-title" className="m-0 font-display text-[17px] font-bold tracking-[-0.02em] text-ink">
                In Supabase now
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
                      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-dim">{label}</dt>
                      <dd className="m-0 font-display text-[22px] font-bold tabular-nums tracking-[-0.02em] text-ink">{n.toLocaleString("en-AU")}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[12.5px] text-dim">Nothing can be counted until the tables exist.</p>
              )}

              {routing && (
                <div className="flex flex-col gap-2 border-t border-line pt-[13px]">
                  <Eyebrow>Who the router would call</Eyebrow>
                  <p className="text-[11.5px] leading-[1.45] text-dim text-pretty">
                    Measured against {asOf.toISOString().slice(0, 10)}
                    {liveClock ? " (today)" : " — the frozen dataset date, not today. Set DATASET_CLOCK=live for a real gym's data"}.
                    Call history isn&apos;t applied here; the queue and the call route apply it.
                  </p>
                  <Tally
                    rows={[
                      ["Renewal", routing.renewal],
                      ["Reengagement", routing.reengagement],
                      ["Winback", routing.winback],
                      ["Cancellation — asked to cancel", routing.cancellation],
                      ["Never called — auto-renews", routing.autoRenew],
                      ["Nothing due", routing.notDue],
                      ["No contract on file", routing.unrouted],
                    ]}
                  />
                </div>
              )}

              {lastRun && (
                <div className="flex flex-col gap-2 border-t border-line pt-[13px]">
                  <Eyebrow>Nightly recompute</Eyebrow>
                  {lastRun.run ? (
                    <>
                      <p className="text-[11.5px] leading-[1.45] text-dim text-pretty">
                        Last ran {formatRanAt(lastRun.run.ran_at)}, measured against {lastRun.run.as_of}
                        {lastRun.run.clock === "live" ? " (the date it ran)" : " (the frozen dataset date)"}.
                      </p>
                      <Tally
                        rows={[
                          ["Due a call", lastRun.run.counts.due],
                          ["Never called — auto-renews", lastRun.run.counts.auto_renew],
                          ["Blocked by call history", lastRun.run.counts.do_not_contact + lastRun.run.counts.cooldown + lastRun.run.counts.max_attempts],
                        ]}
                      />
                      {lastRun.run.history_error && (
                        <p className="rounded-[9px] border border-flag bg-flag-wash px-[11px] py-2 text-[11.5px] leading-[1.45] text-ink-2">
                          <strong className="text-flag-ink">Check this:</strong> that run was recorded with a problem —{" "}
                          {lastRun.run.history_error}. Calls still re-check everything when they are placed.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-[11.5px] leading-[1.45] text-dim">{lastRun.notice}</p>
                  )}
                </div>
              )}

              <p className="border-t border-line pt-[13px] text-[11.5px] leading-[1.45] text-dim text-pretty">
                The queue uses these members when the deployment sets{" "}
                <code className="font-mono text-ink-2">MEMBER_SOURCE=supabase</code> and{" "}
                <code className="font-mono text-ink-2 break-all">MEMBER_SOURCE_GYM_ID={gymId}</code>. Until then it uses the
                synthetic dataset.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
