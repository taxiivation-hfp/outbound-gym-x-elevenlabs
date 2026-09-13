import { CONNECTORS } from "@/lib/connectors";
import { Pill } from "./ui";

/**
 * Platform connectors, labelled as what they are: not built. No buttons, no
 * spinners, nothing that could read as "connected". Each platform shows the three
 * tables it would supply, the auto-renew field that decides who may be called,
 * and what an integration would need — which is the honest reason the CSV
 * upload exists. Every word on a card is from lib/connectors.ts.
 */
export default function Connectors() {
  return (
    <div aria-labelledby="connectors-title" role="group">
      <h3 id="connectors-title" className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[0.09em] text-dim">
        Direct connections
      </h3>
      <p className="mb-3.5 max-w-[64ch] text-[12.5px] leading-[1.5] text-muted text-pretty">
        None of these is built. The CSV upload works with every platform today, because every platform exports these three
        tables. A direct connection would replace the upload, not the checks.
      </p>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3 p-0">
        {CONNECTORS.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-dashed border-line-strong bg-canvas p-[15px]">
            <div className="flex items-center gap-2.5">
              <span className="text-[13.5px] font-bold text-ink">{c.name}</span>
              <Pill tone="plain">not built</Pill>
            </div>
            <dl className="m-0 flex flex-col gap-1.5 text-[11.5px] leading-[1.45]">
              {(
                [
                  ["Members", c.members],
                  ["Contracts", c.contracts],
                  ["Check-ins", c.checkins],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2">
                  <dt className="text-dim">{label}</dt>
                  <dd className="m-0 text-ink-2 wrap-anywhere">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11.5px] leading-[1.45] text-muted text-pretty">
              <strong className={c.autoRenew.exposed ? "text-ink-2" : "text-flag-ink"}>
                Auto-renew: {c.autoRenew.exposed ? "exposed" : "inferred"}.
              </strong>{" "}
              {c.autoRenew.detail}
            </p>
            <p className="mt-auto border-t border-line pt-2 text-[11.5px] leading-[1.45] text-dim text-pretty">Needs: {c.needs}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
