import { NextRequest, NextResponse } from "next/server";
import { resolveGym } from "@/lib/gymStore";
import { IMPORT_KINDS, parseImport, type ImportKind, type ImportPreview } from "@/lib/memberImport";
import {
  MemberStoreError,
  existingMemberIds,
  importCheckins,
  importContracts,
  importMembers,
} from "@/lib/memberStore";

/**
 * Upload one member-data CSV for a gym: members, contracts or check-ins.
 *
 * Two steps, same endpoint. Without `commit=true` the file is parsed and
 * validated and nothing is written — the screen shows what parsed and what
 * didn't. With it, the same checks run again and, only if the whole file is
 * clean, it is written with the table's sync rule: members upserted, contracts
 * and check-ins inserted and never updated.
 *
 * A file is imported whole or not at all. Contracts and check-ins must refer to
 * members already imported for this gym; a row that doesn't is an error to fix,
 * not a row to skip, because a skipped contract is a member whose renewal date
 * silently disappears.
 */
export const maxDuration = 60;

/** Under Vercel's 4.5 MB request limit, with room for the form encoding. */
const MAX_CSV_BYTES = 4 * 1024 * 1024;
const SAMPLE_ROWS = 5;

type Params = { gymId: string };

function summarise<K extends ImportKind>(preview: ImportPreview<K>) {
  return {
    kind: preview.kind,
    ok: preview.ok,
    row_count: preview.rowCount,
    importable_rows: preview.rows.length,
    duplicate_rows: preview.duplicateRows,
    matched_columns: preview.matchedColumns,
    ignored_columns: preview.ignoredColumns,
    issues: preview.issues,
    issue_count: preview.issueCount,
    sample: preview.rows.slice(0, SAMPLE_ROWS),
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { gymId } = await ctx.params;

  const gym = await resolveGym(gymId);
  if (!gym.ok) return NextResponse.json({ error: gym.error }, { status: gym.status });
  if (gym.source !== "supabase") {
    return NextResponse.json(
      {
        error:
          "Member data is stored against a gym in the gyms table, which hasn't been created on this deployment. " +
          "Apply supabase/migrations/20260914000000_create_gyms.sql and 20260914010000_member_data.sql first.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload (multipart form data)." }, { status: 400 });
  }

  const kind = form.get("kind");
  if (typeof kind !== "string" || !IMPORT_KINDS.includes(kind as ImportKind)) {
    return NextResponse.json({ error: `kind must be one of ${IMPORT_KINDS.join(", ")}.` }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 422 });
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB per upload. Export a shorter date range (for check-ins, the last 12 months is plenty) and upload it in parts — re-uploading overlapping rows is safe.`,
      },
      { status: 413 }
    );
  }

  const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
  if (text.includes("\u0000")) {
    return NextResponse.json({ error: "That isn't a CSV file — it has binary content. Export the table as CSV and upload that." }, { status: 415 });
  }

  const preview = parseImport(kind as ImportKind, text);
  const commit = form.get("commit") === "true";

  if (!preview.ok) {
    return NextResponse.json(
      { error: "This file can't be imported as it is. Nothing was written.", preview: summarise(preview) },
      { status: 422 }
    );
  }

  try {
    if (kind !== "members") {
      // Every contract and check-in must belong to a member this gym already has.
      const known = await existingMemberIds(gymId);
      const unknownLines = new Map<string, number>();
      for (const row of preview.rows as Array<{ member_id: string }>) {
        if (!known.has(row.member_id)) unknownLines.set(row.member_id, (unknownLines.get(row.member_id) ?? 0) + 1);
      }
      if (unknownLines.size > 0) {
        const listed = [...unknownLines.entries()].slice(0, 10).map(([id, n]) => `${id} (${n} row${n === 1 ? "" : "s"})`);
        return NextResponse.json(
          {
            error:
              `${unknownLines.size} member ID${unknownLines.size === 1 ? " isn't" : "s aren't"} in this gym's members yet: ${listed.join(", ")}` +
              `${unknownLines.size > 10 ? ", …" : ""}. Upload the members file first (or add them to it), then this one. Nothing was written.`,
            preview: summarise(preview),
          },
          { status: 422 }
        );
      }
    }

    if (!commit) {
      return NextResponse.json({ preview: summarise(preview), committed: false });
    }

    const outcome =
      kind === "members"
        ? await importMembers(gymId, preview.rows as ImportPreview<"members">["rows"])
        : kind === "contracts"
          ? await importContracts(gymId, preview.rows as ImportPreview<"contracts">["rows"])
          : await importCheckins(gymId, preview.rows as ImportPreview<"checkins">["rows"]);

    return NextResponse.json({ preview: summarise(preview), committed: true, outcome });
  } catch (err) {
    if (err instanceof MemberStoreError) {
      return NextResponse.json({ error: err.message, preview: summarise(preview) }, { status: err.status });
    }
    console.error("member import failed", err);
    return NextResponse.json({ error: "The import failed unexpectedly. Re-uploading the same file is safe." }, { status: 500 });
  }
}
