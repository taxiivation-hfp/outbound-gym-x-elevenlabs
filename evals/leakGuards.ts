import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Assertion, Turn } from "./assertions";
import type { Guard } from "./guards";
import { mustNotSpeakItsPrompt } from "./promptEcho";
import { GLOBAL_ASSERTIONS } from "./scenarios";

const HERE = dirname(fileURLToPath(import.meta.url));

interface PinnedTurn {
  run: string;
  scenario: string;
  call_type: string;
  turn: number;
  scenario_passed: boolean;
  message: string;
}

interface LeakedTurns {
  leaked: Array<PinnedTurn & { assertions: string[] }>;
  clean: PinnedTurn[];
}

/** Every transcript-wide assertion a scenario on this agent is held to, by name. */
function assertionsByName(callType: string): Map<string, Assertion> {
  const all = [...GLOBAL_ASSERTIONS, mustNotSpeakItsPrompt(callType)];
  const turns: Turn[] = [{ role: "agent", message: "Hi." }];
  return new Map(all.map((a) => [a(turns).name, a]));
}

export const leakGuards: Guard[] = [
  {
    id: "leak-assertions-fail-the-turns-that-revealed-them",
    name: "Each leak assertion fails the real turn it was written from, and passes correct speech",
    why:
      "A transcript passed every assertion while three of its turns were the winback Goal wrapped in " +
      "procedure markup, and text-to-speech reads whatever is in a turn. Reading every committed agent turn " +
      "found five shapes the member should never have heard, in scenarios that passed. Each assertion is " +
      "held here to the turn that revealed it, copied from its run file, so loosening a pattern until that " +
      "turn slips through fails the suite. Correct lines from the latest model are held too, so tightening " +
      "one until it catches ordinary speech fails as well.",
    run: () => {
      const pins = JSON.parse(readFileSync(join(HERE, "leaked-turns.json"), "utf8")) as LeakedTurns;
      const problems: string[] = [];
      const runs = new Map<string, { conversations: { results: Array<{ id: string; turns: Turn[] }> } }>();
      const provenance = (p: PinnedTurn) => {
        if (!runs.has(p.run)) runs.set(p.run, JSON.parse(readFileSync(join(HERE, "results", `${p.run}.json`), "utf8")));
        const turn = runs.get(p.run)!.conversations.results.find((r) => r.id === p.scenario)?.turns[p.turn];
        if (!turn || turn.role !== "agent" || turn.message !== p.message) {
          problems.push(`${p.run} ${p.scenario} turn ${p.turn} no longer matches its run file`);
        }
      };

      let leakChecks = 0;
      for (const pin of pins.leaked) {
        provenance(pin);
        const byName = assertionsByName(pin.call_type);
        const turns: Turn[] = [{ role: "agent", message: pin.message }];
        for (const name of pin.assertions) {
          const assertion = byName.get(name);
          leakChecks += 1;
          if (!assertion) problems.push(`no assertion named "${name}"`);
          else if (assertion(turns).passed) problems.push(`"${name}" passes ${pin.scenario} (${pin.run.slice(0, 19)}) turn ${pin.turn}`);
        }
      }

      for (const pin of pins.clean) {
        provenance(pin);
        const turns: Turn[] = [{ role: "agent", message: pin.message }];
        for (const assertion of assertionsByName(pin.call_type).values()) {
          const result = assertion(turns);
          if (!result.passed) problems.push(`"${result.name}" fails correct speech in ${pin.scenario} turn ${pin.turn}: ${result.detail}`);
        }
      }

      return {
        passed: problems.length === 0,
        detail:
          problems.length === 0
            ? `${leakChecks} leak checks fail their ${pins.leaked.length} pinned turns; ${pins.clean.length} correct turns pass every one`
            : problems.join("; "),
      };
    },
  },
];
