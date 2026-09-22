/**
 * SOT: public-routes, public-prefixes, guest-surface-paths
 * WHAT   Which paths reach the app without a STAFF session cookie, and the boundary-safe
 *        match that decides it.
 * WHY    Separated from `proxy.ts` so it can be asserted directly. The proxy imports
 *        `next/server`, which a plain `tsx` assertion run cannot load; this file imports
 *        nothing, so the one rule worth pinning - that `/t` never swallows `/team` - is
 *        pinned by a test rather than by care.
 * HOW    Being on this list is NOT permission. Every path here is still answered by the
 *        block: the gateway's ten gates for anything that reaches the bus, and the page's
 *        own guard for anything that does not. This only decides who gets to knock.
 * WHERE  apps/web/src/proxy.ts, tests/public-routes.test.ts
 */

/**
 * This list is the difference between a product and a locked door. It was once three entries
 * long, which silently killed four separate surfaces:
 *
 *   - `/q` and `/t` are the guest surface. A diner scans a code and has no account by
 *     design - that is the entire product. Bouncing them to a staff sign-in page made QR
 *     ordering unreachable.
 *   - `/api/trpc` carries the guest's own calls. A guest holds the QR ticket cookie, never
 *     a session cookie, so a presence check that only knows about session cookies refused
 *     every basket, order and request a diner ever made.
 *   - `/api/stream` carries the live nudge to a phone holding a shared basket. Same cookie
 *     situation as `/api/trpc`, and the route itself proves the caller may watch that basket
 *     by doing the read through the block before it subscribes to anything.
 *   - `/api/webhooks` is called by a payment provider, which holds no cookie at all. A 307
 *     to `/sign-in` is not a failure a provider understands: it follows the redirect, gets
 *     HTML, retries, and no payment is ever settled.
 *   - the account routes are how somebody gets a session in the first place. Guarding
 *     `/sign-up` behind "do you have a session" means nobody can ever create one.
 *
 * `/c` is deliberately absent: the hosted card page reads a card design, which is org-scoped
 * staff data, so the redirect is the correct answer there. `/onboarding` is absent for the
 * same reason - you have just signed up, so you have a session.
 */
export const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/api/auth",
  "/api/trpc",
  "/api/webhooks",
  "/api/stream",
  "/q",
  "/t",
] as const;

/**
 * Prefix match on a path SEGMENT boundary. `startsWith` alone would make `/t` swallow
 * `/team`, handing the staff roster to anyone with no session at all.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
