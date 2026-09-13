"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ImportIssue, ImportKind } from "@/lib/memberImport";
import { Button, Notice } from "./ui";

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

const TITLES: Record<ImportKind, { title: string; what: string; rule: string }> = {
  members: {
    title: "Members",
    what: "One row per member.",
    rule: "Re-uploading updates names and numbers. Nobody is removed.",
  },
  contracts: {
    title: "Contracts",
    what: "One row per membership term — a renewal is a new row with its own dates.",
    rule: "Rows are only ever added. The latest term is the current one — and if rows disagree about whether it auto-renews, the member is treated as auto-renewing and isn't called.",
  },
  checkins: {
    title: "Check-ins",
    what: "One row per visit.",
    rule: "Rows are only ever added. Days since the last visit are worked out when the queue is built.",
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
    <ol className="space-y-4">
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

  return (
    <li className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[65ch]">
          <h3 className="text-base font-bold text-white">
            <span className="mr-2 tabular-nums text-zinc-400">{index}</span>
            {copy.title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {copy.what} {copy.rule}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Columns:{" "}
            {columns.map((c, i) => (
              <span key={c.key}>
                {i > 0 ? ", " : ""}
                <code className="font-mono text-zinc-200">{c.key}</code>
                {c.required ? "" : " (optional)"}
              </span>
            ))}
            . Dates as YYYY-MM-DD.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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

      <div aria-live="polite" className="mt-4 empty:mt-0">
        {state.phase === "checking" && <p className="text-sm text-zinc-300">Checking {state.file.name}…</p>}

        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              <code className="font-mono text-zinc-200">{state.phase !== "idle" ? state.file.name : ""}</code>:{" "}
              {preview.row_count.toLocaleString("en-AU")} rows
              {preview.duplicate_rows > 0 ? `, ${preview.duplicate_rows.toLocaleString("en-AU")} exact duplicates collapsed` : ""}
              {preview.ok ? `, ${preview.importable_rows.toLocaleString("en-AU")} ready to import.` : "."}
            </p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
              <dt className="text-zinc-400">Read as</dt>
              <dd className="text-zinc-300">
                {Object.entries(preview.matched_columns).map(([header, label], i) => (
                  <span key={header}>
                    {i > 0 ? " · " : ""}
                    <code className="font-mono">{header}</code> → {label}
                  </span>
                ))}
              </dd>
              {preview.ignored_columns.length > 0 && (
                <>
                  <dt className="text-zinc-400">Ignored</dt>
                  <dd className="text-zinc-300">
                    {preview.ignored_columns.map((c) => (
                      <code key={c} className="mr-2 font-mono">
                        {c}
                      </code>
                    ))}
                    <span className="text-zinc-400">— not needed, not stored.</span>
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        {state.phase === "rejected" && (
          <div className="mt-3 space-y-3">
            <Notice tone="fault" title="Not imported">
              {state.message}
            </Notice>
            {state.preview && state.preview.issues.length > 0 && <IssueTable issues={state.preview.issues} total={state.preview.issue_count} />}
          </div>
        )}

        {state.phase === "checked" &&
          (importAvailable ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={commit}>
                Import {state.preview.importable_rows.toLocaleString("en-AU")} {copy.title.toLowerCase()}
              </Button>
              <p className="text-xs text-zinc-400">Nothing has been written yet.</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-amber-200">
              <span className="font-semibold text-amber-300">This file is ready, but importing is switched off here.</span>{" "}
              Nothing was written. Ask your admin to switch imports on.
            </p>
          ))}

        {state.phase === "importing" && <p className="mt-3 text-sm text-zinc-300">Importing…</p>}

        {state.phase === "imported" && (
          <p className="mt-3 text-sm text-zinc-300" role="status">
            <span className="font-semibold text-signal">Imported.</span>{" "}
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

function IssueTable({ issues, total }: { issues: ImportIssue[]; total: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[32rem] divide-y divide-zinc-900 text-left text-xs">
        <caption className="px-3 py-2 text-left text-zinc-400">
          {total > issues.length ? `The first ${issues.length} of ${total.toLocaleString("en-AU")} problems` : `${total} problem${total === 1 ? "" : "s"}`}
        </caption>
        <thead className="text-zinc-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Line</th>
            <th scope="col" className="px-3 py-2 font-semibold">Column</th>
            <th scope="col" className="px-3 py-2 font-semibold">What to fix</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900">
          {issues.map((issue, i) => (
            <tr key={`${issue.line}-${issue.column}-${i}`} className="align-top">
              <td className="px-3 py-2 tabular-nums text-zinc-300">{issue.line ?? "—"}</td>
              <td className="px-3 py-2 text-zinc-300">{issue.column ?? "—"}</td>
              <td className="px-3 py-2 leading-relaxed text-zinc-200">{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
