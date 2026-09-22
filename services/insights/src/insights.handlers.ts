/**
 * SOT: insights-handlers, analytics-handler, platform-admin-handler, platform-action-boundary
 * WHAT   Business rules for the event stream, the reports and the platform console.
 * WHY    One of these is unusual and it is documented where it happens: the platform console
 *        is the only surface in the product whose authority comes from an environment
 *        variable rather than a role, and the only one that reads across organisations.
 * WHY    It reads across organisations and it does NOT write across them. `refuseAction` at
 *        the bottom of this file is where that stops, and why - a decision somebody has to
 *        take about packages/core, not a gap to be filled in here.
 * WHERE  services/insights/src/insights.service.ts, services/insights/src/reports.ts,
 *        services/insights/src/platform-page.ts
 */
import "server-only";

import { ANALYTICS_EVENTS, type InputOf, ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";
import { env } from "@foodos/env";
import { isPlanKey, type PlanKey } from "@foodos/registry";

import { eventService, factService } from "./insights.service";
import { decodeCursor } from "./platform-page";
import { buildReport } from "./reports";
import type { AnalyticsEventRow } from "./schema";

type PlatformReadInput = InputOf<"platformAdmin", "read">;
type PlatformManageInput = InputOf<"platformAdmin", "manage">;

type EventName = (typeof ANALYTICS_EVENTS)[number];

/** The column is plain text; the contract's union is what the browser trusts, so narrow here. */
const asEventName = (value: string): EventName =>
  ANALYTICS_EVENTS.find((candidate) => candidate === value) ?? "app_opened";

/** `exactOptionalPropertyTypes`: absent and present-but-undefined are different states. */
const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const toEventDto = (row: AnalyticsEventRow) => ({
  id: row.id,
  eventId: row.eventId,
  name: asEventName(row.name),
  anonymousId: row.anonymousId,
  sessionId: row.sessionId,
  restaurantId: row.restaurantId,
  branchId: row.branchId,
  occurredAt: row.occurredAt,
  /** JSONB is unknown until it is read back as entries; never asserted into a shape. */
  metadata: readMetadata(row.metadata),
});

function readMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

export const analyticsEventHandlers = [
  /**
   * A command, at least once, so `eventId` is the whole design: the insert ignores conflicts
   * and a browser retrying after a flaky connection adds nothing the second time.
   */
  handlerFor("analyticsEvent", "create", async ({ ctx, input }) => {
    await eventService.record({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      eventId: input.eventId,
      name: input.name,
      anonymousId: input.anonymousId ?? null,
      sessionId: input.sessionId ?? null,
      restaurantId: input.restaurantId ?? null,
      branchId: input.branchId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: input.metadata,
    });
    return { accepted: true as const, requestId: ctx.requestId };
  }),

  handlerFor("analyticsEvent", "read", async ({ ctx, input }) => {
    const page = await eventService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.name, "name"),
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.branchId, "branchId"),
      ...set(input.from, "from"),
      ...set(input.to, "to"),
    });
    return {
      items: page.items.map(toEventDto),
      nextCursor: page.nextCursor,
    };
  }),
];

export const analyticsHandlers = [
  handlerFor("analytics", "read", ({ ctx, input }) =>
    buildReport({ organizationId: ctx.orgId, input }),
  ),

  /**
   * A command: a year of orders is not a request-path job. The acceptance is the answer; the
   * file lands on the export the caller collects afterwards.
   */
  handlerFor("analytics", "manage", ({ ctx }) =>
    Promise.resolve({ accepted: true as const, requestId: ctx.requestId }),
  ),
];

/**
 * The platform console's authority does not come from a role - `owner` here means owner of
 * ONE organisation, and every customer has one of those. It comes from being the organisation
 * the deployment named as its own. Checked here, in the service, because the gateway has no
 * way to express "this org and no other" and because a cross-tenant read should have exactly
 * one place it can be turned on.
 */
function assertPlatform(organizationId: string): void {
  const platform = env.platformOrgId();
  if (platform === null || platform !== organizationId) {
    throw new ServiceError("PERMISSION_DENIED", "This console is not available here.");
  }
}

/** The column is plain text; the plan union is what the browser trusts, so narrow here. */
const asPlanKey = (value: string | null): PlanKey | null =>
  value !== null && isPlanKey(value) ? value : null;

export const platformAdminHandlers = [
  handlerFor("platformAdmin", "read", ({ ctx, input }) => {
    assertPlatform(ctx.orgId);
    return readPlatform(input);
  }),

  handlerFor("platformAdmin", "manage", ({ ctx, input }) => {
    assertPlatform(ctx.orgId);
    return refuseAction(input);
  }),
];

async function readPlatform(input: PlatformReadInput) {
  if (input.view === "totals") {
    const [totals] = await factService.platformTotals({ from: input.from, to: input.to });
    return {
      view: "totals" as const,
      organizations: totals?.organizations ?? 0,
      restaurants: totals?.restaurants ?? 0,
      customers: totals?.customers ?? 0,
      orders: totals?.orders ?? 0,
      /** bigint leaves Postgres as a string, because 2^53 is not a promise money can keep. */
      gmvPaise: Number(totals?.gmv ?? 0),
    };
  }

  /**
   * A blank search box is not a filter for the empty string. Trimming here rather than in the
   * schema keeps the contract describing the wire and the service describing the intent.
   */
  const typed = input.search?.trim();
  const search = typed === undefined || typed === "" ? undefined : typed;

  /**
   * An unreadable cursor is refused rather than ignored. Serving page one instead would look
   * to the caller exactly like a list that has stopped advancing, and the caller would be
   * right to believe the rows it had already seen were the only rows there are.
   */
  const carried = input.cursor ?? null;
  const cursor = carried === null ? undefined : (decodeCursor(carried, input.sort) ?? undefined);
  if (carried !== null && cursor === undefined) {
    throw new ServiceError(
      "INVALID_INPUT",
      "That page cursor was not cut for this ordering. Ask for the first page again.",
    );
  }

  const page = await factService.platformOrganizations({
    from: input.from,
    to: input.to,
    limit: input.limit,
    sort: input.sort,
    ...set(search, "search"),
    ...set(input.plan, "plan"),
    ...set(cursor, "cursor"),
  });

  return {
    view: "restaurants" as const,
    items: page.items.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      restaurantId: row.restaurantId,
      restaurantName: row.restaurantName,
      plan: asPlanKey(row.plan),
      isLive: row.isLive,
      branchCount: row.branchCount,
      openedAt: row.openedAt,
      orders: row.orders,
      gmvPaise: Number(row.gmv),
      /** Rendered fixed-width by the query so its text order is its time order. */
      lastOrderAt: new Date(row.lastOrderAt),
    })),
    nextCursor: page.nextCursor,
  };
}

/**
 * Every action this console offers is refused, and the refusal is the point.
 *
 * It used to answer `{ ok: true }` to four actions without touching anything. That is worse
 * than an error: `platformAdmin.manage` is audited, so the operator got a success, a log line
 * and a restaurant that carried on serving - and the audit row does not even record which
 * restaurant or why, because services/audit stores the envelope's meta and not its payload.
 * Two of the four are gone from the contract entirely: `resolve_moderation` had no moderation
 * store to resolve against, and `publish_request_template` had no template resource in the
 * registry to publish into. Those are absent rather than refused, because they were not
 * blocked features - they were names for features that do not exist.
 *
 * The wall is the same one for both, and it is deliberate. Suspending a restaurant is already
 * modelled by the catalogue - restaurant.manage, take_offline and go_live - and insights
 * cannot reach it for a tenant, because `serviceCall` copies the CALLING organisation into
 * the downstream envelope and the caller here is the platform's own organisation. Naming
 * another organisation from a service is exactly the escalation that primitive exists to
 * refuse, and no sanctioned way to do it exists today.
 *
 * What it would take, precisely, is one of:
 *   - an explicit platform-scoped call in packages/core/src/service-call.ts that may
 *     name another organisation, gated on the same environment variable assertPlatform reads
 *     and audited as its own act; or
 *   - a suspension the whole platform honours: a column in identity's organisation table and
 *     a numbered gate in packages/core/src/gateway.ts that refuses a suspended tenant.
 * Both files belong to somebody else. Until one of them exists, refusing is the only answer
 * this service can give that is true.
 */
function refuseAction(input: PlatformManageInput): never {
  const verb = input.action === "suspend_restaurant" ? "Suspending" : "Restoring";
  throw new ServiceError(
    "PERMISSION_DENIED",
    `${verb} another organisation's restaurant is not something this deployment can do yet. A call from one service to another carries the calling organisation, so the platform console can read across tenants but not write across them. See services/insights/src/insights.handlers.ts.`,
  );
}
