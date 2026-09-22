/**
 * SOT: scan-page, qr-bootstrap, guest-ticket-mint, q-route
 * WHAT   What happens when somebody points a camera at a table.
 * WHY    This is the one request in the product with no identity behind it, so it cannot go
 *        through the block the ordinary way - there is nothing yet to identify. It resolves
 *        the public token server-side, writes what it found into a signed ticket, and from
 *        the next request onward the person holding it is an ordinary guest principal that
 *        passes all ten gates like anybody else.
 * HOW    A route handler rather than a page, because the whole job is to mint a cookie and
 *        redirect, and Next refuses `cookies().set()` from a Server Component - the page
 *        this replaces threw "Cookies can only be modified in a Server Action or Route
 *        Handler" on every scan, which closed the only entrance to the guest surface. The
 *        ticket is HttpOnly, so no script can read it, and SameSite=Lax, so it is not
 *        replayable from another site. The organisation inside it came from the server.
 * WHERE  apps/web/src/gateway/public-call.ts, packages/contracts/src/ticket.ts,
 *        apps/web/src/app/q/failed
 */
import { env } from "@foodos/env";
import { type NextRequest, NextResponse } from "next/server";

import { GUEST_COOKIE, GUEST_TICKET_TTL_MS } from "@/gateway/guest-session";
import { resolveScan } from "@/gateway/public-call";

/** The bus speaks TCP, which the edge runtime cannot. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  let session: Awaited<ReturnType<typeof resolveScan>>;
  try {
    session = await resolveScan(token);
  } catch {
    /**
     * Every failure looks the same on purpose: a revoked code and a typo are both "ask us".
     *
     * A rate-limited scan is caught by this same `catch` and lands on the same notice, and
     * that is the point rather than a convenience. `resolveScan` throws RATE_LIMITED with
     * no retry hint, so a throttled guess is not a third outcome an attacker can tell apart
     * from a wrong one - see `refusal()` in gateway/public-call.ts. Nothing may be added
     * here that branches on the error: the moment this reads a code, the screen starts
     * answering questions it is here to refuse.
     */
    return NextResponse.redirect(new URL("/q/failed", request.url));
  }

  /**
   * A feedback code goes straight to the review form; everything else opens the menu. The
   * code decides, not the URL, so the same short link can mean different things per table.
   */
  const destination = session.context.qrType === "feedback" ? "/t/review" : "/t";
  const response = NextResponse.redirect(new URL(destination, request.url));

  /**
   * The ticket is already signed by the qr service, which is the only place the organisation
   * was ever in the clear. This route just puts it somewhere the browser will send it back.
   */
  response.cookies.set(GUEST_COOKIE, session.ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction(),
    path: "/",
    maxAge: Math.floor(GUEST_TICKET_TTL_MS / 1000),
  });
  return response;
}
