import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MemberImport, { type ColumnHelp } from "@/components/onboarding/MemberImport";
import { Notice } from "@/components/onboarding/ui";
import { routeMember } from "@/lib/callType";
import { today } from "@/lib/clock";
import { resolveGym } from "@/lib/gymStore";
import { IMPORT_COLUMNS, IMPORT_KINDS, type ImportKind } from "@/lib/memberImport";
import { MemberStoreError, loadGymMembers, memberDataCounts, type MemberDataCounts } from "@/lib/memberStore";

export const metadata: Metadata = {
  title: "Member data — Retention Router",
};

export const dynamic = "force-dynamic";

/**
 * Connecting a gym's member data: the CSV uploads that work today, what the
 * gym's data looks like once imported, and the platform connections that are
 * not built. Everything on the page is read at request time — counts, routing
 * and the clock they were measured against — so it never shows a stale picture
 * as current.
 */
export default async function MemberDataPage({ params }: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await params;
  const gym = await resolveGym(gymId);
  if (!gym.ok && gym.status === 404) notFound();

  const asOf = today();
  const liveClock = process.env.DATASET_CLOCK === "live";
  const uploadsAvailable = gym.ok && gym.source === "supabase";

  let counts: MemberDataCounts | null = null;
  let dataError: string | null = null;
  let routing: { renewal: number; reengagement: number; winback: number; autoRenew: number; notDue: number; unrouted: number } | null = null;

  if (uploadsAvailable) {
    try {
      counts = await memberDataCounts(gymId);
      if (counts.members > 0) {
        const loaded = await loadGymMembers(gymId, asOf);
        const tally = { renewal: 0, reengagement: 0, winback: 0, autoRenew: 0, notDue: 0, unrouted: loaded.unrouted.length };
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

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <Link href="/onboarding" className="text-sm font-semibold text-zinc-400 transition-colors hover:text-white">
        <span aria-hidden="true">←</span> Set up a gym
      </Link>
      <header className="mt-4 max-w-3xl">
        <h1 className="text-3xl font-black uppercase tracking-tight text-balance sm:text-4xl">Member data</h1>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          For <span className="text-zinc-200">{gymName}</span>. Upload the three tables your platform already exports —
          the same files you&apos;d send an accountant. Each file is checked before anything is written, and imported
          whole or not at all.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="upload-title" className="min-w-0">
          <h2 id="upload-title" className="sr-only">
            Upload CSV files
          </h2>
          {!gym.ok && (
            <div className="mb-4">
              <Notice tone="fault" title="This gym's config can't be used">
                {gym.error}
              </Notice>
            </div>
          )}
          {gym.ok && !uploadsAvailable && (
            <div className="mb-4">
              <Notice tone="caution" title="Uploads aren't available on this deployment yet">
                Member data is stored in Supabase against the gyms table, which hasn&apos;t been created here. Apply{" "}
                <code className="font-mono break-all">supabase/migrations/20260914000000_create_gyms.sql</code> and{" "}
                <code className="font-mono break-all">20260914010000_member_data.sql</code>. The checks below still show exactly what each file
                needs.
              </Notice>
            </div>
          )}
          {dataError && (
            <div className="mb-4">
              <Notice tone="caution" title="Member data isn't readable yet">
                {dataError}
              </Notice>
            </div>
          )}
          <MemberImport gymId={gymId} columns={columns} uploadsAvailable={uploadsAvailable && !dataError} />
        </section>

        <aside aria-labelledby="imported-title" className="xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
            <h2 id="imported-title" className="text-lg font-black uppercase tracking-tight text-white">
              In Supabase now
            </h2>
            {counts ? (
              <dl className="mt-3 grid grid-cols-3 gap-3">
                {(
                  [
                    ["Members", counts.members],
                    ["Contracts", counts.contracts],
                    ["Check-ins", counts.checkins],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-400">{label}</dt>
                    <dd className="mt-0.5 text-xl font-black tabular-nums text-white">{n.toLocaleString("en-AU")}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-zinc-400">Nothing can be counted until the tables exist.</p>
            )}

            {routing && (
              <div className="mt-5 border-t border-zinc-900 pt-4">
                <h3 className="text-sm font-semibold text-white">Who the router would call</h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Measured against {asOf.toISOString().slice(0, 10)}
                  {liveClock ? " (today)" : " — the frozen dataset date, not today. Set DATASET_CLOCK=live for a real gym's data"}
                  . Call history isn&apos;t applied here; the queue and the call route apply it.
                </p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  {(
                    [
                      ["Renewal", routing.renewal],
                      ["Reengagement", routing.reengagement],
                      ["Winback", routing.winback],
                      ["Never called — auto-renews", routing.autoRenew],
                      ["Nothing due", routing.notDue],
                      ["No contract on file", routing.unrouted],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-zinc-400">{label}</dt>
                      <dd className="tabular-nums text-zinc-200">{n.toLocaleString("en-AU")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <p className="mt-5 border-t border-zinc-900 pt-4 text-xs leading-relaxed text-zinc-400">
              The queue uses these members when the deployment sets{" "}
              <code className="font-mono text-zinc-300">MEMBER_SOURCE=supabase</code> and{" "}
              <code className="font-mono text-zinc-300 break-all">MEMBER_SOURCE_GYM_ID={gymId}</code>. Until then it uses the
              synthetic dataset.
            </p>
          </div>
        </aside>
      </div>

    </main>
  );
}
