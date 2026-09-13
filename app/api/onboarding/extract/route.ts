import { NextRequest, NextResponse } from "next/server";
import { ExtractionUnavailableError, extractGymFields } from "@/lib/extraction/extract";
import { MAX_DOCUMENT_CHARS } from "@/lib/extraction/prompt";

/**
 * Stage three of the upload flow: one model call that fills typed fields.
 *
 * Returns the model's raw output untouched. It is untrusted until stage four
 * (`/api/onboarding/check`) has sanitised it, and nothing from it is saved until
 * a person has reviewed every value on the review screen.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body?.text;
  const fileName = typeof body?.file_name === "string" && body.file_name.trim() ? body.file_name.trim().slice(0, 200) : "document";

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "No document text to extract from." }, { status: 400 });
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    return NextResponse.json(
      { error: `The document text is over the ${MAX_DOCUMENT_CHARS.toLocaleString("en-AU")}-character limit.` },
      { status: 413 }
    );
  }

  try {
    const raw = await extractGymFields(text, fileName);
    return NextResponse.json({ model: raw.model, output: raw.output, usage: raw.usage });
  } catch (err) {
    if (err instanceof ExtractionUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("extraction failed", err);
    return NextResponse.json(
      { error: "Extraction failed unexpectedly, so nothing was prefilled. Set the gym up by hand, or try again." },
      { status: 500 }
    );
  }
}
