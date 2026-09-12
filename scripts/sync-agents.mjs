#!/usr/bin/env node
/**
 * Push `scripts/agentConfig.mjs` to ElevenLabs. Idempotent: run it as often as
 * you like.
 *
 *   node scripts/sync-agents.mjs            # create or update all three agents
 *   node scripts/sync-agents.mjs --dry-run  # print what would change
 *
 * Reads `ELEVENLABS_API_KEY` and, if set, `PUBLIC_BASE_URL` (used for the
 * `send_text` webhook tool's endpoint) and `ELEVENLABS_POST_CALL_WEBHOOK_ID`
 * from `.env.local`.
 *
 * On success it prints the three agent ids in `.env.local` form. Paste them in;
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
 * and Tools are byte-identical across all three agents. Because they are read
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
      console.log(`  would update tool send_text (${id}) -> ${wanted.api_schema.url}`);
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

async function syncAgent(callType, existingByName, toolIds) {
  const payload = buildAgentPayload(callType, { toolIds, webhookId: WEBHOOK_ID });
  const name = AGENT_NAMES[callType];
  const existing = existingByName.get(name);

  if (DRY_RUN) {
    console.log(
      `  would ${existing ? `update ${name} (${existing.agent_id})` : `create ${name}`} — ` +
        `prompt ${payload.conversation_config.agent.prompt.prompt.length} chars, ` +
        `${Object.keys(payload.platform_settings.data_collection).length} collected fields, ` +
        `${payload.platform_settings.evaluation.criteria.length} criteria` +
        `${WEBHOOK_ID ? ", post-call webhook attached" : ", no post-call webhook"}`
    );
    return existing?.agent_id ?? null;
  }

  if (existing) {
    await call("PATCH", `/convai/agents/${existing.agent_id}`, payload);
    console.log(`  ${name} updated (${existing.agent_id})`);
    return existing.agent_id;
  }
  const created = await call("POST", "/convai/agents/create", payload);
  console.log(`  ${name} created (${created.agent_id})`);
  return created.agent_id;
}

// --- main -------------------------------------------------------------------

async function main() {
  assertSharedSectionsAreShared();
  console.log(DRY_RUN ? "Dry run — nothing will be written.\n" : "Syncing agents to ElevenLabs.\n");

  const toolIds = await ensureSendTextTool();
  const existingByName = new Map((await listAgents()).map((a) => [a.name, a]));

  const ids = {};
  for (const callType of CALL_TYPES) {
    ids[callType] = await syncAgent(callType, existingByName, toolIds);
  }

  if (!DRY_RUN) {
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
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
