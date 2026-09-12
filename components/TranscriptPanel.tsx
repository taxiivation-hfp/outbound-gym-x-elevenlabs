import type { CallRecord, CallOutcome, Member } from "@/lib/types";

interface TranscriptPanelProps {
  member: Member;
  callRecord?: CallRecord | null;
}

const outcomeLabel: Record<NonNullable<CallOutcome>, string> = {
  rebooked: "Rebooked",
  callback: "Callback requested",
  not_interested: "Not interested",
};

const outcomeStyle: Record<NonNullable<CallOutcome>, string> = {
  rebooked: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  callback: "border-amber-800 bg-amber-950/40 text-amber-300",
  not_interested: "border-slate-700 bg-slate-900/60 text-slate-400",
};

export default function TranscriptPanel({ member, callRecord }: TranscriptPanelProps) {
  const status = callRecord?.status ?? "not_started";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-100">{member.name}</p>
          <p className="text-xs text-slate-500">{member.phone}</p>
        </div>
        <StatusBadge status={status} outcome={callRecord?.outcome ?? null} />
      </div>

      <div className="mt-3">
        {status === "not_started" && (
          <p className="text-sm italic text-slate-600">
            No call placed yet. Use "Call now" above to start.
          </p>
        )}

        {status === "initiated" && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <PulsingDot />
            Call in progress — transcript will appear here when it ends.
          </div>
        )}

        {status === "failed" && (
          <p className="text-sm text-red-400">
            Call did not connect. Check the number and try again, or place it
            from the ElevenLabs dashboard directly.
          </p>
        )}

        {status === "completed" && (
          <div className="space-y-2">
            {callRecord?.transcript ? (
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-900 p-3 text-sm leading-relaxed text-slate-300">
                {callRecord.transcript}
              </div>
            ) : (
              <p className="text-sm italic text-slate-600">
                Call completed, but no transcript came back yet.
              </p>
            )}
          </div>
        )}
      </div>

      {callRecord?.created_at && (
        <p className="mt-2 text-xs text-slate-600">
          {new Date(callRecord.created_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  outcome,
}: {
  status: CallRecord["status"] | "not_started";
  outcome: CallOutcome;
}) {
  if (status === "completed" && outcome) {
    return (
      <span
        className={`rounded border px-2 py-0.5 text-xs ${outcomeStyle[outcome]}`}
      >
        {outcomeLabel[outcome]}
      </span>
    );
  }

  const fallback: Record<string, string> = {
    not_started: "Not called",
    initiated: "Calling…",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-400">
      {fallback[status]}
    </span>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
    </span>
  );
}
