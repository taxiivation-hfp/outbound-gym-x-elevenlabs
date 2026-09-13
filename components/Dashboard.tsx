"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { QueueEntry, QueueView } from "@/lib/queueView";
import type { CallType } from "@/lib/callType";
import type { CallRecord } from "@/lib/types";
import {
  blockedLabel,
  callTypeBlurb,
  callTypeLabel,
  callTypeStyle,
  cohortLabel,
  outcomeClass,
  outcomeText,
} from "@/lib/labels";
import Avatar from "@/components/Avatar";
import CancellationRequests from "@/components/CancellationRequests";
import EconomicsPanel from "@/components/EconomicsPanel";

const CALL_TYPES: CallType[] = ["renewal", "reengagement", "winback"];
const PER_COLUMN = 6;
const PER_PLACED_COLUMN = 3;

interface CallState {
  status: "idle" | "calling" | "placed" | "refused";
  detail?: string;
}

export default function Dashboard({ view }: { view: QueueView }) {
  const [gymId, setGymId] = useState(view.default_gym_id);
  const [callState, setCallState] = useState<Record<string, CallState>>({});
  const [records, setRecords] = useState<Record<string, CallRecord>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedPlaced, setExpandedPlaced] = useState<Record<string, boolean>>({});

  const due = useMemo(() => view.entries.filter((e) => e.call_type), [view.entries]);
  const byType = useMemo(() => {
    const out: Record<CallType, QueueEntry[]> = {
      renewal: [],
      reengagement: [],
      winback: [],
    };
    for (const entry of due) out[entry.call_type as CallType].push(entry);
    // Most overdue first within each column: the member who has been away
    // longest, or whose term lapses soonest.
    out.renewal.sort((a, b) => a.days_to_expiry - b.days_to_expiry);
    out.reengagement.sort((a, b) => b.days_since_visit - a.days_since_visit);
    out.winback.sort((a, b) => a.days_to_expiry - b.days_to_expiry);
    return out;
  }, [due]);

  const excluded = useMemo(() => {
    const groups: Record<string, QueueEntry[]> = {};
    for (const entry of view.entries) {
      if (!entry.blocked_by) continue;
      (groups[entry.blocked_by] ??= []).push(entry);
    }
    return groups;
  }, [view.entries]);

  const calledIds = useMemo(
    () => Object.keys(callState).filter((id) => callState[id].status === "placed"),
    [callState]
  );
  const recordIds = useMemo(
    () => Array.from(new Set([...calledIds, ...Object.keys(records)])),
    [calledIds, records]
  );

  const refresh = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/call-records?member_ids=${ids.join(",")}`);
      if (!res.ok) throw new Error(`call records: ${res.status}`);
      const fetched = (await res.json()) as Record<string, CallRecord>;
      setRecords((prev) => ({ ...prev, ...fetched }));
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Loads once for any member with history already, then on demand. There is no
  // push from the webhook to the browser, so a call still "initiated" will not
  // flip to "completed" on its own — the refresh button is the documented
  // trade-off, not an oversight.
  useEffect(() => {
    const withHistory = view.entries.filter((e) => e.dial_count > 0).map((e) => e.member_id);
    if (withHistory.length) refresh(withHistory);
  }, [view.entries, refresh]);

  async function placeCall(entry: QueueEntry) {
    setCallState((s) => ({ ...s, [entry.member_id]: { status: "calling" } }));
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // member_id and the operator's chosen gym, and nothing else: the route
        // resolves the member itself, so the auto-renew exclusion is a property
        // of the server rather than a convention of this screen.
        body: JSON.stringify({ member_id: entry.member_id, gym_id: gymId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCallState((s) => ({
          ...s,
          [entry.member_id]: {
            status: "refused",
            detail: body?.reason ?? body?.error ?? `HTTP ${res.status}`,
          },
        }));
        return;
      }
      setCallState((s) => ({ ...s, [entry.member_id]: { status: "placed" } }));
      setRecords((prev) => ({ ...prev }));
      setTimeout(() => refresh([entry.member_id]), 1500);
    } catch (err) {
      setCallState((s) => ({
        ...s,
        [entry.member_id]: { status: "refused", detail: String(err) },
      }));
    }
  }

  const placedEntries = view.entries.filter(
    (e) => records[e.member_id] || callState[e.member_id]?.status === "placed"
  );

  // Bucketed the same way as "Today's calls" so the section reads as one
  // system: most recent call first within each call type, capped so a gym with
  // a long call history doesn't turn this into an endless scroll.
  const placedByType = useMemo(() => {
    const out: Record<CallType, QueueEntry[]> = { renewal: [], reengagement: [], winback: [] };
    for (const entry of placedEntries) {
      const record = records[entry.member_id];
      const type = (record?.call_type ?? entry.call_type ?? "winback") as CallType;
      out[type].push(entry);
    }
    for (const type of CALL_TYPES) {
      out[type].sort((a, b) => {
        const ta = records[a.member_id]?.created_at;
        const tb = records[b.member_id]?.created_at;
        return (tb ? new Date(tb).getTime() : 0) - (ta ? new Date(ta).getTime() : 0);
      });
    }
    return out;
  }, [placedEntries, records]);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
            Today&apos;s calls
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {view.counts.due_total} of {view.counts.total} members are due a call.{" "}
            <span className="text-zinc-200">
              {view.counts.excluded_auto_renew} are on auto-renew and are never called
            </span>{" "}
            — {view.auto_renewers_inside_expiry_window} of those have a renewal date inside
            the next fortnight, and a date-triggered dialer would ring every one of them.
          </p>
        </div>
        <GymSwitcher
          gyms={view.gyms}
          value={gymId}
          onChange={setGymId}
          asOf={view.as_of}
        />
      </header>

      {view.history_error && (
        <p className="mt-6 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          Call history could not be read from Supabase, so attempt counts, cooldowns and
          do-not-contact are not being applied on this screen. Calls will still be refused
          server-side rather than placed blind. ({view.history_error})
        </p>
      )}

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {CALL_TYPES.map((type) => (
          <CallColumn
            key={type}
            type={type}
            entries={byType[type]}
            expanded={Boolean(expanded[type])}
            onToggle={() => setExpanded((s) => ({ ...s, [type]: !s[type] }))}
            callState={callState}
            onCall={placeCall}
          />
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-black uppercase tracking-tight">Not called, and why</h2>
        <p className="mt-1 text-sm text-zinc-500">
          The half of the product that has no equivalent in a churn score. Every member here
          has a reason attached to them, and it is the same reason the server gives back if
          someone posts to the call endpoint directly.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["auto_renew", "do_not_contact", "cooldown", "max_attempts", "not_due"].map((key) => (
            <ExcludedCard key={key} reason={key} entries={excluded[key] ?? []} />
          ))}
        </div>
      </section>

      <CancellationRequests entries={view.entries} />

      <section className="mt-10">
        <EconomicsPanel economics={view.economics} counts={view.counts} />
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-black uppercase tracking-tight">Calls placed</h2>
          <button
            type="button"
            onClick={() => refresh(recordIds)}
            disabled={refreshing || recordIds.length === 0}
            className="text-xs font-semibold text-zinc-500 transition hover:text-[#D6FF3D] disabled:opacity-40"
          >
            {refreshing ? "Refreshing…" : "Refresh transcripts"}
          </button>
        </div>
        {placedEntries.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 px-5 py-8 text-center text-sm text-zinc-600">
            No calls placed yet. Press “Call now” on a member above; the transcript and the
            extracted analysis land here when the call ends.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {CALL_TYPES.map((type) => (
              <PlacedColumn
                key={type}
                type={type}
                entries={placedByType[type]}
                records={records}
                callState={callState}
                expanded={Boolean(expandedPlaced[type])}
                onToggle={() => setExpandedPlaced((s) => ({ ...s, [type]: !s[type] }))}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-10 flex justify-center">
        <Link
          href="/members"
          className="rounded-lg border border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-400 transition hover:border-[#D6FF3D]/50 hover:text-[#D6FF3D]"
        >
          All {view.counts.total} members, with the routing decision for each
        </Link>
      </div>
    </main>
  );
}

function GymSwitcher({
  gyms,
  value,
  onChange,
  asOf,
}: {
  gyms: Array<{ gym_id: string; gym_name: string }>;
  value: string;
  onChange: (id: string) => void;
  asOf: string;
}) {
  return (
    <div className="flex-shrink-0 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Calling as
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {gyms.map((gym) => (
          <button
            key={gym.gym_id}
            type="button"
            onClick={() => onChange(gym.gym_id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              gym.gym_id === value
                ? "border-transparent bg-[#D6FF3D] text-black"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {gym.gym_name}
          </button>
        ))}
      </div>
      <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-zinc-600">
        Same three prompts either way. The gym decides what the agent is allowed to put on
        the table, and it arrives as a variable.
      </p>
      <p className="mt-2 text-xs text-zinc-700">Member data as of {asOf}</p>
    </div>
  );
}

function CallColumn({
  type,
  entries,
  expanded,
  onToggle,
  callState,
  onCall,
}: {
  type: CallType;
  entries: QueueEntry[];
  expanded: boolean;
  onToggle: () => void;
  callState: Record<string, CallState>;
  onCall: (entry: QueueEntry) => void;
}) {
  const shown = expanded ? entries : entries.slice(0, PER_COLUMN);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${callTypeStyle[type]}`}
          >
            {callTypeLabel[type]}
          </span>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{callTypeBlurb[type]}</p>
        </div>
        <span className="text-2xl font-black tabular-nums text-white">{entries.length}</span>
      </div>

      <div className="mt-4 space-y-2.5">
        {shown.map((entry) => (
          <MemberRow
            key={entry.member_id}
            entry={entry}
            state={callState[entry.member_id]}
            onCall={onCall}
          />
        ))}
        {entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
            Nobody due for this call today.
          </p>
        )}
      </div>

      {entries.length > PER_COLUMN && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-3 w-full rounded-lg border border-zinc-800 py-1.5 text-xs font-semibold text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          {expanded ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}

function PlacedColumn({
  type,
  entries,
  records,
  callState,
  expanded,
  onToggle,
}: {
  type: CallType;
  entries: QueueEntry[];
  records: Record<string, CallRecord>;
  callState: Record<string, CallState>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shown = expanded ? entries : entries.slice(0, PER_PLACED_COLUMN);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${callTypeStyle[type]}`}
        >
          {callTypeLabel[type]}
        </span>
        <span className="text-2xl font-black tabular-nums text-white">{entries.length}</span>
      </div>

      <div className="mt-4 space-y-4">
        {shown.map((entry) => (
          <CallCard
            key={entry.member_id}
            entry={entry}
            record={records[entry.member_id] ?? null}
            state={callState[entry.member_id]}
          />
        ))}
        {entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
            No {callTypeLabel[type].toLowerCase()} calls placed yet.
          </p>
        )}
      </div>

      {entries.length > PER_PLACED_COLUMN && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-3 w-full rounded-lg border border-zinc-800 py-1.5 text-xs font-semibold text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          {expanded ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}

function MemberRow({
  entry,
  state,
  onCall,
}: {
  entry: QueueEntry;
  state?: CallState;
  onCall: (entry: QueueEntry) => void;
}) {
  const status = state?.status ?? "idle";

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-black p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar id={entry.member_id} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{entry.name}</p>
            <p className="text-[11px] text-zinc-600">
              {cohortLabel[entry.cohort]} · {entry.contract_type} · ${entry.monthly_fee}/mo
              {entry.attempt_number > 1 && ` · attempt ${entry.attempt_number}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCall(entry)}
          disabled={status === "calling" || status === "placed"}
          className="flex-shrink-0 rounded-md bg-[#D6FF3D] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-black transition hover:bg-[#c2eb2b] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "calling" ? "Dialling…" : status === "placed" ? "Placed" : "Call now"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{entry.trigger}</p>
      {status === "refused" && (
        <p className="mt-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-300">
          Server refused the call: {state?.detail}
        </p>
      )}
    </div>
  );
}

function ExcludedCard({ reason, entries }: { reason: string; entries: QueueEntry[] }) {
  const example = entries[0];
  const isHardRule = reason === "auto_renew" || reason === "do_not_contact";

  return (
    <div
      className={`rounded-2xl border p-4 ${
        isHardRule ? "border-zinc-700 bg-zinc-900/40" : "border-zinc-800/70 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-zinc-200">
          {blockedLabel[reason] ?? reason}
        </p>
        <span className="text-xl font-black tabular-nums text-white">{entries.length}</span>
      </div>
      {example ? (
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{example.blocked_reason}</p>
      ) : (
        <p className="mt-2 text-xs italic text-zinc-600">Nobody in this bucket today.</p>
      )}
      {isHardRule && (
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-[#D6FF3D]/70">
          Enforced server-side
        </p>
      )}
    </div>
  );
}

function CallCard({
  entry,
  record,
  state,
}: {
  entry: QueueEntry;
  record: CallRecord | null;
  state?: CallState;
}) {
  const status = record?.status ?? (state?.status === "placed" ? "initiated" : "not_started");

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">{entry.name}</p>
          <p className="text-xs text-zinc-600">
            {record?.call_type ? callTypeLabel[record.call_type] : callTypeLabel[entry.call_type ?? "winback"]}
            {record?.attempt_number ? ` · attempt ${record.attempt_number}` : ""}
            {record?.gym_id ? ` · ${record.gym_id}` : ""}
          </p>
        </div>
        {record?.outcome ? (
          <span
            className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${outcomeClass(record.outcome)}`}
          >
            {outcomeText(record.outcome)}
          </span>
        ) : (
          <span className="flex-shrink-0 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
            {status === "initiated" ? "In progress" : status === "failed" ? "Did not connect" : "Not called"}
          </span>
        )}
      </div>

      {record?.reason_for_absence && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-black p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Why they stopped
          </p>
          <p className="mt-1 text-sm text-zinc-200">{record.reason_for_absence}</p>
          {record.reason_detail && (
            <p className="mt-1 text-sm italic text-zinc-400">“{record.reason_detail}”</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {record?.committed_day && (
          <Chip tone="good">Coming in {record.committed_day}</Chip>
        )}
        {record?.link_sent && <Chip>Link texted</Chip>}
        {record?.offer_made && (
          <Chip tone={record.offer_accepted ? "good" : "plain"}>
            Offer {record.offer_accepted ? "accepted" : "declined"}
          </Chip>
        )}
        {record?.do_not_contact && <Chip tone="warn">Do not contact</Chip>}
        {record?.human_followup && <Chip tone="warn">Needs a person</Chip>}
        {record?.sentiment && <Chip>{record.sentiment}</Chip>}
      </div>

      {status === "initiated" && !record?.transcript && (
        <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
          <PulsingDot /> Call in progress — the transcript lands here when it ends.
        </p>
      )}

      {record?.transcript && (
        <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black p-3 text-xs leading-relaxed text-zinc-300">
          {record.transcript}
        </div>
      )}

      {record?.created_at && (
        <p className="mt-2 text-[11px] text-zinc-700">
          {new Date(record.created_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function Chip({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "good" | "warn";
}) {
  const styles = {
    plain: "border-zinc-700 bg-zinc-900 text-zinc-400",
    good: "border-transparent bg-[#D6FF3D] text-black font-semibold",
    warn: "border-amber-700 bg-amber-950/40 text-amber-300",
  }[tone];
  return <span className={`rounded-full border px-2 py-0.5 ${styles}`}>{children}</span>;
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D6FF3D] opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D6FF3D]" />
    </span>
  );
}
