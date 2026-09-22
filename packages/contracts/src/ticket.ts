/**
 * SOT: guest-ticket, qr-session-cookie, guest-identity, ticket-signing
 * WHAT   The server-minted, signed value that stands in for a session when the person
 *        holding it has no account: somebody who scanned a QR code at a table.
 * WHY    The gateway needs an org id before it can do anything, and a guest has no
 *        membership row to read one from. Resolving the QR token on every request would put
 *        a network hop in front of every guest read; trusting an org id the browser sends
 *        would be the cross-tenant leak this codebase refuses to write. A ticket is the
 *        third option: the server resolved the token once, wrote down what it found, and
 *        signed it, so reading it back is a MAC check rather than a lookup or an act of faith.
 * HOW    HMAC over the same canonical JSON the envelope uses, so a ticket and an envelope
 *        cannot disagree about what "the same bytes" means. The MAC is domain-separated from
 *        request, event and reply MACs, so a ticket can never be replayed as any of them.
 *        Revocation is still real: the qr service validates the session row on every guest
 *        operation it serves, and a ticket only shortcuts the identity lookup.
 * WHERE  apps/web/src/gateway/guest-session.ts, services/qr
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "./envelope";

/** What the server learned when it resolved the QR token, and nothing the browser chose. */
export type GuestTicket = {
  readonly sessionId: string;
  readonly orgId: string;
  readonly restaurantId: string;
  readonly branchId: string | null;
  readonly placeId: string | null;
  readonly qrCodeId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

/** Its own domain, so a ticket MAC is not a request MAC with a different shape. */
const TICKET_DOMAIN = "foodos.ticket.v1";

function mac(ticket: GuestTicket, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${TICKET_DOMAIN}\n${canonicalJson(ticket)}`)
    .digest("base64url");
}

function matches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signTicket(ticket: GuestTicket, secret: string): string {
  const body = Buffer.from(canonicalJson(ticket), "utf8").toString("base64url");
  return `${body}.${mac(ticket, secret)}`;
}

/**
 * Returns null for anything that is not a ticket this secret minted, or one that has since
 * expired. Every failure is the same null: a caller that could tell "forged" from "stale"
 * would be a caller somebody probes.
 */
export function readTicket(value: string, secret: string, now = Date.now()): GuestTicket | null {
  const split = value.lastIndexOf(".");
  if (split <= 0) return null;
  const body = value.slice(0, split);
  const signature = value.slice(split + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isTicket(parsed)) return null;

  let expected: string;
  try {
    expected = mac(parsed, secret);
  } catch {
    return null;
  }
  if (!matches(expected, signature)) return null;
  if (parsed.expiresAt <= now) return null;
  return parsed;
}

function isTicket(value: unknown): value is GuestTicket {
  if (value === null || typeof value !== "object") return false;
  const row: Record<string, unknown> = { ...value };
  const text = (key: string): boolean => typeof row[key] === "string";
  const nullableText = (key: string): boolean => row[key] === null || typeof row[key] === "string";
  const number = (key: string): boolean => typeof row[key] === "number";
  return (
    text("sessionId") &&
    text("orgId") &&
    text("restaurantId") &&
    nullableText("branchId") &&
    nullableText("placeId") &&
    text("qrCodeId") &&
    number("issuedAt") &&
    number("expiresAt")
  );
}
