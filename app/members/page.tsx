import MemberTable from "@/components/MemberTable";
import AppShell, { HeaderPill } from "@/components/shell/AppShell";
import { longDate } from "@/components/calls/format";
import { buildQueueView } from "@/lib/queueView";

/**
 * Every member, with the routing decision and the sentence behind it.
 *
 * This page exists for auditability rather than for operations: search a name,
 * read why that person is or is not being called today. It is also the fastest
 * way to check the claim the product is built on — filter to auto-renew and every
 * row says why they aren't called, including the ones who have been away for months.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "All members — Retention Router",
};

export default async function MembersPage() {
  const view = await buildQueueView();
  const gymName = view.gyms.find((g) => g.gym_id === view.default_gym_id)?.gym_name ?? "Retention Router";

  return (
    <AppShell
      current="members"
      title={gymName}
      eyebrow="Members"
      memberCount={view.counts.total}
      headerBody={
        <HeaderPill>
          <span className="font-bold">Member data</span>
          <span className="opacity-75">as of {longDate(view.as_of)}</span>
        </HeaderPill>
      }
    >
      <MemberTable entries={view.entries} />
    </AppShell>
  );
}
