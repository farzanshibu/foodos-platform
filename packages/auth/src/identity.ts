/**
 * SOT: identity, identity-adapter, normalize-identity, gateway-identify
 * WHAT   Turns a Better Auth session into the flat shape the gateway block needs.
 * WHY    Normalised identity: `GatewayDeps.identify` is the only signature the block knows.
 *        Moving to Clerk or WorkOS means rewriting this function and nothing else - no
 *        service, no router, no component mentions a provider.
 * HOW    The cookie names belong to that promise too, so they are re-exported here rather
 *        than spelled out at the one place that needs them before a session exists. They
 *        are declared in session-cookie.ts, a leaf with no database import, so the proxy can
 *        read them without pulling this module's Postgres pool into the edge bundle.
 * WHERE  apps/web/src/gateway/deps.ts
 */
import "server-only";

import type { GatewayIdentity } from "@foodos/core";
import { and, eq } from "@foodos/db";
import { normalizeRole, normalizeStations } from "@foodos/registry";

import { auth, authDb } from "./auth";
import { member } from "./schema";

export { SESSION_COOKIE_NAMES, SESSION_COOKIE_PREFIX } from "./session-cookie";

export async function identify(headers: Headers): Promise<GatewayIdentity | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  const orgId = session.session.activeOrganizationId ?? null;
  if (!orgId) return null;

  const [row] = await authDb
    .select({ role: member.role, stations: member.stations })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId)))
    .limit(1);

  // Membership is verified against the row, not taken from the session claim alone.
  if (!row) return null;

  /**
   * Rank and roster, both off the membership row and neither off the session. A station
   * claim the browser could set would not be a gate, and the session cookie is the browser's.
   */
  return {
    userId: session.user.id,
    orgId,
    role: normalizeRole(row.role),
    stations: normalizeStations(row.stations),
  };
}
