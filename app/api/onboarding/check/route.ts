import { NextRequest, NextResponse } from "next/server";
import { MAX_DOCUMENT_CHARS } from "@/lib/extraction/prompt";
import { sanitizeExtraction } from "@/lib/extraction/sanitize";

/**
 * Stage four of the upload flow: check what the model returned against the
 * document it read, field by field, before any of it is shown as a prefilled
 * value. Deterministic — no model — and it saves nothing: the review screen is
 * the only way a config is saved.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "No document text to check the extraction against." }, { status: 400 });
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    return NextResponse.json(
      { error: `The document text is over the ${MAX_DOCUMENT_CHARS.toLocaleString("en-AU")}-character limit.` },
      { status: 413 }
    );
  }
  if (!body || !("output" in body)) {
    return NextResponse.json({ error: "No extraction output to check." }, { status: 400 });
  }
  return NextResponse.json(sanitizeExtraction(body.output, text));
}
