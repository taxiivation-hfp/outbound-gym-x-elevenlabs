/**
 * Owns: turning an uploaded PDF, .docx or text file into plain text, with a specific error for each failure.
 * Not here: the model call that reads that text, which is lib/extraction/extract.ts.
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { MAX_DOCUMENT_CHARS } from "@/lib/extraction/prompt";

/**
 * An uploaded document, turned into plain text.
 *
 * Server-only. Accepts what gyms actually have lying around: a PDF (a
 * membership agreement, a printed price list), a Word document (a sales
 * handbook, an objection script) or plain text. The document itself is never
 * stored — it is read, turned into text, and discarded with the request; only
 * the typed values a person approves on the review screen are ever saved.
 *
 * Every failure here is specific, because "couldn't read your file" gives a
 * front-desk manager nothing to act on, while "this PDF has no text layer — it's
 * a scan" tells them to upload the Word version instead.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type DocumentKind = "pdf" | "docx" | "text";

export interface DocumentText {
  kind: DocumentKind;
  fileName: string;
  bytes: number;
  pages: number | null;
  text: string;
}

export class DocumentReadError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "DocumentReadError";
    this.status = status;
  }
}

function kindOf(fileName: string, mimeType: string, head: Uint8Array): DocumentKind | null {
  const lower = fileName.toLowerCase();
  const isPdfMagic = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isZipMagic = head[0] === 0x50 && head[1] === 0x4b; // PK — a .docx is a zip
  if (isPdfMagic || lower.endsWith(".pdf") || mimeType === "application/pdf") {
    return isPdfMagic ? "pdf" : null;
  }
  if (
    lower.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return isZipMagic ? "docx" : null;
  }
  if (lower.endsWith(".doc")) return null;
  if (lower.endsWith(".txt") || lower.endsWith(".md") || mimeType.startsWith("text/")) return "text";
  return null;
}

/** Collapses the whitespace PDF text layers are full of, without joining lines. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function readDocument(file: File): Promise<DocumentText> {
  if (file.size === 0) throw new DocumentReadError("That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocumentReadError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB — ` +
        "upload the price list or membership agreement on its own rather than a whole folder exported as one file.",
      413
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(file.name, file.type, buffer.subarray(0, 4));

  if (!kind) {
    if (file.name.toLowerCase().endsWith(".doc")) {
      throw new DocumentReadError(
        "Old-format Word files (.doc) can't be read. Open it in Word and save as .docx, or export it as a PDF."
      );
    }
    throw new DocumentReadError(
      `"${file.name}" isn't a PDF, a Word document (.docx) or a text file, or its contents don't match its extension.`,
      415
    );
  }

  let text = "";
  let pages: number | null = null;

  if (kind === "pdf") {
    try {
      const pdf = await getDocumentProxy(buffer);
      const result = await extractText(pdf, { mergePages: true });
      pages = result.totalPages;
      text = result.text;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/password/i.test(detail)) {
        throw new DocumentReadError("That PDF is password-protected. Remove the password and upload it again.");
      }
      throw new DocumentReadError(`That PDF couldn't be opened (${detail}). Try re-exporting it, or upload a .docx.`);
    }
  } else if (kind === "docx") {
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = result.value;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new DocumentReadError(`That Word document couldn't be opened (${detail}). Try saving it again as .docx, or export a PDF.`);
    }
  } else {
    text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (text.includes("\u0000")) {
      throw new DocumentReadError("That file has binary content, so it isn't plain text. Upload a PDF or .docx instead.", 415);
    }
  }

  text = tidy(text);

  if (text.length < 20) {
    throw new DocumentReadError(
      kind === "pdf"
        ? "That PDF has no readable text — it's probably a scan or a photo. Upload the original Word document or a text-based PDF."
        : "That document has almost no text in it, so there's nothing to extract."
    );
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    throw new DocumentReadError(
      `That document has ${text.length.toLocaleString("en-AU")} characters of text; the limit is ` +
        `${MAX_DOCUMENT_CHARS.toLocaleString("en-AU")}. Nothing is cut off silently — upload the part with prices and membership terms.`,
      413
    );
  }

  return { kind, fileName: file.name, bytes: file.size, pages, text };
}
