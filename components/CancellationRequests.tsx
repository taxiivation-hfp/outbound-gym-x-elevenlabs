/**
 * PLACEHOLDER UI — pass one. Correct data, plain layout, no design investment.
 * Pass three replaces this component wholesale; don't polish it.
 *
 * Members who have asked to cancel, from the member data. Visibility only:
 * nothing about who is called has changed. Auto-renewing members here are
 * still excluded like every other auto-renewer, and the screen says so rather
 * than implying the path for them exists.
 */
import { callTypeLabel } from "@/lib/labels";
import type { QueueEntry } from "@/lib/queueView";

function requestedOn(iso: string): string {
  return iso.slice(0, 10);
}

function status(entry: QueueEntry): string {
  if (entry.blocked_by === "auto_renew") return "Not called — auto-renew exclusion still applies";
  if (entry.call_type) return `Due a ${callTypeLabel[entry.call_type].toLowerCase()} call (unchanged by the request)`;
  return entry.blocked_reason ? `Not called — ${entry.blocked_reason}` : "Not called";
}

export default function CancellationRequests({ entries }: { entries: QueueEntry[] }) {
  const requests = entries
    .filter((e) => e.cancellation_requested)
    .sort((a, b) => (b.cancellation_requested ?? "").localeCompare(a.cancellation_requested ?? ""));
  const autoRenewing = requests.filter((e) => e.auto_renew).length;

  return (
    <section className="mt-10 rounded-2xl border border-zinc-800 p-5">
      <h2 className="text-lg font-bold">Cancellation requests</h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-400">
        {requests.length} member{requests.length === 1 ? " has" : "s have"} asked to cancel, {autoRenewing} of them on an
        auto-renewing membership. Those {autoRenewing} are the only auto-renewing members the system would ever call — once
        someone has moved to end it, a call is no longer the thing that could end it.{" "}
        <span className="font-semibold text-amber-300">That path is not built yet.</span> Today they are excluded like every
        other auto-renewer, and nothing here changes who is called.
      </p>
      {requests.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No cancellation requests in the member data.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-4 font-normal">Member</th>
                <th className="py-1 pr-4 font-normal">Asked on</th>
                <th className="py-1 pr-4 font-normal">Contract</th>
                <th className="py-1 pr-4 font-normal">Away</th>
                <th className="py-1 pr-4 font-normal">What happens today</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {requests.map((e) => (
                <tr key={e.member_id} className="border-t border-zinc-900">
                  <td className="py-1.5 pr-4">{e.name}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{requestedOn(e.cancellation_requested as string)}</td>
                  <td className="py-1.5 pr-4">
                    {e.contract_type}
                    {e.auto_renew ? " · auto-renews" : " · fixed term"}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums">{e.days_since_visit} days</td>
                  <td className="py-1.5 pr-4 text-xs text-zinc-400">
                    {e.auto_renew && <span className="mr-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-300">pending</span>}
                    {status(e)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
