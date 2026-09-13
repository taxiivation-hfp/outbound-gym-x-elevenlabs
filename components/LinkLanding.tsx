import { firstName, formatLocations } from "@/lib/compileVariables";
import { resolveGym } from "@/lib/gymStore";
import { datasetMemberName } from "@/lib/memberSource";
import { landingOffer, type TextedOffer } from "@/lib/textedOffer";

/**
 * Where a texted link lands.
 *
 * The agent never builds these URLs — `/api/send-text` does, with the coupon
 * already embedded, which is what makes "never read a code out loud" a property
 * of the system rather than an instruction the agent might forget. This page is
 * the other end of that: opened on a phone, seconds after the call.
 *
 * It takes no payment and asks for no card. A voice agent that has just told
 * someone it is an AI has no business collecting payment details thirty seconds
 * later, and a gym's own system is where a renewal should actually be completed.
 * This confirms the offer, carries the code, and hands off to the front desk.
 */
export type LinkKind = "renewal" | "incentive" | "booking";

const COPY: Record<
  LinkKind,
  { eyebrow: string; heading: (gym: string) => string; body: string; action: string }
> = {
  renewal: {
    eyebrow: "Membership renewal",
    heading: (gym) => `Pick up where you left off at ${gym}`,
    body:
      "Your membership is set to lapse. Show this code at the front desk and the team will " +
      "put it back on, or mention it next time you are in — it does not expire.",
    action: "Show this at the front desk",
  },
  // An incentive link says what it is only when the gym's config grants that
  // offer; otherwise it carries the code and makes no claim (see incentiveCopy).
  incentive: {
    eyebrow: "From the gym",
    heading: (gym) => `A note from ${gym}`,
    body: "Show this code at the front desk and the team will look it up.",
    action: "Show this at the front desk",
  },
  booking: {
    eyebrow: "Session booking",
    heading: (gym) => `Your session at ${gym}`,
    body:
      "Someone from the gym will call to lock in a time that works. This code is your " +
      "reference if you would rather ring them first.",
    action: "Quote this when you call",
  },
};

function incentiveCopy(offer: TextedOffer | null) {
  if (offer?.kind === "guest_pass") {
    return {
      eyebrow: "Guest pass",
      heading: (gym: string) => `Bring someone with you to ${gym}`,
      body:
        "One guest pass, on the gym. Show this code at the desk when you come in together — " +
        "no booking needed, no time limit on when you use it.",
      action: "Show this at the front desk",
    };
  }
  if (offer?.kind === "renewal_discount") {
    return {
      eyebrow: "Renewal discount",
      heading: (gym: string) => `${offer.percent}% off renewing at ${gym}`,
      body: `Show this code at the front desk when you renew and the team will take ${offer.percent}% off your renewal.`,
      action: "Show this at the front desk",
    };
  }
  if (offer?.kind === "other") {
    return {
      eyebrow: "From the gym",
      heading: (gym: string) => `Something from ${gym}`,
      body: `Your ${offer.label}, on the gym. Show this code at the front desk and the team will sort it out.`,
      action: "Show this at the front desk",
    };
  }
  return COPY.incentive;
}

export default async function LinkLanding({
  kind,
  searchParams,
}: {
  kind: LinkKind;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const memberId = typeof params.m === "string" ? params.m : null;
  const code = typeof params.code === "string" ? params.code : null;
  const gymLookup = await resolveGym(typeof params.gym === "string" ? params.gym : null);
  // A link for a gym that can no longer be resolved still carries a valid code;
  // it just cannot name the gym or list its hours, and says nothing it can't
  // back up.
  const gym = gymLookup.ok ? gymLookup.gym : null;
  const gymName = gym?.gym_name ?? "the gym";
  // Anyone can open a link and change `?m=`, so a real member's name is never
  // put on this page: only a synthetic member is greeted by name. The code the
  // member was texted is what matters, and it is always shown.
  const memberName = memberId ? datasetMemberName(memberId) : null;
  const copy =
    kind === "incentive" ? incentiveCopy(landingOffer(gym, typeof params.offer === "string" ? params.offer : null)) : COPY[kind];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-6 py-12">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#D6FF3D]">
        {copy.eyebrow}
      </p>
      <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight">
        {memberName ? `${firstName(memberName)}, ` : ""}
        {copy.heading(gymName).toLowerCase()}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">{copy.body}</p>

      {code && (
        <div className="mt-8 rounded-2xl border border-[#D6FF3D]/30 bg-[#D6FF3D]/5 p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {copy.action}
          </p>
          <p className="mt-2 font-mono text-2xl font-black tracking-widest text-[#D6FF3D]">
            {code}
          </p>
        </div>
      )}

      {gym && (
        <dl className="mt-8 space-y-3 border-t border-zinc-900 pt-6 text-sm">
          <Row label="Gym" value={gym.gym_name} />
          {/* Blank config stays off the page rather than becoming a placeholder. */}
          {gym.opening_hours && <Row label="Open" value={gym.opening_hours} />}
          {gym.quiet_hours && <Row label="Quietest" value={gym.quiet_hours} />}
          {gym.other_locations && gym.other_locations.length > 0 && (
            <Row label="Also at" value={formatLocations(gym.other_locations)} />
          )}
        </dl>
      )}

      <p className="mt-10 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs leading-relaxed text-zinc-500">
        This is a demo build of a retention product. No payment is taken on this page and no
        card details are asked for — a renewal is completed by the gym&apos;s own system, at the
        desk.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-200">{value}</dd>
    </div>
  );
}
