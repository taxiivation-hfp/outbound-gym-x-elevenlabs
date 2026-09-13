"use client";

import type { KeyboardEvent, ReactNode } from "react";
import {
  CALL_TYPE_TINT,
  dateTime,
  expiresLabel,
  joinedOn,
  longDate,
  parseTranscript,
  shortDate,
  tenureLabel,
  whyNow,
} from "@/components/calls/format";
import { blockedLabel, callTypeLabel, cohortLabel, outcomeText, reasonLabel } from "@/lib/labels";
import type { QueueEntry } from "@/lib/queueView";
import type { CallRecord } from "@/lib/types";

/**
 * One member: a dense row, and underneath it when opened, everything the queue
 * and the latest call record know about them. The same row-and-expansion
 * pattern is used on every screen that lists things.
 */

export const ROW_GRID = "minmax(220px,1.7fr) 190px 64px 92px 116px 78px 76px 64px 132px";

export interface CallState {
  status: "idle" | "calling" | "placed" | "refused";
  detail?: string;
}

const CELL = "flex h-full items-center border-r border-cell-line px-2.5";
const NUM = `${CELL} justify-center gap-1.5 tabular-nums`;

export default function QueueRow({
  entry,
  asOf,
  open,
  record,
  recordLoading,
  callState,
  onToggle,
  onCall,
}: {
  entry: QueueEntry;
  asOf: string;
  open: boolean;
  record: CallRecord | null;
  recordLoading: boolean;
  callState?: CallState;
  onToggle: () => void;
  onCall: () => void;
}) {
  const due = Boolean(entry.call_type);
  const cancelling = Boolean(entry.cancellation_requested);
  const tint = entry.call_type ? CALL_TYPE_TINT[entry.call_type] : { bg: "bg-off-bg", ink: "text-off-ink", border: "" };
  const soon = due && entry.days_to_expiry >= 0 && entry.days_to_expiry <= 7 && !entry.auto_renew;
  const label = `${entry.name}, ${entry.call_type ? callTypeLabel[entry.call_type] : "not called"}${cancelling ? ", asked to cancel" : ""}, ${entry.days_since_visit} days since last visit`;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <>
      <div
        role="row"
        tabIndex={0}
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
        onKeyDown={onKey}
        className={`h-8 cursor-pointer select-none border-b border-row-line px-3.5 transition-colors hover:bg-row-hover ${
          open ? "bg-row-open shadow-[inset_3px_0_0_var(--bar)]" : due ? "bg-surface" : "bg-row-excl"
        }`}
        style={{ display: "grid", gridTemplateColumns: ROW_GRID, alignItems: "stretch" }}
      >
        <div role="cell" className="flex h-full min-w-0 items-center gap-2 border-r border-cell-line pr-2.5">
          <span className={`truncate text-[13.5px] tracking-[-0.005em] ${cancelling ? "font-bold" : "font-medium"} ${due ? "text-ink" : "text-dim"}`}>
            {entry.name}
          </span>
          {cancelling && (
            <span className="flex-none rounded-[5px] bg-flag px-[7px] py-0.5 text-[9.5px] font-bold tracking-[0.1em] text-on-flag">
              CANCELLING
            </span>
          )}
        </div>
        <div role="cell" className={`${CELL} block truncate text-center text-[11.5px] leading-8 ${due ? "text-dim" : "text-muted"}`}>
          {due ? whyNow(entry, asOf) : (blockedLabel[entry.blocked_by ?? ""] ?? "not called")}
          {due && entry.dial_count > 0 ? ` · ${entry.dial_count} ${entry.dial_count === 1 ? "dial" : "dials"}` : ""}
        </div>
        <div role="cell" className={`${NUM} text-[13px] ${!due ? "text-dim" : entry.days_since_visit >= 45 ? "text-ink" : entry.days_since_visit >= 21 ? "text-ink-2" : "text-dim"}`}>
          {entry.days_since_visit}
        </div>
        <div role="cell" className={`${NUM} text-[13px] ${due && entry.visit_count_90d === 0 ? "text-ink" : "text-dim"}`}>
          {entry.visit_count_90d}
        </div>
        <div role="cell" className={`${NUM} text-[13px] ${soon ? "font-bold text-accent-ink" : !due || entry.days_to_expiry < 0 ? "text-dim" : "text-ink-2"}`}>
          {expiresLabel(entry, asOf)}
        </div>
        <div role="cell" className={`${NUM} text-[12.5px] ${due ? "text-muted" : "text-dim"}`}>
          {tenureLabel(entry.tenure_days)}
        </div>
        <div role="cell" className={`${NUM} text-[13px] font-semibold ${due ? "text-ink-2" : "text-dim"}`}>
          ${entry.monthly_fee}
        </div>
        <div role="cell" className={`${NUM} text-[13px] ${!due ? "text-dim" : entry.dial_count >= 3 ? "text-flag-ink" : entry.dial_count > 0 ? "text-ink-2" : "text-dim"}`}>
          {entry.dial_count || "—"}
        </div>
        <div role="cell" className={`flex h-full items-center justify-center border-r border-cell-line text-[11px] font-bold uppercase tracking-[0.11em] ${tint.bg} ${tint.ink}`}>
          {entry.call_type ? callTypeLabel[entry.call_type] : "Not called"}
        </div>
      </div>

      {open && (
        <div role="region" aria-label={`${entry.name}: details`} className="panel-in rounded-b-[10px] border-b border-line-strong bg-panel shadow-[inset_3px_0_0_var(--bar),inset_0_1px_0_var(--panel-edge)]">
          <div className="px-3.5" style={{ display: "grid", gridTemplateColumns: ROW_GRID }}>
            <LastCall entry={entry} record={record} loading={recordLoading} placed={callState?.status === "placed"} />

            <div className="flex min-w-0 flex-col gap-[11px] border-r border-cell-line py-[13px] pl-3.5 pr-4" style={{ gridColumn: "3 / 6" }}>
              <Field label={due ? "Why now" : "Why not"}>{entry.trigger ?? entry.blocked_reason ?? "—"}</Field>
              <Field label="Outcome" tone={record?.outcome ? "accent" : "dim"}>
                {record?.outcome ? outcomeText(record.outcome) : record ? statusWord(record) : "—"}
              </Field>
              <Field label="They said" tone={record?.reason_for_absence || record?.reason_detail ? "ink" : "dim"}>
                {record?.reason_for_absence || record?.reason_detail ? (
                  <>
                    {record.reason_for_absence ? (reasonLabel[record.reason_for_absence] ?? record.reason_for_absence) : ""}
                    {record.reason_detail ? `${record.reason_for_absence ? " — " : ""}“${record.reason_detail}”` : ""}
                  </>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Committed" tone={record?.committed_day ? "accent" : "dim"}>
                {record?.committed_day ?? "—"}
              </Field>
              {record?.human_followup && (
                <Field label="Needs a person" tone="flag">
                  {record.human_followup}
                </Field>
              )}
              <Field label="Dials" tone={entry.dial_count ? "ink" : "dim"}>
                {entry.dial_count
                  ? `${entry.dial_count} · last ${entry.last_call_at ? dateTime(entry.last_call_at) : "—"}`
                  : "none yet"}
              </Field>
              <Field label="Phone">{entry.phone}</Field>
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-3 py-[13px] pl-3.5" style={{ gridColumn: "6 / 10" }}>
              <div className="grid grid-cols-3 gap-x-4 gap-y-[11px]">
                <Field label="Plan">{entry.contract_type}</Field>
                <Field label="Term">{entry.auto_renew ? "Auto-renews" : "Fixed term"}</Field>
                <Field label={entry.days_to_expiry < 0 ? "Ended" : entry.auto_renew ? "Rolls over" : "Term ends"} tone={soon ? "accent" : "ink"}>
                  {longDate(entry.expiry_date)}
                </Field>
                <Field label="Fee">${entry.monthly_fee}/mo</Field>
                <Field label="Renewal fee" tone={entry.renewal_fee === null ? "dim" : "ink"}>
                  {entry.renewal_fee === null ? "not recorded" : `$${entry.renewal_fee}/mo`}
                </Field>
                <Field label="Joined">
                  {shortDate(joinedOn(asOf, entry.tenure_days))} · {tenureLabel(entry.tenure_days)}
                </Field>
                <Field label="Last visit">{entry.days_since_visit} days ago</Field>
                <Field label="Before that" title="Visits a week before the last four weeks">
                  {entry.old_rate.toFixed(1)} a week
                </Field>
                <Field label="Cohort">{cohortLabel[entry.cohort]}</Field>
                {entry.cancellation_requested && (
                  <Field label="Asked to cancel" tone="flag">
                    {longDate(entry.cancellation_requested.slice(0, 10))}
                  </Field>
                )}
                {due && <Field label="Conversation">{`#${entry.attempt_number}`}</Field>}
              </div>
              <CallAction entry={entry} state={callState} onCall={onCall} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function statusWord(record: CallRecord): string {
  if (record.status === "initiated") return "In progress";
  if (record.status === "failed") return "Didn't connect";
  if (record.status === "completed") return "Completed, no outcome recorded";
  return "Not called";
}

function LastCall({ entry, record, loading, placed }: { entry: QueueEntry; record: CallRecord | null; loading: boolean; placed: boolean }) {
  const lines = record?.transcript ? parseTranscript(record.transcript) : [];
  let body: ReactNode;
  if (loading && !record) body = <p className="text-[13px] text-dim">Loading the latest call…</p>;
  else if (!record && entry.dial_count === 0 && !placed) body = <p className="text-[13px] text-dim">No calls placed yet</p>;
  else if (!record) body = <p className="text-[13px] text-dim">No call record came back. Refresh to try again.</p>;
  else if (lines.length === 0)
    body = (
      <p className="text-[13px] text-dim">
        {record.status === "initiated"
          ? "Call in progress. The transcript lands when it ends — refresh to check."
          : record.status === "failed"
            ? "The call didn't connect."
            : "No transcript came back for this call."}
      </p>
    );
  else
    body = (
      <div className="flex max-h-[210px] flex-col gap-2 overflow-auto pr-3">
        {lines.map((line, i) => (
          <div key={i} className="line-in grid grid-cols-[62px_minmax(0,1fr)] items-start gap-3" style={{ animationDelay: `${Math.min(i, 12) * 0.035}s` }}>
            <span className={`pt-0.5 text-[11.5px] font-bold ${line.who === "Agent" ? "text-dim" : "text-accent-ink"}`}>{line.who}</span>
            <span className="whitespace-pre-wrap text-[13px] leading-normal text-ink-2 text-pretty">{line.text}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="min-w-0 border-r border-cell-line py-[13px] pr-4" style={{ gridColumn: "1 / 3" }}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-accent-ink">Last call</span>
        <span className="text-[11.5px] text-dim">
          {record
            ? `${dateTime(record.created_at)}${record.call_type ? ` · ${callTypeLabel[record.call_type]}` : ""}${record.attempt_number ? ` · conversation #${record.attempt_number}` : ""}`
            : entry.dial_count === 0
              ? "never called"
              : ""}
        </span>
      </div>
      {body}
    </div>
  );
}

function CallAction({ entry, state, onCall }: { entry: QueueEntry; state?: CallState; onCall: () => void }) {
  if (!entry.call_type) {
    return (
      <p className="text-[12px] leading-snug text-dim">
        Not dialled: {(blockedLabel[entry.blocked_by ?? ""] ?? "not due").toLowerCase()}. The call route refuses this member
        too.
      </p>
    );
  }
  const status = state?.status ?? "idle";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCall();
          }}
          disabled={status === "calling" || status === "placed"}
          className="h-[30px] rounded-[9px] border border-accent-line bg-accent px-3.5 text-[12.5px] font-bold text-on-accent transition-colors hover:bg-accent-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "calling" ? "Dialling…" : status === "placed" ? "Call placed" : "Call now"}
        </button>
        <span className="text-[11.5px] text-dim">
          {status === "placed" ? "Refresh when it ends to see the transcript." : `${callTypeLabel[entry.call_type]} agent`}
        </span>
      </div>
      {status === "refused" && (
        <p role="alert" className="rounded-lg border border-flag bg-flag-wash px-2.5 py-1.5 text-[12px] text-ink-2">
          <strong className="text-flag-ink">Not placed.</strong> {state?.detail}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  tone = "ink",
  title,
}: {
  label: string;
  children: ReactNode;
  tone?: "ink" | "dim" | "accent" | "flag";
  title?: string;
}) {
  const color = tone === "dim" ? "text-dim" : tone === "accent" ? "text-accent-ink" : tone === "flag" ? "text-flag-ink" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-dim">{label}</span>
      <span className={`text-[13px] leading-[1.35] text-pretty ${color}`}>{children}</span>
    </div>
  );
}
