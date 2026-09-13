import EvalsView from "@/components/evals/EvalsView";
import { loadEvalsData } from "@/components/evals/data";

/**
 * How we know it works, rendered from committed files.
 *
 * No database and no model: `evals/results/*.json` are written by `npm run
 * evals` and committed, and the price-list panel runs the real sanitiser over a
 * committed extraction. They are bundled with the page (no request reads the
 * disk), and `loadEvalsData` reshapes them on the server, so the browser
 * receives the current run's transcripts and every run's scores, not every
 * run's transcripts.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Evals — Retention Router",
};

export default function EvalsPage() {
  return <EvalsView data={loadEvalsData()} />;
}
