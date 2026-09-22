/**
 * SOT: guest-session, qr-cookie, guest-identify, guest-gateway-identity
 * WHAT   Turns the signed QR ticket in a cookie into the identity the block expects.
 * WHY    QR ordering is guest-first - no app, no account - but the block starts with an
 *        identity and an org id, and neither may come from the browser. The scan page
 *        resolves the public token server-side and mints a ticket; this reads it back.
 * HOW    `role: "guest"` is the lowest rank in the registry, so a guest passes exactly the
 *        operations declared with a guest minRole and no others - the permission set is
 *        derived, not enumerated here. The org id is the one the server wrote into the
 *        ticket, never a field the caller sent.
 * WHERE  packages/contracts/src/ticket.ts, apps/web/src/gateway/deps.ts, services/qr
 */
import "server-only";

import { type GuestTicket, readTicket } from "@foodos/contracts";
import type { GatewayIdentity } from "@foodos/core";
import { env } from "@foodos/env";

/** Named once. The scan page sets it and the gateway reads it; nothing else touches it. */
export const GUEST_COOKIE = "foodos_qr";

/** A table turns over. Long enough for a meal, short enough that a stale phone is not a key. */
export const GUEST_TICKET_TTL_MS = 6 * 60 * 60 * 1000;

function cookieValue(headers: Headers, name: string): string | null {
  const header = headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function readGuestTicket(headers: Headers): GuestTicket | null {
  const raw = cookieValue(headers, GUEST_COOKIE);
  if (raw === null) return null;
  return readTicket(raw, env.envelopeSecret());
}

/**
 * The guest half of `identify`. `userId` is the QR session id: it is what the qr service
 * validates against a live session row on every guest operation, so revoking a QR code or
 * ending a session still takes effect even though the ticket itself is self-verifying.
 */
export function identifyGuest(headers: Headers): GatewayIdentity | null {
  const ticket = readGuestTicket(headers);
  if (ticket === null) return null;
  /**
   * No stations, and there is nothing to read one from: a station is a post on a seat, and a
   * guest holds no seat. `guest` is below the rank stations gate, so an empty set costs a
   * diner nothing - every operation they may call declares no station in the first place.
   */
  return { userId: ticket.sessionId, orgId: ticket.orgId, role: "guest", stations: [] };
}
