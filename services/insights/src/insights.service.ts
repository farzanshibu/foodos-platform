/**
 * SOT: insights-service, event-queries, order-fact-queries, service-fact-queries,
 *      platform-queries, dimension-upserts
 * WHAT   The only code that reads or writes the insights service's tables.
 * WHY    Handlers hold rules, this holds storage. Every report signature takes organizationId -
 *        the only unscoped reads are the two platform queries at the bottom, which exist for
 *        one caller and say so where they are written.
 * WHERE  services/insights/src/*.handlers.ts
 */
import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, lte, type SQL, sql } from "drizzle-orm";

import { db } from "./db";
import {
  cursorValueOf,
  encodeCursor,
  ilikeNeedle,
  type PlatformCursor,
  type PlatformSort,
  sortAscends,
} from "./platform-page";
import { analyticsEvent, orderFact, organizationDim, restaurantDim, serviceFact } from "./schema";

/**
 * The last order's timestamp, rendered the way it was stored.
 *
 * `placed_at` is `timestamp` without a zone, and drizzle writes and reads it as UTC;
 * node-postgres, handed a bare `max(placed_at)`, builds a Date from the server's LOCAL zone
 * instead, so an aggregate and a column would disagree by the host's offset. Rendering it to
 * a fixed-width ISO string here makes it canonical - and makes it sort lexicographically,
 * which is exactly what the keyset cursor compares.
 */
const lastOrderAtIso = sql<string>`to_char(max(${orderFact.placedAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type Scope = { organizationId: string };

/** The four columns the platform list can be ordered by, once the aggregate has been cut. */
type OrderingColumns = {
  readonly orders: SQL;
  readonly gmv: SQL;
  readonly lastOrderAt: SQL;
  readonly name: SQL;
};

function orderingKey(sort: PlatformSort, columns: OrderingColumns): SQL {
  if (sort === "revenue") return columns.gmv;
  if (sort === "recent") return columns.lastOrderAt;
  if (sort === "name") return columns.name;
  return columns.orders;
}

/**
 * The cursor's value, cast back to the column's own type. `"9" > "10"` is true of strings and
 * false of money, so a bigint compared as text pages through the platform in the wrong order.
 * The two text orderings need no cast: a name is text already, and the timestamp is rendered
 * fixed-width by `lastOrderAtIso` precisely so that its text order is its time order.
 */
function keysetBound(sort: PlatformSort, value: string): SQL {
  if (sort === "revenue") return sql`${value}::bigint`;
  if (sort === "orders") return sql`${value}::int`;
  return sql`${value}`;
}

/**
 * Where the next page starts. The tie-break is the restaurant id ascending in BOTH directions,
 * because a page boundary that lands inside a run of equal values must not repeat a row and
 * must not skip one.
 */
function keysetAfter(args: {
  sort: PlatformSort;
  key: SQL;
  restaurantId: SQL;
  cursor: PlatformCursor;
}): SQL {
  const bound = keysetBound(args.sort, args.cursor.v);
  const step = sortAscends(args.sort) ? sql`${args.key} > ${bound}` : sql`${args.key} < ${bound}`;
  return sql`(${step} or (${args.key} = ${bound} and ${args.restaurantId} > ${args.cursor.r}))`;
}

export const eventService = {
  /** Idempotent by construction: a redelivered command finds its own row and stops. */
  async record(values: typeof analyticsEvent.$inferInsert) {
    await db.insert(analyticsEvent).values(values).onConflictDoNothing();
  },

  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      name?: string;
      restaurantId?: string;
      branchId?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    const filters = [eq(analyticsEvent.organizationId, args.organizationId)];
    if (args.name !== undefined) filters.push(eq(analyticsEvent.name, args.name));
    if (args.restaurantId !== undefined) {
      filters.push(eq(analyticsEvent.restaurantId, args.restaurantId));
    }
    if (args.branchId !== undefined) filters.push(eq(analyticsEvent.branchId, args.branchId));
    if (args.from !== undefined) filters.push(gte(analyticsEvent.occurredAt, args.from));
    if (args.to !== undefined) filters.push(lte(analyticsEvent.occurredAt, args.to));
    if (args.cursor !== null) filters.push(lt(analyticsEvent.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(and(...filters))
      .orderBy(desc(analyticsEvent.occurredAt))
      .limit(args.limit + 1);
    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
  },

  async countsByName(
    args: Scope & { names: readonly string[]; from: Date; to: Date; branchId?: string },
  ) {
    const filters = [
      eq(analyticsEvent.organizationId, args.organizationId),
      inArray(analyticsEvent.name, [...args.names]),
      gte(analyticsEvent.occurredAt, args.from),
      lte(analyticsEvent.occurredAt, args.to),
    ];
    if (args.branchId !== undefined) filters.push(eq(analyticsEvent.branchId, args.branchId));
    const rows = await db
      .select({ name: analyticsEvent.name, value: sql<number>`count(*)::int` })
      .from(analyticsEvent)
      .where(and(...filters))
      .groupBy(analyticsEvent.name);
    return new Map(rows.map((row) => [row.name, row.value]));
  },
};

export const factService = {
  async upsertOrder(values: typeof orderFact.$inferInsert) {
    await db
      .insert(orderFact)
      .values(values)
      .onConflictDoUpdate({
        target: orderFact.orderId,
        set: { ...values, updatedAt: new Date() },
      });
  },

  async upsertService(values: typeof serviceFact.$inferInsert) {
    await db
      .insert(serviceFact)
      .values(values)
      .onConflictDoUpdate({
        target: [serviceFact.kind, serviceFact.entityId],
        set: values,
      });
  },

  orders(args: Scope & { from: Date; to: Date; branchId?: string }) {
    const filters = [
      eq(orderFact.organizationId, args.organizationId),
      gte(orderFact.placedAt, args.from),
      lte(orderFact.placedAt, args.to),
    ];
    if (args.branchId !== undefined) filters.push(eq(orderFact.branchId, args.branchId));
    return db
      .select()
      .from(orderFact)
      .where(and(...filters))
      .orderBy(desc(orderFact.placedAt));
  },

  serviceFacts(args: Scope & { kind: string; from: Date; to: Date; branchId?: string }) {
    const filters = [
      eq(serviceFact.organizationId, args.organizationId),
      eq(serviceFact.kind, args.kind),
      gte(serviceFact.occurredAt, args.from),
      lte(serviceFact.occurredAt, args.to),
    ];
    if (args.branchId !== undefined) filters.push(eq(serviceFact.branchId, args.branchId));
    return db
      .select()
      .from(serviceFact)
      .where(and(...filters));
  },

  /**
   * Who an organisation is and what its restaurants are called, learned from the event stream
   * rather than read out of identity's or the catalogue's tables. The projector asks the
   * owning service on the changed organisation's behalf and lands the answer here, which is
   * the only way the platform console can show a name without a cross-service query.
   */
  async upsertOrganizationDim(values: typeof organizationDim.$inferInsert) {
    await db
      .insert(organizationDim)
      .values(values)
      .onConflictDoUpdate({
        target: organizationDim.organizationId,
        set: { ...values, seenAt: new Date() },
      });
  },

  async upsertRestaurantDim(values: typeof restaurantDim.$inferInsert) {
    await db
      .insert(restaurantDim)
      .values(values)
      .onConflictDoUpdate({
        target: restaurantDim.restaurantId,
        set: { ...values, seenAt: new Date() },
      });
  },

  /**
   * When each dimension row was last refreshed, or null if it has never been written. The
   * projector asks before it calls anything: every audited fact in the platform passes
   * through it, and a name does not change often enough to be worth an rpc per event.
   */
  async organizationDimSeenAt(organizationId: string): Promise<Date | null> {
    const rows = await db
      .select({ seenAt: organizationDim.seenAt })
      .from(organizationDim)
      .where(eq(organizationDim.organizationId, organizationId))
      .limit(1);
    return rows[0]?.seenAt ?? null;
  },

  async restaurantDimSeenAt(restaurantId: string): Promise<Date | null> {
    const rows = await db
      .select({ seenAt: restaurantDim.seenAt })
      .from(restaurantDim)
      .where(eq(restaurantDim.restaurantId, restaurantId))
      .limit(1);
    return rows[0]?.seenAt ?? null;
  },

  /**
   * The only cross-tenant reads left in the product, and they are reachable exclusively from
   * the platform console after that console has proved the caller is the organisation the
   * deployment named as its own.
   *
   * Every number is counted from this service's own order facts over the window the caller
   * asked for. `customers` counts distinct diners who ordered - `count(distinct)` skips the
   * nulls, so a walk-in that named nobody is an order without a customer rather than one more
   * customer.
   */
  platformTotals(args: { from: Date; to: Date }) {
    return db
      .select({
        orders: sql<number>`count(*)::int`,
        gmv: sql<string>`coalesce(sum(${orderFact.totalPaise}), 0)::bigint`,
        organizations: sql<number>`count(distinct ${orderFact.organizationId})::int`,
        restaurants: sql<number>`count(distinct ${orderFact.restaurantId})::int`,
        customers: sql<number>`count(distinct ${orderFact.customerId})::int`,
      })
      .from(orderFact)
      .where(and(gte(orderFact.placedAt, args.from), lte(orderFact.placedAt, args.to)));
  },

  /**
   * Which organisations are actually running, derived from order activity rather than from a
   * directory of restaurants - insights owns no restaurants, and with no marketplace there is
   * no index of them either. Activity is the honest measure of "live" anyway.
   *
   * The aggregate is cut first and the two dimension tables are joined to it afterwards, so
   * filtering by plan or by name, ordering and the keyset all happen on one flat row instead
   * of inside a GROUP BY. Both joins are LEFT joins: a restaurant whose orders arrived before
   * this service learned any names still appears, with nulls where the names would be.
   */
  async platformOrganizations(args: {
    from: Date;
    to: Date;
    limit: number;
    sort: PlatformSort;
    search?: string;
    plan?: string;
    cursor?: PlatformCursor;
  }) {
    const agg = db
      .select({
        organizationId: orderFact.organizationId,
        restaurantId: orderFact.restaurantId,
        orders: sql<number>`count(*)::int`.as("orders"),
        gmv: sql<string>`coalesce(sum(${orderFact.totalPaise}), 0)::bigint`.as("gmv"),
        lastOrderAt: lastOrderAtIso.as("last_order_at"),
      })
      .from(orderFact)
      .where(and(gte(orderFact.placedAt, args.from), lte(orderFact.placedAt, args.to)))
      .groupBy(orderFact.organizationId, orderFact.restaurantId)
      .as("agg");

    /** What `sort: "name"` orders by. Falls back to the id, so an unnamed row still has a
     *  stable place in the ordering instead of collapsing to the top on a null. */
    const sortName = sql<string>`coalesce(${restaurantDim.name}, ${agg.restaurantId})`;
    const restaurantId = sql`${agg.restaurantId}`;
    const key = orderingKey(args.sort, {
      orders: sql`${agg.orders}`,
      gmv: sql`${agg.gmv}`,
      lastOrderAt: sql`${agg.lastOrderAt}`,
      name: sortName,
    });

    const filters: SQL[] = [];
    if (args.plan !== undefined) filters.push(eq(organizationDim.plan, args.plan));
    if (args.search !== undefined) {
      const needle = ilikeNeedle(args.search);
      filters.push(
        sql`(coalesce(${organizationDim.name}, '') ilike ${needle}
          or coalesce(${restaurantDim.name}, '') ilike ${needle}
          or ${agg.organizationId} ilike ${needle}
          or ${restaurantId} ilike ${needle})`,
      );
    }
    if (args.cursor !== undefined) {
      filters.push(keysetAfter({ sort: args.sort, key, restaurantId, cursor: args.cursor }));
    }

    const rows = await db
      .select({
        organizationId: agg.organizationId,
        restaurantId: agg.restaurantId,
        orders: agg.orders,
        gmv: agg.gmv,
        lastOrderAt: agg.lastOrderAt,
        organizationName: organizationDim.name,
        plan: organizationDim.plan,
        restaurantName: restaurantDim.name,
        isLive: restaurantDim.isLive,
        branchCount: restaurantDim.branchCount,
        openedAt: restaurantDim.openedAt,
        sortName: sortName.as("sort_name"),
      })
      .from(agg)
      .leftJoin(organizationDim, eq(organizationDim.organizationId, agg.organizationId))
      .leftJoin(restaurantDim, eq(restaurantDim.restaurantId, agg.restaurantId))
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(sortAscends(args.sort) ? asc(key) : desc(key), asc(agg.restaurantId))
      .limit(args.limit + 1);

    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ s: args.sort, v: cursorValueOf(args.sort, last), r: last.restaurantId })
          : null,
    };
  },
};
