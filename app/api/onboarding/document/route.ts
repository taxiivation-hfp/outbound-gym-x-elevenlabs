import { NextRequest, NextResponse } from "next/server";
import { DocumentReadError, readDocument } from "@/lib/extraction/documentText";

/**
 * Stage two of the upload flow: turn an uploaded file into plain text.
 *
 * Separate from extraction on purpose. Each stage of the progress display is a
 * request that actually finishes — the file arrives, this route reads it, the
 * next route extracts from it — so a stage marked done is a stage that happened.
 * The file is not stored; the text comes back to the browser for the next step
 * and the review screen.
 */

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload (multipart form data)." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached. Choose a PDF, .docx or text file." }, { status: 400 });
  }

  try {
    const doc = await readDocument(file);
    return NextResponse.json({
      kind: doc.kind,
      file_name: doc.fileName,
      bytes: doc.bytes,
      pages: doc.pages,
      characters: doc.text.length,
      text: doc.text,
    });
  } catch (err) {
    if (err instanceof DocumentReadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("document read failed", err);
    return NextResponse.json(
      { error: "Something went wrong reading that file. Nothing was extracted. Try again, or set the gym up by hand." },
      { status: 500 }
    );
  }
}
