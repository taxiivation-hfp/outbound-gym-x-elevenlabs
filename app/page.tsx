import CallQueue from "@/components/calls/CallQueue";
import { buildQueueView } from "@/lib/queueView";

/**
 * The queue, computed on the server.
 *
 * Eligibility needs Supabase — do-not-contact and the cooldown live in call
 * history — so this is a server component that calls the view builder directly
 * rather than having the browser fetch its own API. The screen and the call
 * route then share one definition of who is due, which is the only way the
 * "never call an auto-renewer" rule can be true of both.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Call queue — Retention Router",
};

export default async function Home() {
  const view = await buildQueueView();
  const gymName = view.gyms.find((g) => g.gym_id === view.default_gym_id)?.gym_name ?? "Retention Router";
  return <CallQueue view={view} gymName={gymName} />;
}
