import { NextRequest, NextResponse } from "next/server";
import { firstName } from "@/lib/compileVariables";
import { resolveDialTarget } from "@/lib/dialSafety";
import { gymOfRecentCall } from "@/lib/callRecords";
import { resolveGym } from "@/lib/gymStore";
import type { CallType } from "@/lib/callType";
import { gymForMember, loadMember, type MemberSource } from "@/lib/memberSource";
import { textedOffer, type TextedOffer } from "@/lib/textedOffer";
import type { Member } from "@/lib/types";

/**
 * The endpoint behind the agent's `send_text` tool.
 *
 * The agent never builds a URL and never handles a coupon code. It says which
 * kind of link the member agreed to; this route looks the member up, builds the
 * link with any coupon already embedded, and sends the SMS. That division is what
 * makes "never read a code out loud" enforceable: there is no code in the
 * agent's context to read.
 *
 * Voice already goes through Twilio via ElevenLabs, so the text does too — but
 * through Twilio's REST API directly, with its own credentials, because
 * ElevenLabs' integration only covers the call leg.
 */

type LinkType = "renewal" | "incentive" | "booking";

const LINK_TYPES = new Set<LinkType>(["renewal", "incentive", "booking"]);

/**
 * Coupon codes are deterministic per member and link type so a member who loses
 * the text and rings back gets the same code, and so the code in a transcript
 * can be matched to the call that sent it. Not a security token — the link is
 * the token — just a stable reference the front desk can read back.
 */
function couponCode(memberId: string, linkType: LinkType, offer: TextedOffer | null): string {
  const prefix =
    linkType === "incentive" ? (offer?.kind === "renewal_discount" ? "SAVE" : "GUEST") : { renewal: "RENEW", booking: "BOOK" }[linkType];
  return `${prefix}-${memberId.replace(/^M/, "")}`;
}

function buildLink(baseUrl: string, member: Member, gymId: string, linkType: LinkType, offer: TextedOffer | null): string {
  const path = { renewal: "renew", incentive: "offer", booking: "book" }[linkType];
  const url = new URL(`/${path}`, baseUrl);
  url.searchParams.set("m", member.member_id);
  url.searchParams.set("gym", gymId);
  url.searchParams.set("code", couponCode(member.member_id, linkType, offer));
  if (offer) url.searchParams.set("offer", offer.kind);
  return url.toString();
}

function buildMessage(member: Member, gymName: string, linkType: LinkType, offer: TextedOffer | null, link: string): string {
  const name = firstName(member.name);
  if (linkType === "incentive") {
    return offer?.kind === "renewal_discount"
      ? `Hi ${name}, Charlie from ${gymName} — here's your ${offer.percent}% off your renewal: ${link}`
      : `Hi ${name}, Charlie from ${gymName} — here's your guest pass, bring a mate in: ${link}`;
  }
  return {
    renewal: `Hi ${name}, Charlie from ${gymName} here — here's the link to sort your renewal: ${link}`,
    booking: `Hi ${name}, Charlie from ${gymName} — book your session here: ${link}`,
  }[linkType];
}

async function sendSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;

  if (!accountSid || !authToken || !from) {
    return {
      sent: false as const,
      detail:
        "Twilio SMS is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM).",
    };
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    }
  );

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      sent: false as const,
      detail: payload?.message ?? `Twilio returned ${res.status}`,
    };
  }
  return { sent: true as const, sid: payload?.sid as string | undefined };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const memberId = body?.member_id;
  const linkType = body?.link_type;

  if (typeof memberId !== "string" || typeof linkType !== "string") {
    return NextResponse.json(
      { error: "member_id and link_type are required" },
      { status: 400 }
    );
  }
  if (!LINK_TYPES.has(linkType as LinkType)) {
    return NextResponse.json(
      { error: `link_type must be one of: ${[...LINK_TYPES].join(", ")}` },
      { status: 400 }
    );
  }

  let member: Member | null = null;
  let source: MemberSource | null = null;
  try {
    const loaded = await loadMember(memberId);
    member = loaded.member;
    source = loaded.source;
  } catch (err) {
    console.error("send_text refused: member data unreadable", err);
  }
  if (!member || !source || !member.phone.trim()) {
    // The agent is mid-call. Tell it something it can say out loud rather than
    // an error it will try to read: a tool failure should degrade into "someone
    // will follow up", never into dead air.
    return NextResponse.json(
      {
        success: false,
        message: "I couldn't send that text just now — someone from the gym will follow up.",
      },
      { status: 200 }
    );
  }

  // Which gym's name and link this text carries. The agent's tool sends only
  // `member_id` and `link_type`, so the gym comes from the call it is making:
  // `/api/call` records the gym on the call record before the phone rings.
  // With no such record the text is refused rather than sent under the default
  // gym's name — a text branded as the wrong gym is a text that shouldn't go.
  // An incentive text also needs the call type, which only the call record has,
  // because what "incentive" means depends on the call the agent is on.
  let gymId: string | null = typeof body?.gym_id === "string" && body.gym_id.trim() ? body.gym_id : null;
  let callType: CallType | null = null;
  let offersAvailable: string[] | null = null;
  if (!gymId || linkType === "incentive") {
    const recent = await gymOfRecentCall(memberId);
    if (!recent.ok) {
      console.error("send_text refused: no call record for this text", recent.error, { memberId, linkType });
      return NextResponse.json({
        success: false,
        message: "I couldn't send that text just now — someone from the gym will follow up.",
        detail: recent.error,
      });
    }
    gymId = gymId ?? recent.gymId;
    callType = recent.callType;
    offersAvailable = recent.offersAvailable;
  }

  // An uploaded member only ever hears from the gym they were uploaded for.
  const gymChoice = gymForMember(source, gymId);
  if (!gymChoice.ok) {
    console.error("send_text refused: gym mismatch", gymChoice.reason, { memberId, linkType });
    return NextResponse.json({
      success: false,
      message: "I couldn't send that text just now — someone from the gym will follow up.",
      detail: gymChoice.reason,
    });
  }

  const gymLookup = await resolveGym(gymId);
  if (!gymLookup.ok) {
    console.error("send_text refused: gym config", gymLookup.error, { memberId, linkType });
    return NextResponse.json({
      success: false,
      message: "I couldn't send that text just now — someone from the gym will follow up.",
      detail: gymLookup.error,
    });
  }
  const gym = gymLookup.gym;

  // The incentive is the one offer this gym's incentives block told the agent to
  // text on this call — or there is no incentive text to send.
  // An offer withheld from this call (a cooldown, the habit gate) was never in
  // the agent's block, and isn't texted either: the call record lists what the
  // block granted.
  const texted = linkType === "incentive" ? textedOffer(gym, callType) : null;
  const offer = texted && (offersAvailable === null || offersAvailable.includes(texted.kind)) ? texted : null;
  if (linkType === "incentive" && !offer) {
    const detail = texted
      ? `The ${texted.kind.replace(/_/g, " ")} was withheld from this call, so it isn't texted.`
      : callType
      ? `${gym.gym_name}'s ${callType} incentives don't include anything texted as a link.`
      : "The call record doesn't say which kind of call this is, so there's no way to tell what the incentive is.";
    console.error("send_text refused: no texted incentive", detail, { memberId, linkType });
    return NextResponse.json({
      success: false,
      message: "I couldn't send that text just now — someone from the gym will follow up.",
      detail,
    });
  }

  const baseUrl =
    process.env.PUBLIC_BASE_URL?.trim() ||
    req.nextUrl.origin;
  const link = buildLink(baseUrl, member, gym.gym_id, linkType as LinkType, offer);
  const message = buildMessage(member, gym.gym_name, linkType as LinkType, offer, link);

  // Same guard as the call route, same reason: these numbers belong to
  // strangers. A refusal here degrades into something the agent can say rather
  // than an error it might read out.
  const dial = resolveDialTarget(member.phone, source);
  if (!dial.allowed || !dial.to) {
    console.error("send_text refused:", dial.reason, { memberId, linkType });
    return NextResponse.json({
      success: false,
      message: "I couldn't send that text just now — someone from the gym will follow up.",
      detail: dial.reason,
    });
  }

  const result = await sendSms(dial.to, message);

  if (!result.sent) {
    console.error("send_text failed:", result.detail, { memberId, linkType });
    return NextResponse.json(
      {
        success: false,
        message: "I couldn't send that text just now — someone from the gym will follow up.",
        detail: result.detail,
      },
      { status: 200 }
    );
  }

  console.log("send_text sent", {
    memberId,
    linkType,
    to: dial.overridden ? "override" : "member",
    sid: result.sid,
  });

  // The agent reads this back to the member, so it is written as a sentence
  // rather than a status code.
  return NextResponse.json({
    success: true,
    message: "Sent — it should be on their phone now.",
    link_type: linkType,
    message_sid: result.sid,
  });
}
