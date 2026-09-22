/**
 * SOT: insights-contract, analytics-contract, platform-admin-contract, event-contract
 * WHAT   Input and output schemas for the product's own event stream, the reporting surface,
 *        and the console whoever runs the SaaS uses.
 * WHY    Every read here is tenant-scoped. This product is in-house only - there is no public
 *        marketplace, no discovery surface and no cross-tenant search - so the platform
 *        console is the single place that looks across organisations, and it is gated on the
 *        deployment naming its own organisation rather than on any customer's role.
 * HOW    An event carries its own idempotency key, because the transport is at-least-once and
 *        a funnel that double-counts is a funnel nobody trusts.
 * WHERE  packages/contracts/src/contracts.ts, services/insights
 */
import { isPlanKey, type PlanKey } from "@foodos/registry";
import { z } from "zod";

import { wireDate } from "../wire";

const paise = z.number().int();
const nonNegativePaise = paise.min(0);

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── Events ──────────────────────────────────────────────────────────────── */

/** Closed on purpose. An event name nobody declared is a funnel step nobody can chart. */
export const ANALYTICS_EVENTS = [
  "app_opened",
  "location_selected",
  "restaurant_viewed",
  "menu_viewed",
  "dish_viewed",
  "qr_scanned",
  "cart_created",
  "item_added",
  "checkout_started",
  "payment_started",
  "payment_completed",
  "order_created",
  "order_cancelled",
  "order_completed",
  "restaurant_favorited",
  "review_created",
  "coupon_applied",
  "request_card_viewed",
  "request_submitted",
  "request_acknowledged",
  "request_completed",
  "request_cancelled",
  "request_sla_breached",
] as const;

export const analyticsEventDto = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.enum(ANALYTICS_EVENTS),
  anonymousId: z.string().nullable(),
  sessionId: z.string().nullable(),
  restaurantId: z.string().nullable(),
  branchId: z.string().nullable(),
  occurredAt: wireDate,
  metadata: z.record(z.string(), z.unknown()),
});

export const analyticsEventContract = {
  /**
   * Durable and at-least-once, so `eventId` is not decoration: the consumer dedupes on it,
   * and a browser that retries after a flaky connection adds nothing the second time.
   */
  create: {
    input: z.object({
      eventId: z.string().min(8).max(64),
      name: z.enum(ANALYTICS_EVENTS),
      anonymousId: z.string().max(64).optional(),
      sessionId: z.string().max(64).optional(),
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      occurredAt: wireDate.optional(),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    output: z.object({ accepted: z.literal(true), requestId: z.string() }),
  },
  read: {
    input: z.object({
      ...cursorPage,
      name: z.enum(ANALYTICS_EVENTS).optional(),
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      from: wireDate.optional(),
      to: wireDate.optional(),
    }),
    output: pageOf(analyticsEventDto),
  },
} as const;

/* ── Analytics ───────────────────────────────────────────────────────────── */

const reportRange = {
  branchId: z.string().optional(),
  from: wireDate,
  to: wireDate,
  granularity: z.enum(["hour", "day", "week", "month"]).default("day"),
};

const seriesPoint = z.object({ at: wireDate, value: z.number() });

/**
 * Six reports, six shapes. Collapsing them into one loose record would mean every chart in
 * the product parsing a bag of numbers and hoping the right keys are in it.
 */
export const analyticsContract = {
  read: {
    input: z.discriminatedUnion("report", [
      z.object({ report: z.literal("sales"), ...reportRange }),
      z.object({ report: z.literal("orders"), ...reportRange }),
      z.object({ report: z.literal("customers"), ...reportRange }),
      z.object({
        report: z.literal("menu"),
        ...reportRange,
        limit: z.number().int().min(1).max(50).default(10),
      }),
      z.object({ report: z.literal("qr"), ...reportRange }),
      z.object({ report: z.literal("requests"), ...reportRange }),
    ]),
    output: z.discriminatedUnion("report", [
      z.object({
        report: z.literal("sales"),
        grossPaise: nonNegativePaise,
        netPaise: nonNegativePaise,
        discountsPaise: nonNegativePaise,
        taxPaise: nonNegativePaise,
        refundsPaise: nonNegativePaise,
        series: z.array(seriesPoint),
      }),
      z.object({
        report: z.literal("orders"),
        total: z.number().int(),
        completed: z.number().int(),
        cancelled: z.number().int(),
        averageOrderPaise: nonNegativePaise,
        byType: z.array(z.object({ orderType: z.string(), count: z.number().int() })),
        series: z.array(seriesPoint),
      }),
      z.object({
        report: z.literal("customers"),
        newCustomers: z.number().int(),
        returningCustomers: z.number().int(),
        repeatRate: z.number(),
        retentionRate: z.number(),
        bySegment: z.array(z.object({ segment: z.string(), count: z.number().int() })),
        series: z.array(seriesPoint),
      }),
      z.object({
        report: z.literal("menu"),
        best: z.array(
          z.object({
            itemId: z.string(),
            name: z.string(),
            quantity: z.number().int(),
            revenuePaise: nonNegativePaise,
          }),
        ),
        worst: z.array(
          z.object({
            itemId: z.string(),
            name: z.string(),
            quantity: z.number().int(),
            revenuePaise: nonNegativePaise,
          }),
        ),
        byCategory: z.array(
          z.object({
            categoryId: z.string(),
            name: z.string(),
            revenuePaise: nonNegativePaise,
          }),
        ),
      }),
      z.object({
        report: z.literal("qr"),
        scans: z.number().int(),
        uniqueVisitors: z.number().int(),
        repeatVisitors: z.number().int(),
        orders: z.number().int(),
        conversionRate: z.number(),
        revenuePaise: nonNegativePaise,
        averageOrderPaise: nonNegativePaise,
        byCode: z.array(
          z.object({
            qrCodeId: z.string(),
            label: z.string(),
            scans: z.number().int(),
            orders: z.number().int(),
            revenuePaise: nonNegativePaise,
          }),
        ),
        series: z.array(seriesPoint),
      }),
      z.object({
        report: z.literal("requests"),
        total: z.number().int(),
        completed: z.number().int(),
        medianAcknowledgeSeconds: z.number().nullable(),
        medianResolutionSeconds: z.number().nullable(),
        slaCompliance: z.number(),
        byType: z.array(
          z.object({ requestTypeId: z.string(), name: z.string(), count: z.number().int() }),
        ),
        series: z.array(seriesPoint),
      }),
    ]),
  },
  /** Exporting a year of orders is not a request-path job, so it is a command. */
  manage: {
    input: z.object({
      report: z.enum(["sales", "orders", "customers", "menu", "qr", "requests"]),
      branchId: z.string().optional(),
      from: wireDate,
      to: wireDate,
      format: z.enum(["csv", "json"]).default("csv"),
    }),
    output: z.object({ accepted: z.literal(true), requestId: z.string() }),
  },
} as const;

/* ── Platform administration ─────────────────────────────────────────────── */

/**
 * How the operator wants the cross-tenant list ordered. Server-side, because the cursor
 * below is a keyset over exactly this ordering - sorting a page after it has been cut is
 * sorting the wrong rows.
 */
export const PLATFORM_SORTS = ["orders", "revenue", "recent", "name"] as const;

/**
 * One organisation's restaurant, as the platform sees it.
 *
 * The nullable half is the honest half. Insights owns orders, not names: it learns who an
 * organisation is and what its restaurants are called from the event stream, by asking the
 * owning service on that organisation's behalf when a fact arrives. A restaurant whose
 * order facts predate that projection has an id and nothing else, and says so with null
 * rather than echoing the id back dressed as a name.
 */
export const platformRestaurantDto = z.object({
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  restaurantId: z.string(),
  restaurantName: z.string().nullable(),
  /** From the signed envelope of the organisation's own events, never from a billing read. */
  plan: z.custom<PlanKey>(isPlanKey).nullable(),
  /** The catalogue's own answer to "is this restaurant serving", as of the last projection. */
  isLive: z.boolean().nullable(),
  branchCount: z.number().int().nullable(),
  /** When the restaurant was created, from the catalogue. Not when insights first saw it. */
  openedAt: wireDate.nullable(),
  orders: z.number().int(),
  gmvPaise: nonNegativePaise,
  lastOrderAt: wireDate,
});

/**
 * The one place an organisation id legitimately appears in a contract, and only on the way
 * OUT: this console exists to look across tenants, so naming which tenant a row belongs to
 * is the whole answer rather than a scope somebody supplied. Nothing here accepts one as
 * input - which organisation the caller may act on is decided in the service against the
 * platform organisation named by the environment.
 *
 * Two views, not four. `subscriptions` and `moderation` were arms that could only ever
 * answer empty: subscriptions belong to the billing service and moderation reports to crm,
 * and a downstream call from insights carries insights' inbound organisation - the
 * platform's own - so neither can be read for a tenant from here. An arm that structurally
 * cannot be filled is worse than an absent one, because a console builds a section around
 * it. See services/insights/src/insights.handlers.ts for what each would need.
 */
export const platformAdminContract = {
  read: {
    input: z.discriminatedUnion("view", [
      /**
       * `from`/`to` are required rather than a window the service picks, so the date range
       * on the console moves this list and the totals beside it together. `search`, `plan`
       * and `sort` are applied in SQL before the page is cut; `cursor` is a keyset over the
       * chosen ordering, opaque to the caller and only ever handed back as it was given.
       */
      z.object({
        view: z.literal("restaurants"),
        ...cursorPage,
        from: wireDate,
        to: wireDate,
        search: z.string().max(120).optional(),
        plan: z.custom<PlanKey>(isPlanKey).optional(),
        sort: z.enum(PLATFORM_SORTS).default("orders"),
      }),
      z.object({ view: z.literal("totals"), from: wireDate, to: wireDate }),
    ]),
    output: z.discriminatedUnion("view", [
      z.object({
        view: z.literal("restaurants"),
        items: z.array(platformRestaurantDto),
        nextCursor: z.string().nullable(),
      }),
      /**
       * Every number here is counted from this service's own order facts over the window
       * the caller asked for, which is why none of them is named for "today" any more and
       * why recurring revenue is not among them. `customers` is distinct diners who ordered
       * - a fact an order carries - not crm's roll of everyone it knows.
       */
      z.object({
        view: z.literal("totals"),
        organizations: z.number().int(),
        restaurants: z.number().int(),
        customers: z.number().int(),
        orders: z.number().int(),
        gmvPaise: nonNegativePaise,
      }),
    ]),
  },
  /**
   * Two actions, both keyed on a restaurant rather than on a tenant: an organisation id
   * accepted as input is the one thing no contract in this codebase may ask for, and a
   * cross-tenant console does not get an exemption - it gets an indirection through an
   * entity the platform actually lists.
   *
   * Neither is served yet, and the service refuses both rather than answering ok. The
   * refusal is the honest state of the platform: acting on another tenant's restaurant
   * needs a way for a downstream envelope to name an organisation other than the caller's,
   * and `serviceCall` pins that to the inbound context on purpose. `resolve_moderation`
   * and `publish_request_template` were removed outright - there is no moderation store to
   * resolve against and no template resource in the registry to publish into.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("suspend_restaurant"),
        restaurantId: z.string(),
        reason: z.string().min(3).max(300),
      }),
      z.object({ action: z.literal("restore_restaurant"), restaurantId: z.string() }),
    ]),
    output: z.object({ ok: z.literal(true) }),
  },
} as const;
