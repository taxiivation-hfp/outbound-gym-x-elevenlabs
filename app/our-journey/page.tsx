import EvalsView from "@/components/evals/EvalsView";
import { loadEvalsData } from "@/components/evals/data";

/**
 * Our Journey: the decisions and what broke, with the evals as the
 * evidence, rendered from committed files. Written for a judge, not a gym
 * manager.
 *
 * No database and no model: `evals/results/*.json` are written by `npm run
 * evals` and committed, and the price-list panel runs the real sanitiser over a
 * committed extraction. They are bundled with the page (no request reads the
 * disk), and `loadEvalsData` reshapes them on the server, so the browser
 * receives the current run's transcripts (and the one older transcript the
 * ladder story needs) and every run's scores, not every run's transcripts.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Our Journey — Retention Router",
};

export default function OurJourneyPage() {
  return <EvalsView data={loadEvalsData()} />;
}
