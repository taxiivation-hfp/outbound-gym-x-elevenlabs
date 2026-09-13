"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminDetail, Button, Card, CardHeader, Notice } from "./ui";

/**
 * The only way the demo's data is cleared: a button, then a second press to
 * confirm. Nothing on page load or refresh reaches `/api/demo/reset`, so an
 * accidental reload mid-demo wipes nothing.
 */

type State = { kind: "idle" } | { kind: "confirming" } | { kind: "resetting" } | { kind: "done" } | { kind: "error"; message: string };

export default function DemoReset({ available, adminDetail }: { available: boolean; adminDetail: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const reset = async () => {
    setState({ kind: "resetting" });
    try {
      const res = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "reset" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setState({ kind: "error", message: typeof body?.error === "string" ? body.error : `Nothing was reset (HTTP ${res.status}).` });
        return;
      }
      setState({ kind: "done" });
      // Re-read on the server: the gym list empties and the navigation goes
      // with it, back to a first run.
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Couldn't reach the server, so the reset may not have happened. Pressing it again is safe." });
    }
  };

  return (
    <Card labelledBy="reset-title">
      <CardHeader id="reset-title" title="Reset the demo" note="back to an empty first run" />
      <p className="mb-4 mt-2 max-w-[62ch] text-[13px] leading-[1.55] text-muted text-pretty">
        Deletes every saved gym (the two seed gyms included), every imported member, contract and check-in, every call record and every
        queue run. The committed evaluation runs are files in the repository, not rows, and are never touched.
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        {state.kind === "confirming" ? (
          <div role="group" aria-label="Reset the demo?" className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink-2">
            <span>This can&apos;t be undone.</span>
            <Button tone="caution" onClick={reset}>
              Delete everything
            </Button>
            <Button variant="quiet" onClick={() => setState({ kind: "idle" })}>
              Keep it
            </Button>
          </div>
        ) : (
          <Button
            tone="caution"
            disabled={!available || state.kind === "resetting"}
            onClick={() => setState({ kind: "confirming" })}
          >
            {state.kind === "resetting" ? "Resetting…" : "Reset demo data"}
          </Button>
        )}
      </div>

      <div aria-live="polite" className="mt-3 empty:hidden">
        {state.kind === "done" && (
          <p role="status" className="text-[12.5px] text-ink-2">
            <strong className="text-accent-ink">Reset.</strong> No gyms, no members, no calls. Start again from the top of this page.
          </p>
        )}
        {state.kind === "error" && (
          <Notice tone="fault" title="Not reset" role="alert">
            {state.message}
          </Notice>
        )}
        {!available && (
          <p className="text-[12.5px] text-ink-2">
            Resetting is switched off here.
            {adminDetail && <AdminDetail>{adminDetail}</AdminDetail>}
          </p>
        )}
      </div>
    </Card>
  );
}
