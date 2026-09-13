/**
 * A CSV reader for gym-platform exports.
 *
 * RFC 4180, plus the things real exports do: a UTF-8 byte-order mark from
 * Excel, CRLF line endings, quoted fields containing commas, newlines and
 * doubled quotes, and a trailing blank line. No dependency, because the whole
 * of what is needed fits here and every rule is visible.
 *
 * It reports rather than repairs. An unterminated quote or a row with the wrong
 * number of fields is an error with a line number, because silently shifting a
 * column is how an `auto_renew` value ends up under `monthly_fee`.
 */

export interface CsvRow {
  /** 1-based line number in the file where this row starts, for error messages. */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  header: string[];
  rows: CsvRow[];
  errors: Array<{ line: number; message: string }>;
}

export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRow[] = [];
  const errors: CsvParseResult["errors"] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordStartLine = 1;
  let i = 0;

  const endField = () => {
    cells.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    // A line with nothing on it is not a record.
    if (!(cells.length === 1 && cells[0] === "")) {
      records.push({ line: recordStartLine, cells });
    }
    cells = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (field.trim() === "" && !fieldWasQuoted) {
        inQuotes = true;
        fieldWasQuoted = true;
        field = "";
      } else {
        errors.push({ line, message: "A quote appears in the middle of an unquoted value." });
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      i += 1;
      line += 1;
      recordStartLine = line;
      continue;
    }
    if (fieldWasQuoted) {
      // Whitespace between a closing quote and the comma is padding, not data.
      if (ch !== " " && ch !== "\t") {
        errors.push({ line, message: "Text follows a closing quote in the same value." });
        field += ch;
      }
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    errors.push({ line: recordStartLine, message: "A quoted value is never closed, so the rest of the file can't be read reliably." });
  }
  if (field !== "" || fieldWasQuoted || cells.length > 0) endRecord();

  if (records.length === 0) {
    return { header: [], rows: [], errors: [...errors, { line: 1, message: "The file is empty." }] };
  }

  const [headerRecord, ...rows] = records;
  const header = headerRecord.cells.map((h) => h.trim());
  for (const row of rows) {
    if (row.cells.length !== header.length) {
      errors.push({
        line: row.line,
        message: `Has ${row.cells.length} value${row.cells.length === 1 ? "" : "s"} but the header has ${header.length} columns.`,
      });
    }
  }
  return { header, rows, errors };
}

/** "Member ID" / "member-id" / "MemberID" → "memberid", for matching headers to known names. */
export function normaliseHeader(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
