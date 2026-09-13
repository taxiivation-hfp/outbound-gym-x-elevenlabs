import { NextRequest, NextResponse } from "next/server";
import { compileGymFacts } from "@/lib/compileVariables";
import { parseGymFields, slugifyGymName } from "@/lib/gymConfig";
import { insertGym, listGyms, type CreatedVia } from "@/lib/gymStore";
import { CALL_TYPES, compileIncentives } from "@/lib/incentives";
import { validateIncentives } from "@/lib/validateIncentives";

/**
 * GET: the gyms the dashboard can switch between — each one's typed config, and
 * the incentive text that config compiles to for each call type. Shown in full
 * rather than as a name and an id: what the gym is allowed to put on the table is
 * the most consequential thing in this config, and an operator should be able to
 * read the exact words before switching.
 *
 * POST: save a gym from the onboarding review screen. The only way a config is
 * saved, whether it was typed by hand or prefilled from a document — so every
 * value a document supplied has been in front of a person first. The fields are
 * parsed again here, as untrusted input, and the three incentives blocks are
 * compiled and validated before anything is written.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const listing = await listGyms();
  return NextResponse.json({
    default_gym_id: listing.default_gym_id,
    source: listing.source,
    notice: listing.notice,
    invalid: listing.invalid,
    gyms: listing.gyms.map((gym) => ({
      ...gym,
      incentives: Object.fromEntries(CALL_TYPES.map((t) => [t, compileIncentives(gym, t).text])),
    })),
  });
}

const CREATED_VIA = new Set<CreatedVia>(["manual", "document"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON body with the gym's fields." }, { status: 400 });
  }
  const createdVia = body.created_via;
  if (typeof createdVia !== "string" || !CREATED_VIA.has(createdVia as CreatedVia)) {
    return NextResponse.json({ error: 'created_via must be "manual" or "document".' }, { status: 400 });
  }

  const parsed = parseGymFields(body.fields);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Some answers need fixing before the gym can be saved.", errors: parsed.errors }, { status: 422 });
  }

  const fields = parsed.value;
  const gym = { gym_id: slugifyGymName(fields.gym_name), ...fields };

  const incentives = {} as Record<(typeof CALL_TYPES)[number], string>;
  for (const callType of CALL_TYPES) {
    const block = compileIncentives(gym, callType).text;
    const result = validateIncentives(block, gym, callType);
    if (!result.ok) {
      // Unreachable while the compiler and validator agree (a guard pins that
      // across the whole config space) — and refused if they ever don't.
      return NextResponse.json(
        { error: `The ${callType} incentives failed validation, so nothing was saved.`, violations: result.violations },
        { status: 422 }
      );
    }
    incentives[callType] = block;
  }

  const saved = await insertGym(gym, createdVia as CreatedVia);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: saved.status });
  }

  return NextResponse.json({ gym: saved.gym, incentives, facts: compileGymFacts(saved.gym) }, { status: 201 });
}
