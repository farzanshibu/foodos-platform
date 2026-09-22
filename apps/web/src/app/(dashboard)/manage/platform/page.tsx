/**
 * SOT: platform-console-page, platform-admin-route, unlisted-route, platform-refusal-route
 * WHAT   The route for the cross-tenant operator console, and the one decision it makes:
 *        render the console, or say plainly that this deployment is not yours.
 * WHY    NOT IN THE NAVIGATION, ON PURPOSE. `platformAdmin` declares `nav: null` in the
 *        registry and must keep it. The registry derives nav per ROLE, and this resource's
 *        `minRole: "owner"` means owner of SOME organisation - every customer has one - so a
 *        nav entry would put a "Platform" link in every restaurant owner's sidebar leading
 *        straight to a refusal. The real gate is in services/insights: `assertPlatform`
 *        compares the caller's organisation with `env.platformOrgId()`, which no role can
 *        express and no nav derivation can see. So the page is reachable by URL and advertised
 *        to nobody. Written down because a deliberate gap and an oversight are
 *        indistinguishable otherwise.
 * WHY    Not covered by the route guard in (dashboard)/layout.tsx either, and it does not need
 *        to be: `resourceForPath` maps a path to a resource through NAV_ITEMS, a resource with
 *        no nav entry has no path to match, and this page makes a real API call - so the block
 *        answers for it the same way it answers for every other page.
 * HOW    The probe asks for totals over a zero-width window: `assertPlatform` runs before any
 *        query does, and a window with no width matches no order, so proving authority is one
 *        round trip and one aggregate that returns zeros. It used to ask the moderation arm,
 *        which answered a constant - that arm is gone, because an arm that could only ever
 *        answer empty is an arm a console builds a section around. It runs on the server so
 *        that somebody who is not the operator gets a rendered answer rather than a console
 *        that paints and then collapses.
 * HOW    Only PERMISSION_DENIED becomes the closed screen. Anything else - a service that did
 *        not answer, a deadline - is rethrown to (dashboard)/error.tsx, which exists to say
 *        exactly that. Dressing an outage as "this is not for you" would send the operator
 *        looking in the wrong place.
 * WHERE  apps/web/src/features/manage/platform-console.tsx,
 *        apps/web/src/features/manage/platform-closed.tsx,
 *        services/insights/src/insights.handlers.ts
 */
import { PlatformClosed } from "@/features/manage/platform-closed";
import { PlatformConsole } from "@/features/manage/platform-console";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

/**
 * The refusal as it arrives at a SERVER caller. `createCallerFactory` does not run the
 * errorFormatter, so there is no `error.data.app` to read here the way a browser reads one -
 * what survives is the TRPCError's `cause`, which `gatewayQuery` set to the gateway's own
 * `GatewayFailure`. Only its `code` is inspected; the message is deliberately not shown,
 * because the wording of a permission refusal is written for a log, not for a person.
 */
function refused(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("cause" in error)) return false;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return false;
  return cause.code === "PERMISSION_DENIED";
}

async function operatorMayLook(): Promise<boolean> {
  const now = new Date();
  try {
    await api.platformAdmin.view({ view: "totals", from: now, to: now });
    return true;
  } catch (error) {
    if (refused(error)) return false;
    throw error;
  }
}

export default async function ManagePlatformPage() {
  const open = await operatorMayLook();
  return open ? <PlatformConsole /> : <PlatformClosed />;
}
