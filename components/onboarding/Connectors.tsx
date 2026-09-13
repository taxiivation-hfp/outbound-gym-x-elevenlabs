import { CONNECTORS } from "@/lib/connectors";

/**
 * Platform connectors, labelled as what they are: not built. No buttons, no
 * spinners, nothing that could read as "connected". Each platform shows the three
 * tables it would supply, the auto-renew field that decides who may be called,
 * and what an integration would need — which is the honest reason the CSV
 * upload above exists.
 */
export default function Connectors() {
  return (
    <section aria-labelledby="connectors-title">
      <h2 id="connectors-title" className="text-lg font-black uppercase tracking-tight text-white">
        Platform connections
      </h2>
      <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
        None of these is built. The CSV upload above works with every platform today, because every platform exports
        these three tables. A direct connection would replace the upload, not the checks.
      </p>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-[56rem] w-full divide-y divide-zinc-900 text-left text-sm">
          <caption className="sr-only">Gym platforms, their status, and the fields each would supply</caption>
          <thead className="bg-zinc-950/60 text-xs text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Platform</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Members</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Contracts</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Check-ins</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Does it say if a contract auto-renews?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 align-top">
            {CONNECTORS.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="px-4 py-3 font-semibold text-white">
                  {c.name}
                  <span className="mt-1 block w-fit rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">
                    Not built
                  </span>
                  <span className="mt-2 block text-xs font-normal leading-relaxed text-zinc-400">Needs: {c.needs}</span>
                </th>
                <td className="px-4 py-3 text-zinc-300">{c.members}</td>
                <td className="px-4 py-3 text-zinc-300">{c.contracts}</td>
                <td className="px-4 py-3 text-zinc-300">{c.checkins}</td>
                <td className="px-4 py-3">
                  <p className={`text-sm font-semibold ${c.autoRenew.exposed ? "text-zinc-200" : "text-amber-300"}`}>
                    {c.autoRenew.exposed ? "Yes" : "No — inferred"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{c.autoRenew.detail}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
