import membersData from "@/data/members_scored.json";
import type { Member } from "@/lib/types";
import Dashboard from "@/components/Dashboard";
import { applyFallbackReasons } from "@/lib/reasoningFallback";

// Flip this to true if the LLM reasoning layer falls behind or breaks —
// every member's `reason` field gets regenerated from a template instead,
// grounded only in the signals already in the JSON. No other code changes.
const USE_FALLBACK_REASONING = false;

const rawMembers = membersData as Member[];
const members = USE_FALLBACK_REASONING
  ? applyFallbackReasons(rawMembers)
  : rawMembers;

export default function Home() {
  return <Dashboard members={members} />;
}
