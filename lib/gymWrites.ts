/**
 * Owns: the save path for a new or edited gym: writes flag, parse, compile and validate each incentives block.
 * Not here: the database insert and update and their error mapping, which live in lib/gymStore.ts.
 */
import { compileGymFacts } from "@/lib/compileVariables";
import { parseGymFields, parseOfferSchedule, slugifyGymName, type GymConfig } from "@/lib/gymConfig";
import { insertGym, updateGym, type CreatedVia, type InsertResult, type UpdateResult } from "@/lib/gymStore";
import { CALL_TYPES, compileIncentives } from "@/lib/incentives";
import { ONBOARDING_WRITES_OFF, onboardingWritesEnabled } from "@/lib/onboardingWrites";
import { validateIncentives } from "@/lib/validateIncentives";

/**
 * Saving a gym, whether it's new (`POST /api/gyms`) or an edit
 * (`PATCH /api/gyms/[gymId]`).
 *
 * Both verbs take the same body — the typed fields and the offer schedule —
 * and go through one path: parse as untrusted input, compile all three
 * incentives blocks, validate each, and only then write. The difference is the
 * write: a new gym is inserted and never overwrites one that exists; an edit
 * replaces an existing gym's config and never creates one. Editing adds no
 * safety surface, because nothing about what may be saved depends on the verb.
 *
 * The store is passed in, so the guards can run both verbs against a store
 * that behaves like the database without a network.
 */

export interface GymWriteStore {
  insert: (gym: GymConfig, createdVia: CreatedVia) => Promise<InsertResult>;
  update: (gym: GymConfig) => Promise<UpdateResult>;
}

export const DATABASE_STORE: GymWriteStore = {
  insert: (gym, createdVia) => insertGym(gym, createdVia),
  update: (gym) => updateGym(gym),
};

export interface WriteResponse {
  status: number;
  body: Record<string, unknown>;
}

const CREATED_VIA = new Set<CreatedVia>(["manual", "document"]);

type Prepared = { ok: true; gym: GymConfig; incentives: Record<(typeof CALL_TYPES)[number], string> } | { ok: false; response: WriteResponse };

/** Parse, compile and validate. Shared by both verbs; writes nothing. */
function prepare(body: Record<string, unknown>, gymIdFor: (name: string) => string): Prepared {
  const parsed = parseGymFields(body.fields);
  if (!parsed.ok) {
    return { ok: false, response: { status: 422, body: { error: "Some answers need fixing before the gym can be saved.", errors: parsed.errors } } };
  }
  const fields = parsed.value;
  // How often each offer may be made. Parsed against these fields, so a
  // schedule can only name an offer this gym configures.
  const schedule = parseOfferSchedule(body.offer_schedule, fields);
  if (schedule.error) {
    return {
      ok: false,
      response: { status: 422, body: { error: "Some answers need fixing before the gym can be saved.", errors: { offer_schedule: schedule.error } } },
    };
  }
  const gym: GymConfig = { gym_id: gymIdFor(fields.gym_name), ...fields, ...(schedule.value ? { offer_schedule: schedule.value } : {}) };

  const incentives = {} as Record<(typeof CALL_TYPES)[number], string>;
  for (const callType of CALL_TYPES) {
    const block = compileIncentives(gym, callType).text;
    const result = validateIncentives(block, gym, callType);
    if (!result.ok) {
      // Unreachable while the compiler and validator agree (guards pin that
      // across the config space) — and refused if they ever don't.
      return {
        ok: false,
        response: { status: 422, body: { error: `The ${callType} incentives failed validation, so nothing was saved.`, violations: result.violations } },
      };
    }
    incentives[callType] = block;
  }
  return { ok: true, gym, incentives };
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export async function createGym(rawBody: unknown, store: GymWriteStore = DATABASE_STORE, env: Record<string, string | undefined> = process.env): Promise<WriteResponse> {
  if (!onboardingWritesEnabled(env)) return { status: 403, body: { error: ONBOARDING_WRITES_OFF } };
  const body = bodyObject(rawBody);
  if (!body) return { status: 400, body: { error: "Expected a JSON body with the gym's fields." } };
  const createdVia = body.created_via;
  if (typeof createdVia !== "string" || !CREATED_VIA.has(createdVia as CreatedVia)) {
    return { status: 400, body: { error: 'created_via must be "manual" or "document".' } };
  }

  const prepared = prepare(body, slugifyGymName);
  if (!prepared.ok) return prepared.response;

  const saved = await store.insert(prepared.gym, createdVia as CreatedVia);
  if (!saved.ok) return { status: saved.status, body: { error: saved.error } };
  return { status: 201, body: { gym: saved.gym, incentives: prepared.incentives, facts: compileGymFacts(saved.gym) } };
}

export async function editGym(gymId: string, rawBody: unknown, store: GymWriteStore = DATABASE_STORE, env: Record<string, string | undefined> = process.env): Promise<WriteResponse> {
  if (!onboardingWritesEnabled(env)) return { status: 403, body: { error: ONBOARDING_WRITES_OFF } };
  const body = bodyObject(rawBody);
  if (!body) return { status: 400, body: { error: "Expected a JSON body with the gym's fields." } };
  if ("gym_id" in body || "created_via" in body) {
    return { status: 400, body: { error: "A gym's id and how it was created can't be edited. Send its fields and offer schedule." } };
  }

  // The id is the URL's, whatever the name becomes: call records refer to it.
  const prepared = prepare(body, () => gymId);
  if (!prepared.ok) return prepared.response;

  const saved = await store.update(prepared.gym);
  if (!saved.ok) return { status: saved.status, body: { error: saved.error } };
  return { status: 200, body: { gym: saved.gym, incentives: prepared.incentives, facts: compileGymFacts(saved.gym) } };
}
