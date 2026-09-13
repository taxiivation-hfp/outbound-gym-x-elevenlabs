#!/usr/bin/env node
/**
 * Push `scripts/agentConfig.mjs` to ElevenLabs. Idempotent: run it as often as
 * you like.
 *
 *   node scripts/sync-agents.mjs            # create or update all four agents
 *   node scripts/sync-agents.mjs --dry-run  # compare against ElevenLabs, write nothing
 *
 * Reads `ELEVENLABS_API_KEY` and, if set, `PUBLIC_BASE_URL` (used for the
 * `send_text` webhook tool's endpoint) and `ELEVENLABS_POST_CALL_WEBHOOK_ID`
 * from `.env.local`.
 *
 * The dry run fetches each agent that already exists and reports, per agent,
 * whether what this repo would push is what ElevenLabs already holds: every
 * value the payload sets is compared with the value the API reports at the same
 * path. "unchanged" means a sync would be a no-op for that agent. A value the
 * API doesn't echo back at all is listed as not verifiable rather than as a
 * difference.
 *
 * On success it prints the agent ids in `.env.local` form. Paste them in;
 * `/api/call` picks the agent by `call_type` from those variables.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_ID_ENV,
  AGENT_NAMES,
  CALL_TYPES,
  SHARED_SECTIONS,
  buildAgentPayload,
  sendTextToolConfig,
} from "./agentConfig.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const API = "https://api.elevenlabs.io/v1";
const DRY_RUN = process.argv.includes("--dry-run");

// --- env --------------------------------------------------------------------

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

loadEnvLocal();

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("ELEVENLABS_API_KEY is not set (looked in the environment and .env.local).");
  process.exit(1);
}

const BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").trim();
const WEBHOOK_ID = (process.env.ELEVENLABS_POST_CALL_WEBHOOK_ID ?? "").trim() || null;

// --- http -------------------------------------------------------------------

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}\n${text.slice(0, 2000)}`);
  }
  return json;
}

// --- checks -----------------------------------------------------------------

/**
 * The brief's second non-negotiable: Personality, INCENTIVES, Tone, Guardrails
 * and Tools are byte-identical across all four agents. Because they are read
 * from one file each, that is true by construction — this asserts the
 * construction has not been quietly worked around (a per-agent copy of a shared
 * section appearing in one of the call-type directories).
 */
function assertSharedSectionsAreShared() {
  const strays = [];
  for (const section of SHARED_SECTIONS) {
    const name = section.split("/")[1];
    for (const callType of CALL_TYPES) {
      if (existsSync(join(ROOT, "agents", "prompts", callType, name))) {
        strays.push(`${callType}/${name}`);
      }
    }
  }
  if (strays.length) {
    throw new Error(
      `Shared prompt sections have per-agent copies, which breaks byte-identity:\n  ${strays.join("\n  ")}`
    );
  }
}

// --- diff -------------------------------------------------------------------

function shorten(value) {
  if (typeof value !== "string" || value.length <= 60) return value;
  return `${value.slice(0, 57)}…`;
}

/** Where two strings first differ, with a little context either side. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const around = (s) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 40));
  return `differ from character ${i} (of ${a.length} here, ${b.length} on ElevenLabs): here ${around(a)}, there ${around(b)}`;
}

/**
 * Every leaf the payload sets, compared with the same path in what the API
 * returned. Extra keys on the API's side are ignored: a sync PATCHes what the
 * payload holds, so those are not something a sync would change. The exception
 * is an empty object in the payload, which must be empty on ElevenLabs too.
 */
function diffSubset(expected, actual, path, out) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      (actual === undefined ? out.unverifiable : out.differs).push(`${path}: ${actual === undefined ? "not reported by the API" : "not a list on ElevenLabs"}`);
      return;
    }
    if (expected.length !== actual.length) {
      out.differs.push(`${path}: ${expected.length} item${expected.length === 1 ? "" : "s"} here, ${actual.length} on ElevenLabs`);
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i += 1) diffSubset(expected[i], actual[i], `${path}[${i}]`, out);
    return;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === undefined) {
      out.unverifiable.push(`${path}: not reported by the API`);
      return;
    }
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      out.differs.push(`${path}: an object here, ${JSON.stringify(shorten(actual))} on ElevenLabs`);
      return;
    }
    // An empty object in the payload means "nothing here", not "nothing to
    // compare". Without this, `procedures: {}` could never report the
    // procedure that was attached in the dashboard.
    if (Object.keys(expected).length === 0 && Object.keys(actual).length > 0) {
      out.differs.push(`${path}: empty here, ${Object.keys(actual).length} entr${Object.keys(actual).length === 1 ? "y" : "ies"} on ElevenLabs (${Object.keys(actual).join(", ")})`);
      return;
    }
    for (const [key, value] of Object.entries(expected)) diffSubset(value, actual[key], `${path}.${key}`, out);
    return;
  }
  if (actual === undefined) {
    out.unverifiable.push(`${path}: not reported by the API`);
    return;
  }
  if (expected !== actual) {
    if (typeof expected === "string" && typeof actual === "string" && expected.length + actual.length > 120) {
      out.differs.push(`${path}: ${firstDifference(expected, actual)}`);
    } else {
      out.differs.push(`${path}: here ${JSON.stringify(shorten(expected))}, on ElevenLabs ${JSON.stringify(shorten(actual))}`);
    }
  }
}

function compare(expected, actual) {
  const out = { differs: [], unverifiable: [] };
  diffSubset(expected, actual, "", out);
  const strip = (s) => s.replace(/^\./, "");
  return { differs: out.differs.map(strip), unverifiable: out.unverifiable.map(strip) };
}

function report(indent, result) {
  for (const line of result.differs) console.log(`${indent}${line}`);
  if (result.unverifiable.length) {
    console.log(`${indent}(not reported back by the API, so not compared: ${result.unverifiable.join("; ")})`);
  }
}

// --- tools ------------------------------------------------------------------

async function ensureSendTextTool() {
  if (!BASE_URL) {
    console.warn(
      "! PUBLIC_BASE_URL is not set, so the send_text tool is skipped.\n" +
        "  The agents will be created without it — they can still talk, but the\n" +
        "  'text you a link' step has nowhere to go. Deploy, set PUBLIC_BASE_URL,\n" +
        "  and re-run this script."
    );
    return [];
  }

  const wanted = sendTextToolConfig(BASE_URL);
  const existing = await call("GET", "/convai/tools");
  const match = (existing?.tools ?? []).find(
    (t) => (t.tool_config?.name ?? t.name) === "send_text"
  );

  if (match) {
    const id = match.id ?? match.tool_id;
    if (DRY_RUN) {
      const result = compare(wanted, match.tool_config ?? {});
      console.log(`  tool send_text (${id}): ${result.differs.length === 0 ? "unchanged" : "DIFFERS"} -> ${wanted.api_schema.url}`);
      report("      ", result);
      return [id];
    }
    await call("PATCH", `/convai/tools/${id}`, { tool_config: wanted });
    console.log(`  tool send_text updated (${id}) -> ${wanted.api_schema.url}`);
    return [id];
  }

  if (DRY_RUN) {
    console.log(`  would create tool send_text -> ${wanted.api_schema.url}`);
    return [];
  }
  const created = await call("POST", "/convai/tools", { tool_config: wanted });
  const id = created?.id ?? created?.tool_id;
  console.log(`  tool send_text created (${id}) -> ${wanted.api_schema.url}`);
  return [id];
}

// --- agents -----------------------------------------------------------------

async function listAgents() {
  const out = [];
  let cursor = null;
  do {
    const page = await call(
      "GET",
      `/convai/agents?page_size=100${cursor ? `&cursor=${cursor}` : ""}`
    );
    out.push(...(page?.agents ?? []));
    cursor = page?.next_cursor ?? null;
  } while (cursor);
  return out;
}

function describe(payload) {
  return (
    `prompt ${payload.conversation_config.agent.prompt.prompt.length} chars, ` +
    `${Object.keys(payload.platform_settings.data_collection).length} collected fields, ` +
    `${payload.platform_settings.evaluation.criteria.length} criteria` +
    `${WEBHOOK_ID ? ", post-call webhook attached" : ", no post-call webhook"}`
  );
}

async function syncAgent(callType, existingByName, toolIds) {
  const payload = buildAgentPayload(callType, { toolIds, webhookId: WEBHOOK_ID });
  const name = AGENT_NAMES[callType];
  const existing = existingByName.get(name);

  if (DRY_RUN) {
    if (!existing) {
      console.log(`  ${name}: would create — ${describe(payload)}`);
      return { id: null, changed: true };
    }
    const remote = await call("GET", `/convai/agents/${existing.agent_id}`);
    const result = compare(payload, remote ?? {});
    const changed = result.differs.length > 0;
    console.log(`  ${name} (${existing.agent_id}): ${changed ? "DIFFERS — a sync would change it" : "unchanged"} — ${describe(payload)}`);
    report("      ", result);
    return { id: existing.agent_id, changed };
  }

  if (existing) {
    await call("PATCH", `/convai/agents/${existing.agent_id}`, payload);
    console.log(`  ${name} updated (${existing.agent_id})`);
    return { id: existing.agent_id, changed: true };
  }
  const created = await call("POST", "/convai/agents/create", payload);
  console.log(`  ${name} created (${created.agent_id})`);
  return { id: created.agent_id, changed: true };
}

// --- main -------------------------------------------------------------------

async function main() {
  assertSharedSectionsAreShared();
  console.log(DRY_RUN ? "Dry run — nothing will be written.\n" : "Syncing agents to ElevenLabs.\n");

  const toolIds = await ensureSendTextTool();
  const existingByName = new Map((await listAgents()).map((a) => [a.name, a]));

  const ids = {};
  const changed = [];
  for (const callType of CALL_TYPES) {
    const result = await syncAgent(callType, existingByName, toolIds);
    ids[callType] = result.id;
    if (result.changed) changed.push(AGENT_NAMES[callType]);
  }

  if (DRY_RUN) {
    console.log(
      changed.length === 0
        ? "\nA sync would change nothing."
        : `\nA sync would change: ${changed.join(", ")}. Everything else is already what the repo holds.`
    );
    return;
  }

  console.log("\nAdd these to .env.local (and to the Vercel project's env vars):\n");
  for (const callType of CALL_TYPES) {
    console.log(`${AGENT_ID_ENV[callType]}=${ids[callType]}`);
  }
  if (!WEBHOOK_ID) {
    console.log(
      "\n! No post-call webhook attached. Register the webhook in the ElevenLabs\n" +
        "  dashboard (Settings -> Webhooks) pointing at <PUBLIC_BASE_URL>/api/webhook,\n" +
        "  put its id in ELEVENLABS_POST_CALL_WEBHOOK_ID, and re-run. Until then a\n" +
        "  finished call will not write its transcript back."
    );
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
