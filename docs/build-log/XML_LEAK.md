# XML_LEAK.md

A committed transcript has an agent speaking its own Goal section aloud.
Kensington, brief item 8, Aisha, 9 turns. The turn reads:

```
<current-active-structured-procedure index="1"><step index="1"
is_completed="false">Confirm it's them. Ask if now is an okay time. If it
isn't, offer to try another time and end the call.</step><step index="2"
is_completed="false">Say why you're calling: their membership ended and you
wanted to check in rather than let them disappear.</step><step index="3"
is_completed="false">Find out why they stopped...
```

It **passed** every assertion. That's the same blind spot that hid the original
reasoning leak until a human read a transcript.

Text-to-speech reads whatever is in that field. On a real call the member hears
the prompt.

---

## 1. Diagnose before changing anything

`current-active-structured-procedure` is not wording from any prompt file in
this repo. It looks like platform scaffolding, which means an agent setting
rather than a prompt bug.

Check, in this order:

- Whether **procedures** or **workflows** are enabled on any of the four
  agents. `charlie_build_brief.md` says leave both alone. If one is on, that is
  almost certainly the cause.
- Whether `scripts/agentConfig.mjs` sets anything that turns them on, or
  whether it was switched on in the ElevenLabs dashboard and a sync then
  preserved it.
- Which agents and which runs are affected. The example is kensington
  cancellation, the newest agent, which is a clue if the other three are clean.

**Report the diagnosis before touching agent config.** If the fix is
config-only with no prompt edit, scenario payloads stay byte-identical and a
sync is safe. If it needs a prompt change, that's a different decision and I
want to make it.

## 2. Assert against it

Regardless of cause, nothing in the suite catches this. Add an assertion that
runs on every scenario across all four agents and fails a spoken turn that
contains:

- angle-bracket markup of any kind
- text matching a step from that agent's Goal section
- any of the platform's scaffolding tag names

This is the same class of check as the reasoning-leak assertion that already
exists, and it belongs next to it.

Then **run it across every committed transcript in `evals/results/` and tell me
how many others leak.** That number matters more than the fix. One transcript
is a fluke; several means it has been happening on every cancellation call and
the live scores were measuring something else.

Pin the Aisha turn as a fixture so the assertion can't regress.

## 3. Fix the claim on Our Journey

The page was softened earlier so it no longer asserts the reasoning leak is
"fixed, asserted on every call", and the scaffolding leak was noted under known
failures. Once the assertion exists and the cause is fixed, update that section
to say what actually happened — including that a transcript passed while
leaking, because that is the more interesting failure.

## Constraints

- Do not edit any of the four agent prompts or the shared sections without
  reporting first.
- `agents:sync` pushes to production. Report the diff before running it.
- Do not weaken any existing guard.
- If the assertion fails scenarios that currently pass, that is the assertion
  working. Do not relax it to keep the score up. Report the new score honestly
  and commit the failing run.

## Report

The cause. How many committed transcripts leak. The new assertion and what it
pins. Whether a sync was needed and what the diff showed. The score before and
after.
