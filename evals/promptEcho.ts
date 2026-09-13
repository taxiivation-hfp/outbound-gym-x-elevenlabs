/**
 * The agent speaking a line of its own prompt.
 *
 * Found in winback-moved-away-lets-go, 2026-09-13T12-21-51: Charlie read Aisha
 * the winback Goal's steps ("Ask if now is an okay time. If it isn't, offer to
 * try another time and end the call…") inside procedure markup, and the
 * scenario passed. The markup pattern catches the tags; this catches the words,
 * which a platform that strips the tags, or a model that paraphrases the
 * wrapper, would still leave in the member's ear.
 *
 * The prompt is the one `scripts/agentConfig.mjs` pushes, per agent. It is cut
 * into fragments of six words or more at sentence and clause boundaries and at
 * every `{{variable}}`. Anything the prompt quotes is removed first: quoted
 * text is either a line Charlie is meant to say ("I don't have that in front
 * of me") or a line a member might say ("it's not the time, it's the money")
 * that Charlie is told to acknowledge in their own words. What is left is
 * instruction, and a spoken turn containing one of those fragments word for
 * word is the prompt being read out.
 *
 * Kept out of `assertions.ts` because it reads prompt files from disk, and the
 * app imports that module.
 */
import { buildPrompt } from "../scripts/agentConfig.mjs";
import type { Assertion } from "./assertions";

const MIN_WORDS = 6;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The instruction fragments of one agent's prompt, normalised. */
export function promptFragments(callType: string): string[] {
  const body = buildPrompt(callType)
    .replace(/\{\{[^}]*\}\}/g, "\n")
    .replace(/"[^"]*"|“[^”]*”/g, "\n");
  const out = new Set<string>();
  for (const piece of body.split(/[.?!:;\n—()]|(?:^|\s)-\s/)) {
    const fragment = normalise(piece);
    if (fragment.split(" ").length >= MIN_WORDS) out.add(fragment);
  }
  return [...out];
}

const cache = new Map<string, string[]>();

export function mustNotSpeakItsPrompt(callType: string): Assertion {
  const name = "never speaks a line of its own prompt";
  return (turns) => {
    if (!cache.has(callType)) cache.set(callType, promptFragments(callType));
    const fragments = cache.get(callType)!;
    for (const turn of turns) {
      if (turn.role !== "agent") continue;
      const spoken = normalise(turn.message);
      const hit = fragments.find((f) => spoken.includes(f));
      if (hit) {
        return { name, passed: false, detail: `spoke the prompt's "${hit}"` };
      }
    }
    return { name, passed: true, detail: `no ${MIN_WORDS}-word fragment of the ${callType} prompt was spoken` };
  };
}
