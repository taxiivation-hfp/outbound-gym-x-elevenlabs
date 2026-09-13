import Anthropic from "@anthropic-ai/sdk";
import {
  EXTRACTION_MODEL,
  EXTRACTION_SYSTEM_PROMPT,
  extractionOutputSchema,
  extractionUserMessage,
} from "@/lib/extraction/prompt";

/**
 * The one model call in onboarding.
 *
 * Server-only. One request, structured output constrained to the field schema,
 * no tools, no follow-up turns. The raw result goes back to the caller as
 * untrusted data; `sanitizeExtraction` decides what of it may be shown as a
 * prefilled value.
 *
 * Model: `claude-haiku-4-5`. This is structured extraction over a short document
 * with a narrow output space — eleven typed fields and a quote each — not
 * reasoning, and the review screen puts a person between its output and
 * anything saved. The smallest, fastest model that supports structured output
 * is the right trade: a gym owner waits a few seconds instead of tens, and a
 * larger model's extra judgement would be spent on exactly the inference the
 * prompt forbids.
 */

export class ExtractionUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ExtractionUnavailableError";
    this.status = status;
  }
}

export interface RawExtraction {
  model: string;
  /** The parsed JSON the model returned. Untrusted. */
  output: unknown;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string | null;
}

export function extractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function extractGymFields(documentText: string, fileName: string): Promise<RawExtraction> {
  if (!extractionConfigured()) {
    throw new ExtractionUnavailableError(
      "Document extraction isn't configured on this deployment (ANTHROPIC_API_KEY is not set), so nothing " +
        "was extracted. Set the gym up by hand instead — it's the same review screen, starting empty.",
      503
    );
  }

  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: extractionUserMessage(documentText, fileName) }],
      output_config: { format: { type: "json_schema", schema: extractionOutputSchema() } },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ExtractionUnavailableError("The extraction service rejected this deployment's API key.", 502);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ExtractionUnavailableError("The extraction service is rate-limiting this deployment. Try again in a minute.", 503);
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ExtractionUnavailableError(`The extraction request was refused: ${err.message}`, 502);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ExtractionUnavailableError("Couldn't reach the extraction service. Check the connection and try again.", 502);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ExtractionUnavailableError(`The extraction service returned an error (${err.status ?? "unknown"}).`, 502);
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new ExtractionUnavailableError("The extraction model declined to read this document. Set the gym up by hand.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionUnavailableError("The extraction ran out of room before finishing, so its output was discarded rather than half-used.", 502);
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw new ExtractionUnavailableError("The extraction model returned something that wasn't valid JSON, so it was discarded.", 502);
  }

  return {
    model: response.model,
    output,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    stop_reason: response.stop_reason,
  };
}
