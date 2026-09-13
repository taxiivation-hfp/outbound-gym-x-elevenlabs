"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Nothing on the overview updates by itself: there is no realtime
 * subscription. This re-renders the page on the server, which reads every
 * number again.
 */
export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      title="Read every number again"
      className="h-[34px] rounded-[10px] border border-line bg-control px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:border-accent-line disabled:opacity-50"
    >
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
