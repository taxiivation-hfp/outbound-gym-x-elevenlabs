import Link from "next/link";
import latest from "@/evals/results/latest.json";

/**
 * The eval results, straight from the committed run file.
 *
 * No fetch and no database: `evals/results/latest.json` is written by
 * `npm run evals` and committed, so this page is a rendering of an artefact
 * anyone can open in the repo and check against what is on screen.
 */
export const metadata = {
  title: "Evals — Retention Router",
};

interface Assertion {
  name: string;
  passed: boolean;
  detail: string;
}

interface Turn {
  role: string;
  message: string;
}

interface ScenarioResult {
  id: string;
  brief_item: number | null;
  name: string;
  call_type: string;
  gym_id: string;
  why: string;
  passed: boolean;
  local: Assertion[];
  llm: { conditions: string[]; result: string | null; rationale: string | null; passed: boolean };
  turns: Turn[];
  error: string | null;
}

interface GuardResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  why: string;
}

const run = latest as unknown as {
  run_at: string;
  label: string | null;
  guards: { passed: number; total: number; results: GuardResult[] };
  conversations: {
    passed: number;
    total: number;
    by_agent: Record<string, { passed: number; total: number }>;
    results: ScenarioResult[];
  };
};

export default function EvalsPage() {
  const { guards, conversations } = run;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">Evals</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Two suites. Nineteen deterministic assertions over the routing rules — no model, no
          network — and fifteen simulated calls against the real agents, each with regex
          conditions checked here and one plain-English condition handed to a judge. A
          scenario passes only if both halves do.
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          Run {new Date(run.run_at).toLocaleString()}
          {run.label ? ` — ${run.label}` : ""}. Written by{" "}
          <code className="font-mono text-zinc-500">npm run evals</code> and committed to{" "}
          <code className="font-mono text-zinc-500">evals/results/</code>.
        </p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Score label="Routing guards" passed={guards.passed} total={guards.total} />
        <Score
          label="Conversations"
          passed={conversations.passed}
          total={conversations.total}
        />
        {Object.entries(conversations.by_agent).map(([agent, s]) => (
          <Score key={agent} label={`${agent} agent`} passed={s.passed} total={s.total} />
        ))}
      </section>

      <section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-lg font-black uppercase tracking-tight">
          The failures are the point
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          The first run of this suite scored 10/15. Three of those five failures were real
          defects — the agent narrating its own reasoning out loud, inventing a gym&apos;s
          quiet times, and re-asking a question a previous call had already answered — and two
          were bad assertions of ours. Every run is committed, including the ones that failed.
          A suite that passed everything first time would only be evidence that its
          assertions are too weak to catch anything.{" "}
          <Link href="https://github.com/taxiivation-hfp/outbound-gym-x-elevenlabs/blob/main/evals/README.md" className="text-[#D6FF3D] underline decoration-[#D6FF3D]/40 hover:decoration-[#D6FF3D]">
            The full account is in evals/README.md
          </Link>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-black uppercase tracking-tight">Conversations</h2>
        <div className="mt-4 space-y-4">
          {conversations.results.map((r) => (
            <ScenarioCard key={r.id} result={r} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-black uppercase tracking-tight">Routing guards</h2>
        <p className="mt-1 text-sm text-zinc-500">
          No model, no network, milliseconds. These are the assertions that would catch a
          regression in the rule the product is built on.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-900 text-sm">
            <tbody className="divide-y divide-zinc-900">
              {guards.results.map((g) => (
                <tr key={g.id} className="align-top">
                  <td className="w-16 px-4 py-3">
                    <Verdict passed={g.passed} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-100">{g.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{g.why}</p>
                  </td>
                  <td className="max-w-md px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-500">
                    {g.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Score({ label, passed, total }: { label: string; passed: number; total: number }) {
  const clean = passed === total;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-black tabular-nums tracking-tight ${
          clean ? "text-[#D6FF3D]" : "text-amber-400"
        }`}
      >
        {passed}
        <span className="text-zinc-600">/{total}</span>
      </p>
    </div>
  );
}

function Verdict({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        passed
          ? "bg-[#D6FF3D] text-black"
          : "border border-red-700 bg-red-950/40 text-red-300"
      }`}
    >
      {passed ? "pass" : "fail"}
    </span>
  );
}

function ScenarioCard({ result }: { result: ScenarioResult }) {
  return (
    <details className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Verdict passed={result.passed} />
              <h3 className="text-base font-bold text-white">{result.name}</h3>
            </div>
            <p className="mt-1.5 text-xs text-zinc-600">
              <code className="font-mono">{result.id}</code> · {result.call_type} agent ·{" "}
              {result.gym_id}
              {result.brief_item ? ` · brief item ${result.brief_item}` : " · not in the brief"}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{result.why}</p>
          </div>
          <span className="text-xs text-zinc-600">{result.turns.length} turns</span>
        </div>
      </summary>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Conditions
          </p>
          <ul className="mt-2 space-y-2">
            {result.local.map((l) => (
              <li key={l.name} className="flex items-start gap-2">
                <Verdict passed={l.passed} />
                <span className="min-w-0 text-xs leading-relaxed">
                  <span className="text-zinc-200">{l.name}</span>
                  <span className="block font-mono text-[11px] text-zinc-600">{l.detail}</span>
                </span>
              </li>
            ))}
            {result.llm.conditions.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Verdict passed={result.llm.passed} />
                <span className="min-w-0 text-xs leading-relaxed">
                  <span className="text-zinc-200">{c}</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-600">
                    judged · {result.llm.rationale ?? result.llm.result}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {result.error && (
            <p className="mt-3 text-xs text-red-400">{result.error}</p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Transcript
          </p>
          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-black p-3">
            {result.turns.map((t, i) => (
              <p key={i} className="text-xs leading-relaxed">
                <span
                  className={
                    t.role === "agent"
                      ? "font-semibold text-[#D6FF3D]"
                      : "font-semibold text-zinc-400"
                  }
                >
                  {t.role === "agent" ? "Charlie" : "Member"}:{" "}
                </span>
                <span className="text-zinc-300">{t.message}</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
