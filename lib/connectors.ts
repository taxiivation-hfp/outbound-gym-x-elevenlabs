/**
 * The gym-management platforms, and what connecting each would take.
 *
 * None of these is built. They are listed so the question "how would this plug
 * into our system?" has an answer on screen that doesn't pretend: the three
 * tables this product needs, the fields each platform exposes them as, and the
 * one field that decides everything — whether a contract renews by itself. A
 * connector coded blind against documentation, then shown with a spinner and a
 * "Connected", would be a worse answer than this list. CSV export is the path
 * that works today, for every platform, with no credentials and no partnership.
 *
 * Field names are those documented in the README's deployment section.
 */

export interface ConnectorInfo {
  id: "glofox" | "mindbody" | "pushpress";
  name: string;
  status: "not_built";
  members: string;
  contracts: string;
  checkins: string;
  /** How the platform says whether a contract auto-renews. */
  autoRenew: { exposed: boolean; detail: string };
  /** What building the integration would need from the gym or the vendor. */
  needs: string;
}

export const CONNECTORS: ConnectorInfo[] = [
  {
    id: "mindbody",
    name: "Mindbody",
    status: "not_built",
    members: "Clients — ClientID, MobilePhone, CreationDate",
    contracts: "Contracts / ClientContracts — AutoPayEnabled",
    checkins: "Visits — ClientID, StartDateTime",
    autoRenew: {
      exposed: true,
      detail: "Exposed directly: AutoPayEnabled on each client contract.",
    },
    needs: "Developer credentials and an approved app from Mindbody, then the gym's permission for that app.",
  },
  {
    id: "glofox",
    name: "Glofox",
    status: "not_built",
    members: "Members export, or the members API",
    contracts: "Memberships",
    checkins: "Bookings and check-ins",
    autoRenew: {
      exposed: false,
      detail:
        "Not a field to read — it has to be inferred from the membership plan type. Getting that inference wrong is exactly the call this product exists never to make, so it would be the first thing verified with real data.",
    },
    needs: "API access, which varies with the gym's Glofox plan tier.",
  },
  {
    id: "pushpress",
    name: "PushPress",
    status: "not_built",
    members: "Members API",
    contracts: "Plans and subscriptions",
    checkins: "Check-ins",
    autoRenew: {
      exposed: false,
      detail:
        "Not a field to read — it has to be inferred from the plan or subscription type, with the same risk as Glofox: a rolling plan misread as fixed-term is a member the agent would call.",
    },
    needs: "API access, which varies with the gym's PushPress plan tier.",
  },
];
