import Link from "next/link";
import AboutArticle, { type AboutFacts } from "@/components/about/AboutArticle";
import AppShell from "@/components/shell/AppShell";
import { buildQueueView } from "@/lib/queueView";

/**
 * Why the product exists, as an article. The prose is fixed; every number in
 * it is read here from `buildQueueView()` — the same queue counts and campaign
 * economics the call queue shows — so the page cannot state a count the queue
 * disagrees with.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "About — Retention Router",
};

export default async function AboutPage() {
  const view = await buildQueueView();
  const { counts, economics } = view;

  const facts: AboutFacts = {
    total: counts.total,
    neverCalled: counts.excluded_auto_renew,
    autoRenewAskedToCancel: view.entries.filter((e) => e.auto_renew && e.cancellation_requested).length,
    nearRollover: view.auto_renewers_inside_expiry_window,
    blocked: {
      auto_renew: counts.excluded_auto_renew,
      do_not_contact: counts.excluded_do_not_contact,
      nothing_to_offer: counts.excluded_nothing_to_offer,
      cooldown: counts.excluded_cooldown,
      max_attempts: counts.excluded_max_attempts,
      not_due: counts.not_due,
    },
    economics: {
      calls: economics.calls,
      cost_per_call: economics.cost_per_call,
      average_retained_value: economics.average_retained_value,
      break_even_conversion: economics.break_even_conversion,
      retained_months: economics.retained_months,
    },
    historyError: view.history_error,
  };

  return (
    <AppShell
      current="about"
      title="Retention Router"
      eyebrow="About"
      memberCount={counts.total}
      headerActions={
        <>
          <Link
            href="/evals"
            className="flex h-[34px] items-center rounded-[10px] border border-line bg-control px-3.5 text-[12.5px] font-bold text-ink no-underline transition-colors hover:border-accent-line"
          >
            See the evals
          </Link>
          <Link
            href="/"
            className="flex h-[34px] items-center rounded-[10px] border border-accent-line bg-accent px-3.5 text-[12.5px] font-bold text-on-accent no-underline"
          >
            Open the product
          </Link>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto">
        <AboutArticle facts={facts} />
      </div>
    </AppShell>
  );
}
