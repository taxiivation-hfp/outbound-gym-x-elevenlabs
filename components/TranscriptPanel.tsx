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

// Lime accent for outcomes — failed calls stay red, that's a danger
// signal, not a style choice.
const outcomeStyle: Record<NonNullable<CallOutcome>, string> = {
  rebooked: "border-transparent bg-[#D6FF3D] text-black",
  callback: "border-cyan-700 bg-cyan-950/40 text-cyan-300",
  not_interested: "border-zinc-700 bg-zinc-900 text-zinc-400",
};

export default function TranscriptPanel({ member, callRecord }: TranscriptPanelProps) {
  const status = callRecord?.status ?? "not_started";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-white">{member.name}</p>
          <p className="text-xs text-zinc-500">{member.phone}</p>
        </div>
        <StatusBadge status={status} outcome={callRecord?.outcome ?? null} />
      </div>

      <div className="mt-3">
        {status === "not_started" && (
          <p className="text-sm italic text-zinc-600">
            No call placed yet. Use "Call now" above to start.
          </p>
        )}

        {status === "initiated" && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
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
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-black p-3 text-sm leading-relaxed text-zinc-300">
                {callRecord.transcript}
              </div>
            ) : (
              <p className="text-sm italic text-zinc-600">
                Call completed, but no transcript came back yet.
              </p>
            )}
          </div>
        )}
      </div>

      {callRecord?.created_at && (
        <p className="mt-2 text-xs text-zinc-600">
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
        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${outcomeStyle[outcome]}`}
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
    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
      {fallback[status]}
    </span>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D6FF3D] opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D6FF3D]" />
    </span>
  );
}
