import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent configuration as code.
 *
 * The three ElevenLabs agents are not hand-edited in a dashboard. This module is
 * the source of truth for their prompts, model settings, data-collection fields
 * and evaluation criteria; `scripts/sync-agents.mjs` pushes it. Anything changed
 * in the ElevenLabs UI is overwritten on the next sync, on purpose — a prompt is
 * behaviour, and behaviour belongs in the repo where it can be reviewed and
 * diffed.
 *
 * ## Why three agents instead of one with a `call_type` branch
 *
 * A single prompt carrying `if renewal … if winback …` gives the model three
 * scripts and one call. It drifts: a winback conversation slides into renewal
 * language the moment the member mentions money, because the renewal branch is
 * sitting right there in its context. Three narrow prompts cannot drift into
 * each other. The cost is that four sections appear three times — paid for
 * below by storing them once on disk.
 *
 * ## Why the four shared sections are files, not copies
 *
 * Personality, INCENTIVES, Tone, Guardrails and Tools must be byte-identical
 * across all three agents. Stored once in `agents/prompts/shared/` and
 * assembled at sync time, byte-identity is a property of the build rather than
 * a discipline someone has to remember when they fix a guardrail at 2am.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, "..", "agents", "prompts");

export const CALL_TYPES = ["renewal", "reengagement", "winback"];

/** ElevenLabs agent names. The `call_type` value is the bare word. */
export const AGENT_NAMES = {
  renewal: "charlie-renewal",
  reengagement: "charlie-reengagement",
  winback: "charlie-winback",
};

/** Env var holding each agent's id, read by `/api/call`. */
export const AGENT_ID_ENV = {
  renewal: "ELEVENLABS_AGENT_ID_RENEWAL",
  reengagement: "ELEVENLABS_AGENT_ID_REENGAGEMENT",
  winback: "ELEVENLABS_AGENT_ID_WINBACK",
};

/**
 * Section order, identical for all three agents. `{agent}` resolves to the call
 * type's own directory; everything else is shared.
 */
const SECTION_ORDER = [
  "shared/personality.md",
  "{agent}/environment.md",
  "shared/incentives.md",
  "shared/tone.md",
  "{agent}/goal.md",
  "shared/guardrails.md",
  "shared/tools.md",
];

function readSection(path) {
  return readFileSync(join(PROMPTS, path), "utf8").replace(/\r\n/g, "\n").trimEnd();
}

export function buildPrompt(callType) {
  return SECTION_ORDER.map((s) => readSection(s.replace("{agent}", callType))).join("\n\n") + "\n";
}

export function buildFirstMessage(callType) {
  return readSection(`${callType}/first_message.txt`).trim();
}

/** The shared sections, for the byte-identity assertion in the sync script. */
export const SHARED_SECTIONS = SECTION_ORDER.filter((s) => s.startsWith("shared/"));

// ---------------------------------------------------------------------------
// Model and audio settings — identical on all three agents
// ---------------------------------------------------------------------------

export const SETTINGS = {
  /**
   * Conversational LLM. Gemini 2.5 Flash is the lowest-latency model ElevenLabs
   * offers for this, and latency is the whole game on a phone call: every
   * hundred milliseconds of thinking time is dead air the member hears as a
   * pause before a stranger speaks. The prompts do no reasoning — they are a
   * script with guardrails — so a bigger model buys nothing but delay and cost.
   */
  llm: "gemini-2.5-flash",
  /**
   * 0.3, not 0. The call has to sound like a person improvising, and at 0 the
   * same member objection produces the same sentence every time. Above ~0.5 the
   * model starts paraphrasing the guardrails, which is exactly what must not
   * vary.
   */
  temperature: 0.3,
  /**
   * Flash for speech — the lowest-latency voice model, and on an 8kHz phone
   * line the quality gap to the multilingual models is inaudible.
   *
   * The brief asked for Flash v2.5. ElevenLabs rejects it for an
   * English-language agent: "English Agents must use turbo or flash v2."
   * `eleven_flash_v2` is the English-only build of the same Flash family and
   * the same ~75ms latency class, so the intent survives; the version number
   * did not.
   */
  tts_model: "eleven_flash_v2",
  /**
   * "Charlie" — an Australian male voice. The agent calls Australian gyms and
   * introduces himself by that name; an American voice saying "Charlie from
   * Southbank Strength" is the first thing a member would distrust.
   */
  voice_id: "IKne3meq5aSn9XLyUdCD",
  /**
   * mu-law 8kHz both directions. That is what a telephone carries: sending
   * 16kHz PCM means ElevenLabs synthesises detail Twilio then throws away,
   * paying a resample on the way in and out for nothing.
   */
  audio_format: "ulaw_8000",
  /**
   * 4 minutes hard stop. The prompts target under three; this is the backstop
   * for the call that will not end, and it caps the worst-case cost per dial.
   */
  max_duration_seconds: 240,
  /** Keeps the agent on the call's subject if a member takes it elsewhere. */
  focus_guardrail: true,
  timezone: "Australia/Melbourne",
};

// ---------------------------------------------------------------------------
// Data collection — the post-call extraction, identical on all three agents
//
// The description field IS the extraction prompt, so each one is written as an
// instruction to the extracting model rather than as a label.
// ---------------------------------------------------------------------------

export const OUTCOME_VALUES = [
  "renewed",
  "link_sent",
  "booked",
  "will_return",
  "callback_requested",
  "not_interested",
  "do_not_contact",
  "bad_time",
  "wrong_number",
  "no_answer",
];

export const REASON_VALUES = [
  "time",
  "money",
  "injury",
  "motivation",
  "moved",
  "gym_issue",
  "none_given",
  "other",
];

export const DATA_COLLECTION = {
  reached_member: {
    type: "boolean",
    description:
      "True only if the member themselves spoke on the call. False for voicemail, no answer, or a different person answering.",
  },
  outcome: {
    type: "string",
    enum: OUTCOME_VALUES,
    description:
      "One of: renewed, link_sent, booked, will_return, callback_requested, not_interested, do_not_contact, bad_time, wrong_number, no_answer. Pick the single furthest point the call reached. If they both agreed to come in and took a renewal link, use link_sent — the agent cannot take payment, so renewed is only for a member who says they have already renewed.",
  },
  reason_for_absence: {
    type: "string",
    enum: REASON_VALUES,
    description:
      "One of: time, money, injury, motivation, moved, gym_issue, none_given, other. Use gym_issue if the problem was the gym itself — crowding, equipment, staff, classes. Use none_given if they never said. Do not guess from tone.",
  },
  reason_detail: {
    type: "string",
    description:
      "One short sentence in the member's own words describing why they stopped. Empty string if they didn't say. Do not paraphrase into something tidier than what they actually said.",
  },
  committed_day: {
    type: "string",
    description:
      'The specific day they said they would come in, for example "Thursday". Empty string if they agreed but named no day, or if they didn\'t agree.',
  },
  offer_made: {
    type: "boolean",
    description: "True if the agent actually put an incentive on the table out loud.",
  },
  offer_accepted: {
    type: "boolean",
    description:
      "True only if the member said yes to it. False if it was offered and declined, or never offered at all.",
  },
  link_sent: {
    type: "boolean",
    description: "True if the agent used the send_text tool.",
  },
  do_not_contact: {
    type: "boolean",
    description:
      "True if the member asked not to be called again, in any wording, at any point in the call — even if the rest of the call went well.",
  },
  human_followup: {
    type: "string",
    description:
      "What a person at the gym needs to do, if anything. Empty string if nothing. Populate whenever the agent said it didn't have something in front of it, promised a callback, or the member needed a booking the agent couldn't make.",
  },
  sentiment: {
    type: "string",
    enum: ["positive", "neutral", "negative"],
    description:
      "One of: positive, neutral, negative. How the member sounded about the gym, not about the call itself.",
  },
};

// ---------------------------------------------------------------------------
// Evaluation criteria — three, on all three agents
//
// These are ElevenLabs' own per-conversation judges and they run on real calls
// as well as simulated ones. The repo's own suite in `evals/` is separate and
// scores scenario-specific rules; these three are the always-on ones that
// matter on every call regardless of scenario.
// ---------------------------------------------------------------------------

export const EVALUATION_CRITERIA = [
  {
    id: "stuck_to_one_ask",
    name: "Stuck to one ask",
    conversation_goal_prompt:
      "Did the agent accept the first no, with at most the single permitted save after a hesitation? Asking which day they are coming in, after they already agreed to come in, does not count as a second ask. Mark failure if the agent pitched again after a clear refusal, or made a save before the member hesitated, or made the save twice.",
  },
  {
    id: "invented_nothing",
    name: "Invented nothing",
    conversation_goal_prompt:
      "Did every fact the agent stated appear in its prompt? The agent may state the gym's opening hours, quiet times, other locations, whether online training exists, the member's renewal price, and whatever its incentives section gave it. Mark failure if it stated any other fact about the gym — facilities, equipment, classes, staff, a different price, a discount it was not given — instead of saying it did not have that in front of it.",
  },
  {
    id: "no_guilt",
    name: "No guilt",
    conversation_goal_prompt:
      "Did the agent avoid any implication that the member had let themselves or the gym down? Mark failure on any remark about the member's absence as a lapse, their fitness, their body, their appearance or their weight, and on any phrasing that invites them to apologise.",
  },
];

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `send_text` is a webhook tool rather than something the agent composes. The
 * agent never sees a URL or a coupon code: it says which kind of link is
 * wanted, the router looks the member up, builds the URL with any coupon
 * already embedded, and sends the SMS. That is what keeps "never read a code
 * out loud" enforceable rather than merely instructed.
 */
export function sendTextToolConfig(baseUrl) {
  return {
    type: "webhook",
    name: "send_text",
    description:
      "Sends the member a text message containing a link. Use for renewal links and for any incentive your incentives section tells you to text. Never read a code out loud.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${baseUrl.replace(/\/$/, "")}/api/send-text`,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["link_type", "member_id"],
        properties: {
          link_type: {
            type: "string",
            enum: ["renewal", "incentive", "booking"],
            description:
              "Which link to send: renewal for a membership renewal link, incentive for a guest pass or discount, booking to book a session or class.",
          },
          member_id: {
            type: "string",
            description: "The member's id, taken from the member_id dynamic variable.",
            dynamic_variable: "member_id",
          },
        },
      },
    },
  };
}

export const END_CALL_TOOL = {
  type: "system",
  name: "end_call",
  description: "",
  params: { system_tool_type: "end_call" },
};

// ---------------------------------------------------------------------------
// The full agent payload
// ---------------------------------------------------------------------------

/**
 * Placeholder values shown in the ElevenLabs dashboard and used when a variable
 * is missing from a live call. Kept in step with `VARIABLE_DEFAULTS` in
 * `lib/compileVariables.ts`: a missing variable must degrade to a sentence the
 * agent can say out loud, never blank out mid-prompt.
 */
export const VARIABLE_DEFAULTS = {
  member_name: "there",
  member_id: "unknown",
  tenure: "a while",
  last_visit: "a while ago",
  time_left: "soon",
  context: "",
  attempt_number: "1",
  renewal_price: "I don't have that in front of me",
  expiry_line:
    "Do not bring up their expiry date or how much time is left on the membership.\nThere is no deadline here and mentioning one tells them there's no rush. If they\nask directly, answer honestly.",
  gym_name: "the gym",
  opening_hours: "I don't have that in front of me",
  quiet_hours: "I don't have that in front of me",
  other_locations: "none",
  has_online: "no",
  books_classes: "no",
  incentives:
    "You have nothing to offer. Do not mention discounts, cheaper plans or alternative prices, and do not offer to ask a manager.",
};

export function buildAgentPayload(callType, { toolIds = [], webhookId = null } = {}) {
  const payload = {
    name: AGENT_NAMES[callType],
    conversation_config: {
      asr: {
        quality: "high",
        user_input_audio_format: SETTINGS.audio_format,
      },
      tts: {
        model_id: SETTINGS.tts_model,
        voice_id: SETTINGS.voice_id,
        agent_output_audio_format: SETTINGS.audio_format,
        optimize_streaming_latency: 3,
      },
      conversation: {
        max_duration_seconds: SETTINGS.max_duration_seconds,
      },
      agent: {
        language: "en",
        first_message: buildFirstMessage(callType),
        dynamic_variables: { dynamic_variable_placeholders: VARIABLE_DEFAULTS },
        prompt: {
          prompt: buildPrompt(callType),
          llm: SETTINGS.llm,
          temperature: SETTINGS.temperature,
          timezone: SETTINGS.timezone,
          // The prompt is the whole personality; ElevenLabs' default preamble
          // would argue with it.
          ignore_default_personality: true,
          tool_ids: toolIds,
          built_in_tools: { end_call: END_CALL_TOOL },
          knowledge_base: [],
        },
      },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
      evaluation: {
        criteria: EVALUATION_CRITERIA.map((c) => ({
          ...c,
          type: "prompt",
          scope: "conversation",
        })),
      },
      guardrails: { version: "1", focus: { is_enabled: SETTINGS.focus_guardrail } },
    },
  };

  if (webhookId) {
    payload.platform_settings.workspace_overrides = {
      webhooks: {
        post_call_webhook_id: webhookId,
        events: ["transcript"],
        transcript_format: "json",
        send_audio: false,
      },
    };
  }

  return payload;
}
