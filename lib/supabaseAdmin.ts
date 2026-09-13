/**
 * Owns: the lazily built, server-only service-role Supabase client every lib/ store uses.
 * Not here: table reads and writes live in the stores, e.g. lib/callRecords.ts, lib/gymStore.ts,
 * lib/memberStore.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only client (service-role key) — never import this from a "use client"
 * component or expose it to the browser.
 *
 * Built on first use rather than at module load. `next build` collects page data
 * for every route, which imports this module, so a top-level throw turned a
 * missing environment variable into a failed deploy instead of a failed request.
 * A deploy that boots and reports "Supabase is not configured" on the one route
 * that needs it is far easier to diagnose than a build log.
 */
let client: SupabaseClient | null = null;

function build(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    client ??= build();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
