import IntelligenceView from "@/components/intelligence/IntelligenceView";
import { buildIntelligence } from "@/lib/intelligence";

/**
 * Health of the gym, and why members leave — in their own words, because
 * something asked them.
 *
 * Every retention product records *that* a member churned. This records *why*,
 * broken down by the cohort they were in, the call that reached them, and how
 * long they had been a member, and surrounds it with the numbers an operator
 * runs their week on. Everything is read from the database and data files; the
 * themed summary of what members said was written by the nightly recompute, so
 * no model is called to render this page.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Health of the gym — Retention Router",
};

export default async function IntelligencePage() {
  return <IntelligenceView data={await buildIntelligence()} />;
}
