/**
 * SOT: insights-schema, analytics-event-table, order-fact-table, service-fact-table,
 *      organization-dim-table, restaurant-dim-table
 * WHAT   Every table the insights service owns: the raw event stream, one fact row per order,
 *        the flattened reviews and service requests the reports are computed from, and the two
 *        dimension tables that give the platform console names instead of ids.
 * WHY    This service owns no restaurants and no orders - those belong to catalog and orders,
 *        and it may not read their tables. What it holds instead are read models it builds
 *        from the event stream, which is the only way a reporting surface can exist without
 *        a cross-service join.
 * NOTE   organization_id is a plain column, and every report query filters by it. The two
 *        exceptions are platformTotals and platformOrganizations in insights.service.ts,
 *        which aggregate ins_order_fact across all tenants and join the two dimension tables
 *        to it: they are the only cross-tenant reads left in the product, and the only caller
 *        that can reach them is the platform console, whose handler proves first
 *        (assertPlatform in insights.handlers.ts) that the caller is the organisation the
 *        deployment named as its own.
 * WHERE  services/insights/src/*.service.ts
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });

export const analyticsEvent = pgTable(
  "ins_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    /** The idempotency key. Unique, so a retried browser adds nothing the second time. */
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    anonymousId: text("anonymous_id"),
    sessionId: text("session_id"),
    restaurantId: text("restaurant_id"),
    branchId: text("branch_id"),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ins_event_id_idx").on(table.eventId),
    index("ins_event_org_idx").on(table.organizationId, table.name, table.occurredAt),
    index("ins_event_branch_idx").on(table.branchId, table.occurredAt),
  ],
);

/**
 * One row per order, recorded when the orders service says an order happened. Reports read
 * this rather than the orders service's own tables, which is what keeps the service boundary
 * a boundary and lets reporting be slow without making ordering slow.
 */
export const orderFact = pgTable(
  "ins_order_fact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    orderId: text("order_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    branchId: text("branch_id").notNull(),
    placeId: text("place_id"),
    customerId: text("customer_id"),
    orderType: text("order_type").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    subtotalPaise: money("subtotal_paise").default(0).notNull(),
    discountPaise: money("discount_paise").default(0).notNull(),
    taxPaise: money("tax_paise").default(0).notNull(),
    totalPaise: money("total_paise").default(0).notNull(),
    refundedPaise: money("refunded_paise").default(0).notNull(),
    /** [{ itemId, name, quantity, revenuePaise, categoryId }] - enough for the menu report. */
    lines: jsonb("lines").default([]).notNull(),
    placedAt: timestamp("placed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ins_fact_order_idx").on(table.orderId),
    index("ins_fact_org_idx").on(table.organizationId, table.placedAt),
    index("ins_fact_branch_idx").on(table.branchId, table.placedAt),
  ],
);

/** Reviews and requests, flattened the same way, so their reports need no cross-service read. */
export const serviceFact = pgTable(
  "ins_service_fact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    branchId: text("branch_id"),
    referenceId: text("reference_id"),
    label: text("label"),
    numericValue: numeric("numeric_value", { precision: 12, scale: 2 }),
    secondsValue: integer("seconds_value"),
    flag: boolean("flag").default(false).notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ins_service_fact_entity_idx").on(table.kind, table.entityId),
    index("ins_service_fact_org_idx").on(table.organizationId, table.kind, table.occurredAt),
  ],
);

/**
 * Who an organisation is, as the event stream last saw it.
 *
 * The fact tables above carry ids because that is all an order knows. A console that reads
 * across tenants needs names, and insights may not read identity's tables to get them - so
 * the projector asks identity for the one organisation an event names, on that
 * organisation's own behalf, and writes the answer here. `plan` needs no call at all: it
 * travels on every signed envelope, so the projector already has it.
 *
 * A row appears the first time an organisation produces an audited fact. Until then the
 * console has an id and no name, and says so rather than inventing one.
 */
export const organizationDim = pgTable("ins_org_dim", {
  organizationId: text("organization_id").primaryKey(),
  name: text("name").notNull(),
  /** The plan the envelope carried, so "which tenants are on starter" needs no billing read. */
  plan: text("plan").notNull(),
  seenAt: timestamp("seen_at").defaultNow().notNull(),
});

/**
 * The same idea for a restaurant, filled from the catalogue over the bus. `isLive` and
 * `branchCount` are catalogue facts, not insights ones: they are as fresh as the last event
 * this service projected for that organisation, which is what the console says about them.
 */
export const restaurantDim = pgTable(
  "ins_restaurant_dim",
  {
    restaurantId: text("restaurant_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    isLive: boolean("is_live").default(false).notNull(),
    branchCount: integer("branch_count").default(0).notNull(),
    /** The restaurant's own creation date, not the date this row was written. */
    openedAt: timestamp("opened_at"),
    seenAt: timestamp("seen_at").defaultNow().notNull(),
  },
  (table) => [index("ins_restaurant_dim_org_idx").on(table.organizationId)],
);

export type AnalyticsEventRow = typeof analyticsEvent.$inferSelect;
export type OrderFactRow = typeof orderFact.$inferSelect;
export type ServiceFactRow = typeof serviceFact.$inferSelect;
export type OrganizationDimRow = typeof organizationDim.$inferSelect;
export type RestaurantDimRow = typeof restaurantDim.$inferSelect;
