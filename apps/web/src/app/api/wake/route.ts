/**
 * SOT: wake-services, cold-start, idle-host, free-tier-wake
 * WHAT   Pokes the services host so a sleeping deployment starts waking the moment a page
 *        notices nobody answered.
 * WHY    On a host that idles after a quiet spell, the services are asleep until an HTTP
 *        request reaches them, and the bus cannot send one. The first page after a pause
 *        therefore fails, and nothing was going to fix that on its own. The error page calls
 *        this, then retries while the host comes up.
 * HOW    `after` keeps the function alive for the outbound request without making the caller
 *        wait the minute a cold start can take. With no SERVICES_URL configured it does
 *        nothing, which is the right answer on a laptop or a host that never sleeps.
 * WHERE  apps/web/src/app/(dashboard)/error.tsx
 */
import { env } from "@foodos/env";
import { after, NextResponse } from "next/server";

export function POST() {
  const url = env.servicesUrl();
  if (url === null) return NextResponse.json({ woken: false }, { status: 204 });

  after(async () => {
    try {
      await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(90_000) });
    } catch {
      // The retry on the page is what reports failure; this only starts the wake.
    }
  });
  return NextResponse.json({ woken: true }, { status: 202 });
}
