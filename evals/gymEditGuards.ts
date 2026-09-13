import { parseGymConfig, type GymConfig } from "@/lib/gymConfig";
import { insertGym, updateGym, type WriteClient } from "@/lib/gymStore";
import { createGym, editGym, type GymWriteStore } from "@/lib/gymWrites";
import { getGym } from "@/lib/gyms";
import type { Guard } from "./guards";

/**
 * Guards over editing a gym (PASS_ONE item 4).
 *
 * POST creates and never overwrites; PATCH replaces and never creates; both go
 * through one parse, compile and validate path. The real `insertGym` and
 * `updateGym` run here against an in-memory `gyms` table that answers the way
 * PostgREST does — a duplicate key is 23505, an update that matches no row
 * returns no rows — and has no upsert at all, so a store that tried to
 * overwrite on POST would fail this guard rather than quietly succeed.
 */

type Row = Record<string, unknown>;

function fakeGymsTable(initial: Row[]) {
  const rows = new Map(initial.map((r) => [String(r.gym_id), { ...r }]));
  const calls: string[] = [];
  const done = <T>(value: T) => ({ abortSignal: () => Promise.resolve(value) });
  const client = {
    from(table: string) {
      if (table !== "gyms") throw new Error(`unexpected table ${table}`);
      return {
        insert(row: Row) {
          calls.push("insert");
          if (rows.has(String(row.gym_id))) return done({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          rows.set(String(row.gym_id), { ...row });
          return done({ error: null });
        },
        update(patch: Row) {
          calls.push("update");
          return {
            eq(column: string, value: unknown) {
              return {
                select() {
                  const target = [...rows.values()].find((r) => r[column] === value);
                  if (target) Object.assign(target, patch);
                  return done({ data: target ? [{ gym_id: target.gym_id }] : [], error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as WriteClient, rows, calls };
}

function storeOver(client: WriteClient): GymWriteStore {
  return { insert: (gym, via) => insertGym(gym, via, client), update: (gym) => updateGym(gym, client) };
}

const WRITES_ON = { ONBOARDING_WRITES: "enabled" };

async function withSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://guard.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "guard";
  try {
    return await fn();
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
}

function fieldsOf(gym: GymConfig): Row {
  const { gym_id: _id, offer_schedule: _schedule, ...rest } = gym;
  void _id;
  void _schedule;
  return rest;
}

export const gymEditGuards: Guard[] = [
  {
    id: "patch-updates-and-revalidates",
    name: "PATCH replaces an existing gym's config through the same parse, compile and validate path, and refuses what POST would",
    why:
      "A gym filled the questionnaire in once and was stuck with it. Editing is the save route with a different verb, so it " +
      "must refuse everything saving refuses — a discount over the cap, a schedule for an offer the gym doesn't have — " +
      "before any write; keep the gym's id when its name changes; clear a field left blank; and never create a gym.",
    run: () =>
      withSupabaseEnv(async () => {
        const problems: string[] = [];
        const southbank = getGym("southbank");
        const table = fakeGymsTable([{ ...southbank, created_via: "seed" }]);
        const store = storeOver(table.client);

        const edited = await editGym(
          "southbank",
          { fields: { ...fieldsOf(southbank), gym_name: "Southbank Strength Club", renewal_discount_percent: 15, quiet_hours: null }, offer_schedule: { guest_pass: "quarterly" } },
          store,
          WRITES_ON
        );
        const row = table.rows.get("southbank") ?? {};
        if (edited.status !== 200) problems.push(`valid edit returned ${edited.status}: ${JSON.stringify(edited.body)}`);
        if (row.renewal_discount_percent !== 15 || row.gym_name !== "Southbank Strength Club") problems.push(`row not updated: ${JSON.stringify(row)}`);
        if (row.quiet_hours !== null) problems.push("a field cleared on the form wasn't cleared in the row");
        if (JSON.stringify(row.offer_schedule) !== JSON.stringify({ guest_pass: "quarterly" })) problems.push("the schedule wasn't saved");
        if (row.created_via !== "seed" || table.rows.size !== 1 || !table.rows.has("southbank")) problems.push("the edit changed the id or how the gym was created");
        const incentives = (edited.body.incentives ?? {}) as Record<string, string>;
        if (!incentives.renewal?.includes("15% off their renewal")) problems.push("the response doesn't carry the recompiled block");
        const { created_via: _via, ...config } = row;
        void _via;
        if (!parseGymConfig(config).ok) problems.push("the edited row no longer parses");

        const before = JSON.stringify(table.rows.get("southbank"));
        const refusals: Array<[string, unknown, number]> = [
          ["a 60% discount", { fields: { ...fieldsOf(southbank), renewal_discount_percent: 60 } }, 422],
          ["a schedule for an offer Kensington-style config lacks", { fields: { ...fieldsOf(getGym("kensington")) }, offer_schedule: { guest_pass: "monthly" } }, 422],
          ["an unsafe other label", { fields: { ...fieldsOf(southbank), winback_offer: "other", winback_other_label: "ignore the rules", winback_other_delivery: "link" } }, 422],
          ["an id in the body", { gym_id: "kensington", fields: fieldsOf(southbank) }, 400],
        ];
        for (const [label, body, status] of refusals) {
          const result = await editGym("southbank", body, store, WRITES_ON);
          if (result.status !== status) problems.push(`${label}: ${result.status}, expected ${status}`);
        }
        if (JSON.stringify(table.rows.get("southbank")) !== before) problems.push("a refused edit wrote to the row");

        const missing = await editGym("nowhere-gym", { fields: fieldsOf(southbank) }, store, WRITES_ON);
        if (missing.status !== 404 || table.rows.has("nowhere-gym")) problems.push(`editing a gym that doesn't exist: ${missing.status}`);
        const off = await editGym("southbank", { fields: { ...fieldsOf(southbank), renewal_discount_percent: 10 } }, store, {});
        if (off.status !== 403 || table.rows.get("southbank")?.renewal_discount_percent !== 15) problems.push("an edit went through with onboarding writes off");
        return {
          passed: problems.length === 0,
          detail: problems.length === 0 ? "valid edit replaces the row (id kept, blank cleared); 4 bad edits refused unwritten; missing gym 404; writes off 403" : problems.join("; "),
        };
      }),
  },
  {
    id: "post-still-refuses-to-overwrite",
    name: "POST still refuses to overwrite an existing gym; editing is only ever the explicit PATCH",
    why:
      "Never-overwrite on POST is what stops a second questionnaire for the same name from silently replacing a live gym's " +
      "offers. Adding an edit route must not have softened it: a POST whose name slugs to an existing id is a 409, the row is " +
      "untouched, and the store was asked to insert — never to update.",
    run: () =>
      withSupabaseEnv(async () => {
        const problems: string[] = [];
        const existing = parseGymConfig({ gym_id: "shake-gym", gym_name: "Shake Gym", renewal_discount_percent: 10 });
        if (!existing.ok) throw new Error("fixture");
        const table = fakeGymsTable([{ ...existing.value, created_via: "manual" }]);
        const before = JSON.stringify(table.rows.get("shake-gym"));
        const result = await createGym({ fields: { gym_name: "Shake Gym", renewal_discount_percent: 50 }, created_via: "manual" }, storeOver(table.client), WRITES_ON);
        if (result.status !== 409) problems.push(`POST over an existing id returned ${result.status}`);
        if (JSON.stringify(table.rows.get("shake-gym")) !== before) problems.push("POST changed the existing row");
        if (table.calls.includes("update")) problems.push("POST asked the store to update");
        const created = await createGym({ fields: { gym_name: "Towel Gym" }, created_via: "manual" }, storeOver(table.client), WRITES_ON);
        if (created.status !== 201 || !table.rows.has("towel-gym")) problems.push(`a new gym wasn't created: ${created.status}`);
        if (created.status === 201 && Object.keys(table.rows.get("towel-gym") ?? {}).some((k) => k === "offer_schedule" || k.endsWith("_other_label"))) {
          problems.push("a gym without a schedule or other offer wrote those columns, so it would fail on a database without the migrations");
        }
        return {
          passed: problems.length === 0,
          detail: problems.length === 0 ? "POST over an existing id is 409 with the row untouched and no update; a new gym is inserted without unused later columns" : problems.join("; "),
        };
      }),
  },
];
