import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { SAMPLE_FILES } from "@/lib/sampleFiles";

/**
 * GET: one of the sample files named in lib/sampleFiles.ts, read from where it
 * is committed, as a download. Only names in that registry are served, so no
 * request can reach any other path in the repository.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const sample = SAMPLE_FILES.find((s) => s.name === file);
  if (!sample) {
    return NextResponse.json({ error: "No such sample file." }, { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), sample.path));
  } catch (err) {
    console.error(`Sample file ${sample.path} couldn't be read:`, err);
    return NextResponse.json({ error: `The sample file ${sample.name} isn't available on this deployment.` }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": sample.contentType,
      "Content-Disposition": `attachment; filename="${sample.name}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=300",
    },
  });
}
