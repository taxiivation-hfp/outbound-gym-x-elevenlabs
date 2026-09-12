import MemberTable from "@/components/MemberTable";
import { buildQueueView } from "@/lib/queueView";

/**
 * Every member, with the routing decision and the sentence behind it.
 *
 * This page exists for auditability rather than for operations: search a name,
 * read why that person is or is not being called today. It is also the fastest
 * way to check the claim the product is built on — filter to auto-renew and every
 * row says "never called", including the ones who have been away for months.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "All members — Retention Router",
};

export default async function MembersPage() {
  const view = await buildQueueView();

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
          All members
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          All {view.counts.total} of them, with today&apos;s decision and the reason for it.
          Filter to auto-renew to see the rule the product is built on: every one of those
          rows says never called, however long they have been away.
        </p>
        <p className="mt-2 text-xs text-zinc-600">Member data as of {view.as_of}</p>
      </header>

      <section className="mt-8">
        <MemberTable entries={view.entries} />
      </section>
    </main>
  );
}
