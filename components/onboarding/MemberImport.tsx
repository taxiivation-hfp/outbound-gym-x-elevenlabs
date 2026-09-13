"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ImportIssue, ImportKind } from "@/lib/memberImport";
import { Button, Notice, Pill, type PillTone } from "./ui";

/**
 * The three CSV uploads, in the order they have to happen: members first,
 * because contracts and check-ins refer to them.
 *
 * Each file is checked before anything is written — what parsed, which columns
 * were recognised, what was ignored, and every problem with its line — and
 * imported only when a person presses Import on a clean file.
 */

export interface ColumnHelp {
  label: string;
  key: string;
  required: boolean;
  example: string;
}

interface PreviewSummary {
  kind: ImportKind;
  ok: boolean;
  row_count: number;
  importable_rows: number;
  duplicate_rows: number;
  matched_columns: Record<string, string>;
  ignored_columns: string[];
  issues: ImportIssue[];
  issue_count: number;
}

type SlotState =
  | { phase: "idle" }
  | { phase: "checking"; file: File }
  | { phase: "checked"; file: File; preview: PreviewSummary }
  | { phase: "rejected"; file: File; message: string; preview: PreviewSummary | null }
  | { phase: "importing"; file: File; preview: PreviewSummary }
  | { phase: "imported"; file: File; preview: PreviewSummary; written: number; alreadyPresent: number };

/** The slot's state chip: what has actually happened to a file on this page, nothing more. */
const SLOT_BADGE: Record<SlotState["phase"], { label: string; tone: PillTone }> = {
  idle: { label: "no file chosen", tone: "ghost" },
  checking: { label: "checking", tone: "plain" },
  checked: { label: "checked, not imported", tone: "plain" },
  rejected: { label: "not imported", tone: "flag" },
  importing: { label: "importing", tone: "plain" },
  imported: { label: "imported", tone: "accent" },
};

const TITLES: Record<ImportKind, { title: string; what: string }> = {
  members: {
    title: "Members",
    what: "One row per member.",
  },
  contracts: {
    title: "Contracts",
    what: "One row per membership term.",
  },
  checkins: {
    title: "Check-ins",
    what: "One row per visit.",
  },
};

export default function MemberImport({
  gymId,
  columns,
  uploadsAvailable,
  importAvailable,
}: {
  gymId: string;
  columns: Record<ImportKind, ColumnHelp[]>;
  uploadsAvailable: boolean;
  /** Checking a file only reads; importing it writes, and can be switched off on its own. */
  importAvailable: boolean;
}) {
  const kinds: ImportKind[] = ["members", "contracts", "checkins"];
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {kinds.map((kind, index) => (
        <Slot
          key={kind}
          index={index + 1}
          kind={kind}
          gymId={gymId}
          columns={columns[kind]}
          uploadsAvailable={uploadsAvailable}
          importAvailable={importAvailable}
        />
      ))}
    </ol>
  );
}

async function send(gymId: string, kind: ImportKind, file: File, commit: boolean) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  form.append("commit", commit ? "true" : "false");
  const res = await fetch(`/api/onboarding/${encodeURIComponent(gymId)}/import`, { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function Slot({
  index,
  kind,
  gymId,
  columns,
  uploadsAvailable,
  importAvailable,
}: {
  index: number;
  kind: ImportKind;
  gymId: string;
  columns: ColumnHelp[];
  uploadsAvailable: boolean;
  importAvailable: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SlotState>({ phase: "idle" });
  const copy = TITLES[kind];

  const check = async (file: File) => {
    setState({ phase: "checking", file });
    try {
      const { ok, status, body } = await send(gymId, kind, file, false);
      if (ok && body?.preview) setState({ phase: "checked", file, preview: body.preview });
      else setState({ phase: "rejected", file, message: body?.error ?? `The file couldn't be checked (HTTP ${status}).`, preview: body?.preview ?? null });
    } catch {
      setState({ phase: "rejected", file, message: "Couldn't reach the server. Check the connection and try again.", preview: null });
    }
  };

  const commit = async () => {
    if (state.phase !== "checked") return;
    const { file, preview } = state;
    setState({ phase: "importing", file, preview });
    try {
      const { ok, status, body } = await send(gymId, kind, file, true);
      if (ok && body?.committed) {
        setState({ phase: "imported", file, preview, written: body.outcome.written, alreadyPresent: body.outcome.alreadyPresent });
        router.refresh();
      } else {
        setState({ phase: "rejected", file, message: body?.error ?? `The import failed (HTTP ${status}).`, preview: body?.preview ?? preview });
      }
    } catch {
      setState({ phase: "rejected", file, message: "Couldn't reach the server, so the import may not have finished. Re-uploading the same file is safe.", preview });
    }
  };

  const busy = state.phase === "checking" || state.phase === "importing";
  const preview = "preview" in state ? state.preview : null;
  const badge = SLOT_BADGE[state.phase];

  return (
    <li className="flex flex-col gap-[11px] rounded-xl border border-line bg-canvas p-[15px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="m-0 text-[13.5px] font-bold text-ink">
          <span className="mr-2 tabular-nums text-dim">{index}</span>
          {copy.title}
        </h3>
        <Pill tone={badge.tone}>{badge.label}</Pill>
        <div className="ml-auto flex flex-none items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) check(file);
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={!uploadsAvailable || busy}>
            {state.phase === "idle" ? `Choose ${copy.title.toLowerCase()} CSV` : "Choose a different file"}
          </Button>
        </div>
      </div>
      <p className="max-w-[70ch] text-[12.5px] leading-[1.5] text-muted text-pretty">
        {copy.what}
      </p>
      <p className="text-[11.5px] leading-[1.5] text-dim">
        Columns:{" "}
        {columns.map((c, i) => (
          <span key={c.key}>
            {i > 0 ? " · " : ""}
            <code className="font-mono text-ink-2">{c.key}</code>
            {c.required ? "" : " (optional)"}
          </span>
        ))}
        . Dates as YYYY-MM-DD.
      </p>

      <div aria-live="polite" className="flex flex-col gap-2.5 empty:hidden">
        {state.phase === "checking" && <p className="text-[12.5px] text-ink-2">Checking {state.file.name}…</p>}

        {preview && (
          <div className="flex flex-col gap-2.5 border-t border-line pt-3">
            <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1">
              <span className="text-[12.5px]">
                <strong className="font-display text-[16px] tracking-[-0.02em] text-ink">{preview.row_count.toLocaleString("en-AU")}</strong>{" "}
                <span className="text-dim">rows read</span>
              </span>
              {preview.ok && (
                <span className="text-[12.5px]">
                  <strong className="font-display text-[16px] tracking-[-0.02em] text-accent-ink">
                    {preview.importable_rows.toLocaleString("en-AU")}
                  </strong>{" "}
                  <span className="text-dim">ready to import</span>
                </span>
              )}
              {preview.issue_count > 0 && (
                <span className="text-[12.5px]">
                  <strong className="font-display text-[16px] tracking-[-0.02em] text-flag-ink">{preview.issue_count.toLocaleString("en-AU")}</strong>{" "}
                  <span className="text-dim">problem{preview.issue_count === 1 ? "" : "s"}</span>
                </span>
              )}
              {preview.duplicate_rows > 0 && (
                <span className="text-[12.5px] text-dim">{preview.duplicate_rows.toLocaleString("en-AU")} exact duplicates collapsed</span>
              )}
              <code className="font-mono text-[11.5px] text-dim wrap-anywhere">{state.phase !== "idle" ? state.file.name : ""}</code>
            </div>
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-[6rem_1fr]">
              <dt className="text-dim">Read as</dt>
              <dd className="m-0 text-ink-2">
                {Object.entries(preview.matched_columns).map(([header, label], i) => (
                  <span key={header}>
                    {i > 0 ? " · " : ""}
                    <code className="font-mono">{header}</code> → {label}
                  </span>
                ))}
              </dd>
              {preview.ignored_columns.length > 0 && (
                <>
                  <dt className="text-dim">Ignored</dt>
                  <dd className="m-0 text-ink-2">
                    {preview.ignored_columns.map((c) => (
                      <code key={c} className="mr-2 font-mono">
                        {c}
                      </code>
                    ))}
                    <span className="text-dim">— not needed, not stored.</span>
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        {state.phase === "rejected" && (
          <div className="flex flex-col gap-2.5">
            <Notice tone="fault" title="Not imported">
              {state.message}
            </Notice>
            {state.preview && state.preview.issues.length > 0 && <IssueList issues={state.preview.issues} total={state.preview.issue_count} />}
          </div>
        )}

        {state.phase === "checked" &&
          (importAvailable ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={commit}>
                Import {state.preview.importable_rows.toLocaleString("en-AU")} {copy.title.toLowerCase()}
              </Button>
              <p className="text-[11.5px] text-dim">Nothing has been written yet.</p>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-2">
              <strong className="text-flag-ink">This file is ready, but importing is switched off here.</strong> Nothing was
              written. Ask your admin to switch imports on.
            </p>
          ))}

        {state.phase === "importing" && <p className="text-[12.5px] text-ink-2">Importing…</p>}

        {state.phase === "imported" && (
          <p className="text-[12.5px] text-ink-2" role="status">
            <strong className="text-accent-ink">Imported.</strong>{" "}
            {kind === "members"
              ? `${state.written.toLocaleString("en-AU")} new members added${
                  state.alreadyPresent > 0 ? `, ${state.alreadyPresent.toLocaleString("en-AU")} already here updated from this file` : ""
                }.`
              : kind === "contracts"
                ? `${state.written.toLocaleString("en-AU")} new contract rows added${
                    state.alreadyPresent > 0 ? `, ${state.alreadyPresent.toLocaleString("en-AU")} already here and marked as still in this export` : ""
                  }.`
                : `${state.written.toLocaleString("en-AU")} new check-ins added${
                    state.alreadyPresent > 0 ? `, ${state.alreadyPresent.toLocaleString("en-AU")} were already here` : ""
                  }.`}
          </p>
        )}
      </div>
    </li>
  );
}

/** Every problem with its line: what to fix, and where. */
function IssueList({ issues, total }: { issues: ImportIssue[]; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11.5px] text-dim">
        {total > issues.length ? `The first ${issues.length} of ${total.toLocaleString("en-AU")} problems` : `${total} problem${total === 1 ? "" : "s"}`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-left text-[12px]">
          <caption className="sr-only">Problems in the file, by line</caption>
          <thead className="text-[10.5px] uppercase tracking-[0.08em] text-dim">
            <tr>
              <th scope="col" className="px-[11px] py-1 font-bold">
                Line
              </th>
              <th scope="col" className="px-[11px] py-1 font-bold">
                Column
              </th>
              <th scope="col" className="px-[11px] py-1 font-bold">
                What to fix
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, i) => (
              <tr key={`${issue.line}-${issue.column}-${i}`} className="align-baseline">
                <td className="rounded-l-[9px] border-y border-l border-line bg-surface px-[11px] py-[7px] text-[11px] font-bold tabular-nums text-flag-ink">
                  {issue.line ?? "—"}
                </td>
                <td className="border-y border-line bg-surface px-[11px] py-[7px] text-dim">{issue.column ?? "—"}</td>
                <td className="rounded-r-[9px] border-y border-r border-line bg-surface px-[11px] py-[7px] leading-relaxed text-ink-2">
                  {issue.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
