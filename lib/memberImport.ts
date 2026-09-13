import { normaliseHeader, parseCsv } from "@/lib/csv";
import type { ContractRecord, MemberRecord } from "@/lib/memberData";

/**
 * Validates the three CSV exports a gym uploads: members, contracts, check-ins.
 *
 * CSV is a real integration path, not a stopgap: every major platform exports
 * these tables because gym staff already send them to their accountant, and it
 * works on day one with no API access, no credentials and no partnership. What
 * makes it trustworthy is that a file is either imported whole or not at all,
 * and a rejected file comes back with errors someone at a front desk can act on:
 * which column, which line, what was wrong, what it should look like.
 *
 * Nothing is defaulted. The one that matters most is `auto_renew`: a contract
 * row that doesn't say whether it auto-renews is an error, never "probably
 * fixed-term", because treating an auto-renewing member as fixed-term is the
 * exact call this product exists to never make.
 */

export type ImportKind = "members" | "contracts" | "checkins";

export const IMPORT_KINDS: ImportKind[] = ["members", "contracts", "checkins"];

interface ColumnSpec {
  key: string;
  label: string;
  required: boolean;
  /** Header names this column is recognised by, compared after `normaliseHeader`. */
  aliases: string[];
  example: string;
}

export const IMPORT_COLUMNS: Record<ImportKind, ColumnSpec[]> = {
  members: [
    { key: "member_id", label: "Member ID", required: true, aliases: ["memberid", "id", "clientid", "customerid", "membernumber", "memberno"], example: "M0001" },
    { key: "name", label: "Name", required: true, aliases: ["name", "fullname", "membername", "clientname"], example: "Sarah Whitlock" },
    { key: "mobile", label: "Mobile", required: false, aliases: ["mobile", "phone", "mobilephone", "phonenumber", "mobilenumber", "cell", "cellphone"], example: "+61400000000" },
    { key: "join_date", label: "Join date", required: true, aliases: ["joindate", "joined", "datejoined", "creationdate", "signupdate", "membersince"], example: "2025-02-09" },
    {
      key: "cancellation_requested",
      label: "Cancellation requested",
      required: false,
      aliases: ["cancellationrequested", "cancellationrequestedat", "cancellationrequestdate", "cancelrequested", "cancelrequestedat", "cancellationdate"],
      example: "2026-09-05T15:30:00",
    },
  ],
  // In a contracts or check-ins export a bare "id" is usually the row's own id,
  // not the member's, so only the members file recognises it.
  contracts: [
    { key: "member_id", label: "Member ID", required: true, aliases: ["memberid", "clientid", "customerid", "membernumber", "memberno"], example: "M0001" },
    { key: "contract_type", label: "Plan", required: true, aliases: ["contracttype", "plan", "planname", "membership", "membershiptype", "contractname"], example: "12-month" },
    { key: "auto_renew", label: "Auto-renews", required: true, aliases: ["autorenew", "autorenews", "autopay", "autopayenabled", "recurring", "rollsover"], example: "false" },
    { key: "start_date", label: "Start date", required: true, aliases: ["startdate", "termstart", "contractstart", "start"], example: "2026-03-14" },
    { key: "end_date", label: "End date", required: true, aliases: ["enddate", "expirydate", "expirationdate", "termend", "contractend", "end"], example: "2027-03-13" },
    { key: "monthly_fee", label: "Monthly fee", required: true, aliases: ["monthlyfee", "monthlyprice", "price", "fee"], example: "79" },
    { key: "renewal_fee", label: "Renewal fee", required: false, aliases: ["renewalfee", "renewalprice"], example: "79" },
  ],
  checkins: [
    { key: "member_id", label: "Member ID", required: true, aliases: ["memberid", "clientid", "customerid", "membernumber", "memberno"], example: "M0001" },
    { key: "visited_at", label: "Check-in time", required: true, aliases: ["timestamp", "visitedat", "checkintime", "checkedinat", "checkin", "datetime", "startdatetime"], example: "2026-09-10T17:45:00" },
  ],
};

export interface ImportIssue {
  /** 1-based line in the file, or null for a problem with the file as a whole. */
  line: number | null;
  column?: string;
  message: string;
}

export interface CheckinRecord {
  member_id: string;
  /** Local gym time, `YYYY-MM-DDTHH:MM:SS`. */
  visited_at: string;
}

export type ContractRow = Omit<ContractRecord, "last_seen_at" | "id">;

export type ImportRow<K extends ImportKind> = K extends "members"
  ? MemberRecord
  : K extends "contracts"
    ? ContractRow
    : CheckinRecord;

export interface ImportPreview<K extends ImportKind> {
  kind: K;
  /** True when the file can be imported as it stands. */
  ok: boolean;
  rows: ImportRow<K>[];
  /** Data rows in the file, blank lines excluded. */
  rowCount: number;
  issues: ImportIssue[];
  /** Total issues, when more were found than are listed. */
  issueCount: number;
  /** Header → the column it was read as. */
  matchedColumns: Record<string, string>;
  /** The keys of the columns the file has, e.g. "mobile". */
  presentColumns: string[];
  ignoredColumns: string[];
  /** Identical rows collapsed into one. */
  duplicateRows: number;
}

const MAX_LISTED_ISSUES = 50;

// --- Values -------------------------------------------------------------------------

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** ISO dates only: `2026-03-14`. A `04/05/2026` is refused rather than guessed at. */
export function parseIsoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** A timestamp carrying a time zone: `…Z` or `…+10:00`. */
export function hasTimeZone(value: string): boolean {
  return /[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

/**
 * `2026-09-10T17:45`, `2026-09-10 17:45:00`: the gym's local time, as a front
 * desk reads it. A time with a zone is refused rather than having the zone
 * dropped — a UTC export read as local time moves an Australian morning visit
 * to the previous evening.
 */
export function parseTimestamp(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00"] = m;
  if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "t"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "f"]);

export function parseBooleanCell(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

/** No gym membership costs this much a month; above it, the column is something else. */
export const MAX_MONTHLY_AMOUNT = 10_000;

/** `79`, `79.00`, `$79.95`, `1,299.00`. Two decimal places at most. */
export function parseMoney(value: string): number | null {
  const v = value.trim().replace(/^\$\s?/, "");
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Number(v.replace(/,/g, ""));
}

const PHONE = /^\+?[\d\s().-]{6,20}$/;

// --- Header matching -----------------------------------------------------------------

function matchColumns(kind: ImportKind, header: string[], issues: ImportIssue[]) {
  const specs = IMPORT_COLUMNS[kind];
  const indexByKey = new Map<string, number>();
  const matchedColumns: Record<string, string> = {};
  const ignoredColumns: string[] = [];

  header.forEach((name, index) => {
    const normalised = normaliseHeader(name);
    const spec = specs.find((s) => s.aliases.includes(normalised));
    if (!spec) {
      if (name.trim()) ignoredColumns.push(name);
      return;
    }
    if (indexByKey.has(spec.key)) {
      issues.push({
        line: 1,
        column: spec.label,
        message: `Both "${header[indexByKey.get(spec.key)!]}" and "${name}" look like the ${spec.label} column. Rename or remove one so it's clear which to use.`,
      });
      return;
    }
    indexByKey.set(spec.key, index);
    matchedColumns[name] = spec.label;
  });

  const missing = specs.filter((s) => s.required && !indexByKey.has(s.key));
  for (const spec of missing) {
    issues.push({
      line: 1,
      column: spec.label,
      message:
        `No ${spec.label} column. Add a column headed "${spec.key}"` +
        ` (also recognised: ${spec.aliases.filter((a) => a !== normaliseHeader(spec.key)).slice(0, 4).join(", ")}),` +
        ` with values like ${spec.example}.`,
    });
  }

  return { indexByKey, matchedColumns, ignoredColumns, missingRequired: missing.length > 0 };
}

// --- Parsing ------------------------------------------------------------------------------

export function parseImport<K extends ImportKind>(kind: K, text: string): ImportPreview<K> {
  const issues: ImportIssue[] = [];
  let issueCount = 0;
  const addIssue = (issue: ImportIssue) => {
    issueCount += 1;
    if (issues.length < MAX_LISTED_ISSUES) issues.push(issue);
  };

  const csv = parseCsv(text);
  const headerIssues: ImportIssue[] = [];
  const columns = matchColumns(kind, csv.header, headerIssues);
  headerIssues.forEach(addIssue);
  csv.errors.forEach((e) => addIssue({ line: e.line, message: e.message }));

  const presentColumns = [...columns.indexByKey.keys()];
  const empty: ImportPreview<K> = {
    kind,
    ok: false,
    rows: [],
    rowCount: csv.rows.length,
    issues,
    issueCount,
    matchedColumns: columns.matchedColumns,
    presentColumns,
    ignoredColumns: columns.ignoredColumns,
    duplicateRows: 0,
  };
  if (csv.header.length === 0 || columns.missingRequired) {
    return { ...empty, issueCount };
  }
  if (csv.rows.length === 0) {
    addIssue({ line: null, message: "The file has a header row but no data rows." });
    return { ...empty, issues, issueCount };
  }

  const cell = (cells: string[], key: string): string => {
    const index = columns.indexByKey.get(key);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  const rows: ImportRow<K>[] = [];
  const seen = new Map<string, number>();
  let duplicateRows = 0;
  const memberIdLines = new Map<string, number>();

  for (const { line, cells } of csv.rows) {
    if (cells.every((c) => c.trim() === "")) continue;
    const bad = (column: string, message: string) => addIssue({ line, column, message });
    let rowOk = true;
    const fail = (column: string, message: string) => {
      bad(column, message);
      rowOk = false;
    };

    const memberId = cell(cells, "member_id");
    if (!memberId) fail("Member ID", "Member ID is blank.");
    else if (memberId.length > 64) fail("Member ID", "Member ID is longer than 64 characters.");

    if (kind === "members") {
      const name = cell(cells, "name");
      if (!name) fail("Name", "Name is blank.");
      else if (name.length > 200) fail("Name", "Name is longer than 200 characters.");

      const mobileRaw = cell(cells, "mobile");
      if (mobileRaw && !PHONE.test(mobileRaw)) {
        fail("Mobile", `"${mobileRaw}" doesn't look like a phone number. Leave it blank if there isn't one.`);
      }

      const joinRaw = cell(cells, "join_date");
      const joinDate = parseIsoDate(joinRaw);
      if (!joinRaw) fail("Join date", "Join date is blank.");
      else if (!joinDate) fail("Join date", `"${joinRaw}" isn't a date in YYYY-MM-DD form (for example 2025-02-09).`);

      if (memberId && memberIdLines.has(memberId)) {
        fail("Member ID", `Member ${memberId} appears twice (also line ${memberIdLines.get(memberId)}). Each member should be one row.`);
      } else if (memberId) {
        memberIdLines.set(memberId, line);
      }

      // Optional. A blank cell, or no column at all, is no request — null,
      // never "false". A date is read as the start of that day, and a time
      // zone is refused like a check-in's.
      const cancelRaw = cell(cells, "cancellation_requested");
      let cancellation: string | null = null;
      if (cancelRaw) {
        const asDate = parseIsoDate(cancelRaw);
        if (hasTimeZone(cancelRaw)) {
          fail("Cancellation requested", `"${cancelRaw}" has a time zone. Use the gym's local time, like 2026-09-05T15:30:00, or leave it blank.`);
        } else if (asDate) {
          cancellation = `${asDate}T00:00:00`;
        } else {
          cancellation = parseTimestamp(cancelRaw);
          if (!cancellation) fail("Cancellation requested", `"${cancelRaw}" isn't a date or a date and time like 2026-09-05T15:30:00. Leave it blank if there's no request.`);
        }
      }

      if (rowOk) {
        rows.push({ member_id: memberId, name, mobile: mobileRaw || null, join_date: joinDate as string, cancellation_requested: cancellation } as ImportRow<K>);
      }
      continue;
    }

    if (kind === "contracts") {
      const contractType = cell(cells, "contract_type");
      if (!contractType) fail("Plan", "Plan is blank.");
      else if (contractType.length > 60) fail("Plan", "Plan name is longer than 60 characters.");

      const autoRaw = cell(cells, "auto_renew");
      const autoRenew = parseBooleanCell(autoRaw);
      if (!autoRaw) {
        fail(
          "Auto-renews",
          "Auto-renews is blank. Every contract must say whether it renews by itself — an auto-renewing member is never called, so this can't be assumed."
        );
      } else if (autoRenew === null) {
        fail("Auto-renews", `"${autoRaw}" isn't a yes or no. Use true/false or yes/no.`);
      }

      const startRaw = cell(cells, "start_date");
      const endRaw = cell(cells, "end_date");
      const start = parseIsoDate(startRaw);
      const end = parseIsoDate(endRaw);
      if (!startRaw) fail("Start date", "Start date is blank.");
      else if (!start) fail("Start date", `"${startRaw}" isn't a date in YYYY-MM-DD form.`);
      if (!endRaw) fail("End date", "End date is blank.");
      else if (!end) fail("End date", `"${endRaw}" isn't a date in YYYY-MM-DD form.`);
      if (start && end && end < start) fail("End date", `Ends (${end}) before it starts (${start}).`);

      const feeRaw = cell(cells, "monthly_fee");
      const fee = parseMoney(feeRaw);
      if (!feeRaw) fail("Monthly fee", "Monthly fee is blank.");
      else if (fee === null) fail("Monthly fee", `"${feeRaw}" isn't an amount of dollars (for example 79 or 79.95).`);
      else if (fee > MAX_MONTHLY_AMOUNT) {
        fail("Monthly fee", `$${feeRaw} a month is more than any membership costs — check this is the monthly fee column.`);
      }

      const renewalRaw = cell(cells, "renewal_fee");
      const renewal = renewalRaw ? parseMoney(renewalRaw) : null;
      if (renewalRaw && renewal === null) {
        fail("Renewal fee", `"${renewalRaw}" isn't an amount of dollars. Leave it blank if the export doesn't say.`);
      } else if (renewal !== null && renewal > MAX_MONTHLY_AMOUNT) {
        fail("Renewal fee", `$${renewalRaw} is more than any renewal costs — check this is the renewal fee column.`);
      }

      if (rowOk) {
        const row: ContractRow = {
          member_id: memberId,
          contract_type: contractType,
          auto_renew: autoRenew as boolean,
          start_date: start as string,
          end_date: end as string,
          monthly_fee: fee as number,
          renewal_fee: renewal,
        };
        const key = JSON.stringify(row);
        if (seen.has(key)) duplicateRows += 1;
        else {
          seen.set(key, line);
          rows.push(row as ImportRow<K>);
        }
      }
      continue;
    }

    const visitRaw = cell(cells, "visited_at");
    const visitedAt = parseTimestamp(visitRaw);
    if (!visitRaw) fail("Check-in time", "Check-in time is blank.");
    else if (hasTimeZone(visitRaw)) {
      fail(
        "Check-in time",
        `"${visitRaw}" has a time zone. Export check-in times in the gym's local time, like 2026-09-10T17:45:00 — a UTC time would move morning visits to the day before.`
      );
    } else if (!visitedAt) {
      fail("Check-in time", `"${visitRaw}" isn't a date and time like 2026-09-10T17:45:00.`);
    }
    if (rowOk) {
      const key = `${memberId}|${visitedAt}`;
      if (seen.has(key)) duplicateRows += 1;
      else {
        seen.set(key, line);
        rows.push({ member_id: memberId, visited_at: visitedAt as string } as ImportRow<K>);
      }
    }
  }

  return {
    kind,
    ok: issueCount === 0 && rows.length > 0,
    rows: issueCount === 0 ? rows : [],
    rowCount: csv.rows.filter((r) => !r.cells.every((c) => c.trim() === "")).length,
    issues,
    issueCount,
    matchedColumns: columns.matchedColumns,
    presentColumns,
    ignoredColumns: columns.ignoredColumns,
    duplicateRows,
  };
}
