/**
 * SOT: order-service, cart-service, order-queries, kitchen-queries, payment-queries
 * WHAT   The only code that reads or writes this service's tables.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId, so
 *        there is no function here capable of a cross-tenant query.
 * WHERE  services/orders/src/*.handlers.ts
 */
import "server-only";

import { TERMINAL_CART_STATUSES } from "@foodos/contracts";
import { and, asc, count, desc, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";

import { db } from "./db";
import {
  cart,
  kitchenStation,
  kitchenTicket,
  order,
  orderItem,
  orderItemModifier,
  payment,
  refund,
} from "./schema";

type Scope = { organizationId: string };

function paged<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const cartService = {
  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(cart)
      .where(and(eq(cart.organizationId, args.organizationId), eq(cart.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async list(
    args: Scope & { limit: number; cursor: string | null; branchId?: string; status?: string },
  ) {
    const filters = [eq(cart.organizationId, args.organizationId)];
    if (args.branchId !== undefined) filters.push(eq(cart.branchId, args.branchId));
    if (args.status !== undefined) filters.push(eq(cart.status, args.status));
    if (args.cursor !== null) filters.push(lt(cart.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(cart)
      .where(and(...filters))
      .orderBy(asc(cart.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async forSession(args: Scope & { sessionId: string }) {
    const [row] = await db
      .select()
      .from(cart)
      .where(
        and(
          eq(cart.organizationId, args.organizationId),
          eq(cart.sessionId, args.sessionId),
          eq(cart.status, "active"),
        ),
      )
      .orderBy(desc(cart.updatedAt))
      .limit(1);
    return row ?? null;
  },

  /**
   * The open basket at a place. This is the shared-cart lookup: everybody who scans the code
   * on table twelve resolves through here to the one basket that table is holding.
   *
   * Scoped to `active` on purpose - a table that has already sent its order starts a fresh
   * basket rather than reopening the last sitting, so tonight's diners never inherit the
   * dishes of whoever sat there before them.
   */
  async forPlace(args: Scope & { placeId: string }) {
    const [row] = await db
      .select()
      .from(cart)
      .where(
        and(
          eq(cart.organizationId, args.organizationId),
          eq(cart.placeId, args.placeId),
          eq(cart.status, "active"),
        ),
      )
      .orderBy(desc(cart.createdAt))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof cart.$inferInsert) {
    const [row] = await db.insert(cart).values(values).returning();
    return row ?? null;
  },

  /**
   * Every write bumps the version, here rather than at each call site, so a caller cannot
   * forget. A watcher compares it against what it already holds and ignores a notice that
   * describes a change it has already read - which happens routinely when a live nudge and a
   * reconnect race each other.
   */
  async update(args: Scope & { id: string; patch: Partial<typeof cart.$inferInsert> }) {
    const [row] = await db
      .update(cart)
      .set({ ...args.patch, version: sql`${cart.version} + 1`, updatedAt: new Date() })
      .where(and(eq(cart.organizationId, args.organizationId), eq(cart.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(cart)
      .where(and(eq(cart.organizationId, args.organizationId), eq(cart.id, args.id)))
      .returning({ id: cart.id });
    return row ?? null;
  },

  /**
   * Close every basket still open at a place, because the party holding them has gone.
   *
   * `notInArray` rather than `eq(status, "active")`: a table can also be holding a basket
   * that staff allocated to it from the door, and clearing the table has to end that one
   * too. Only the two terminal statuses are left alone - re-closing a basket that already
   * became an order would rewrite history to say the party walked out.
   *
   * Idempotent, which is what makes it safe to retry: a second call finds nothing left to
   * close and answers zero rather than failing.
   */
  closeAtPlace(args: Scope & { placeId: string }) {
    return db
      .update(cart)
      .set({ status: "abandoned", version: sql`${cart.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(cart.organizationId, args.organizationId),
          eq(cart.placeId, args.placeId),
          notInArray(cart.status, [...TERMINAL_CART_STATUSES]),
        ),
      )
      .returning({ id: cart.id });
  },
};

/** Postgres 23505, whether the driver threw it directly or wrapped it as the cause. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

export const orderService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      branchId?: string;
      placeId?: string;
      customerId?: string;
      sessionId?: string;
      statuses?: readonly string[];
      from?: Date;
      to?: Date;
    },
  ) {
    const filters = [eq(order.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(order.id, args.id));
    if (args.branchId !== undefined) filters.push(eq(order.branchId, args.branchId));
    if (args.placeId !== undefined) filters.push(eq(order.placeId, args.placeId));
    if (args.customerId !== undefined) filters.push(eq(order.customerId, args.customerId));
    if (args.sessionId !== undefined) filters.push(eq(order.sessionId, args.sessionId));
    if (args.statuses !== undefined && args.statuses.length > 0) {
      filters.push(inArray(order.status, [...args.statuses]));
    }
    if (args.from !== undefined) filters.push(gte(order.createdAt, args.from));
    if (args.to !== undefined) filters.push(lte(order.createdAt, args.to));
    if (args.cursor !== null) filters.push(lt(order.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(order)
      .where(and(...filters))
      .orderBy(desc(order.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(order)
      .where(and(eq(order.organizationId, args.organizationId), eq(order.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  /**
   * The next human-readable number for this branch today. Counting rather than keeping a
   * sequence per branch keeps the number restarting each morning, which is what staff expect
   * when they call an order across a pass.
   */
  /**
   * The next number for a branch: one more than the highest ever issued.
   *
   * It used to be the count of today's orders plus one, which restarted every midnight - but
   * the unique index is per branch for ever, so the first order of a new day collided with the
   * first order of the day before. Counting also hands out a number twice the moment an order
   * is removed. The highest number plus one cannot do either, and the number is still short
   * enough to call across a kitchen for the first thousand orders of a branch.
   */
  async nextOrderNumber(args: Scope & { branchId: string }) {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(cast(${order.orderNumber} as integer)), 0)` })
      .from(order)
      .where(
        and(
          eq(order.organizationId, args.organizationId),
          eq(order.branchId, args.branchId),
          sql`${order.orderNumber} ~ '^[0-9]+$'`,
        ),
      );
    return String(Number(row?.value ?? 0) + 1).padStart(4, "0");
  },

  /**
   * Insert with a number, retrying when two orders at the same branch picked the same one at
   * the same moment. The unique index is what guarantees correctness; this makes losing the
   * race invisible to the diner instead of a failed order.
   */
  async createNumbered(values: Omit<typeof order.$inferInsert, "orderNumber">) {
    for (let attempt = 1; ; attempt += 1) {
      const orderNumber = await orderService.nextOrderNumber({
        organizationId: values.organizationId,
        branchId: values.branchId,
      });
      try {
        const [row] = await db
          .insert(order)
          .values({ ...values, orderNumber })
          .returning();
        return row ?? null;
      } catch (error) {
        if (attempt >= 6 || !isUniqueViolation(error)) throw error;
      }
    }
  },

  async create(values: typeof order.$inferInsert) {
    const [row] = await db.insert(order).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof order.$inferInsert> }) {
    const [row] = await db
      .update(order)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(order.organizationId, args.organizationId), eq(order.id, args.id)))
      .returning();
    return row ?? null;
  },

  insertLines(rows: ReadonlyArray<typeof orderItem.$inferInsert>) {
    if (rows.length === 0) return Promise.resolve([]);
    return db
      .insert(orderItem)
      .values([...rows])
      .returning();
  },

  async insertModifiers(rows: ReadonlyArray<typeof orderItemModifier.$inferInsert>) {
    if (rows.length === 0) return;
    await db.insert(orderItemModifier).values([...rows]);
  },

  async linesFor(args: Scope & { orderIds: readonly string[] }) {
    if (args.orderIds.length === 0) return { lines: [], modifiers: [] };
    const lines = await db
      .select()
      .from(orderItem)
      .where(
        and(
          eq(orderItem.organizationId, args.organizationId),
          inArray(orderItem.orderId, [...args.orderIds]),
        ),
      )
      .orderBy(asc(orderItem.createdAt));
    const ids = lines.map((row) => row.id);
    const modifiers =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(orderItemModifier)
            .where(
              and(
                eq(orderItemModifier.organizationId, args.organizationId),
                inArray(orderItemModifier.orderItemId, ids),
              ),
            );
    return { lines, modifiers };
  },
};

export const kitchenService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      branchId: string;
      stationId?: string;
      statuses?: readonly string[];
    },
  ) {
    const filters = [
      eq(kitchenTicket.organizationId, args.organizationId),
      eq(kitchenTicket.branchId, args.branchId),
    ];
    if (args.stationId !== undefined) filters.push(eq(kitchenTicket.stationId, args.stationId));
    if (args.statuses !== undefined && args.statuses.length > 0) {
      filters.push(inArray(kitchenTicket.status, [...args.statuses]));
    }
    if (args.cursor !== null) filters.push(lt(kitchenTicket.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(kitchenTicket)
      .where(and(...filters))
      .orderBy(asc(kitchenTicket.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(kitchenTicket)
      .where(
        and(eq(kitchenTicket.organizationId, args.organizationId), eq(kitchenTicket.id, args.id)),
      )
      .limit(1);
    return row ?? null;
  },

  async nextTicketNumber(args: Scope & { branchId: string }) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [row] = await db
      .select({ value: count() })
      .from(kitchenTicket)
      .where(
        and(
          eq(kitchenTicket.organizationId, args.organizationId),
          eq(kitchenTicket.branchId, args.branchId),
          gte(kitchenTicket.createdAt, midnight),
        ),
      );
    return (row?.value ?? 0) + 1;
  },

  async create(values: typeof kitchenTicket.$inferInsert) {
    const [row] = await db.insert(kitchenTicket).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof kitchenTicket.$inferInsert> }) {
    const [row] = await db
      .update(kitchenTicket)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(eq(kitchenTicket.organizationId, args.organizationId), eq(kitchenTicket.id, args.id)),
      )
      .returning();
    return row ?? null;
  },

  stationsFor(args: Scope & { branchId: string }) {
    return db
      .select()
      .from(kitchenStation)
      .where(
        and(
          eq(kitchenStation.organizationId, args.organizationId),
          eq(kitchenStation.branchId, args.branchId),
        ),
      );
  },
};

export const paymentService = {
  async list(
    args: Scope & { limit: number; cursor: string | null; orderId?: string; id?: string },
  ) {
    const filters = [eq(payment.organizationId, args.organizationId)];
    if (args.orderId !== undefined) filters.push(eq(payment.orderId, args.orderId));
    if (args.id !== undefined) filters.push(eq(payment.id, args.id));
    if (args.cursor !== null) filters.push(lt(payment.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(payment)
      .where(and(...filters))
      .orderBy(desc(payment.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(payment)
      .where(and(eq(payment.organizationId, args.organizationId), eq(payment.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  /**
   * Looked up by what the provider calls it, because that is all a webhook carries. The org
   * still scopes the query: a webhook naming another tenant's payment finds nothing here.
   */
  async byProviderPaymentId(args: Scope & { provider: string; providerPaymentId: string }) {
    const [row] = await db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.organizationId, args.organizationId),
          eq(payment.provider, args.provider),
          eq(payment.providerPaymentId, args.providerPaymentId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async byProviderOrderId(args: Scope & { provider: string; providerOrderId: string }) {
    const [row] = await db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.organizationId, args.organizationId),
          eq(payment.provider, args.provider),
          eq(payment.providerOrderId, args.providerOrderId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof payment.$inferInsert) {
    const [row] = await db.insert(payment).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof payment.$inferInsert> }) {
    const [row] = await db
      .update(payment)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(payment.organizationId, args.organizationId), eq(payment.id, args.id)))
      .returning();
    return row ?? null;
  },

  async addRefund(values: typeof refund.$inferInsert) {
    const [row] = await db.insert(refund).values(values).returning();
    return row ?? null;
  },

  async bumpRefunded(args: Scope & { id: string; amountPaise: number }) {
    const [row] = await db
      .update(payment)
      .set({
        refundedPaise: sql`${payment.refundedPaise} + ${args.amountPaise}`,
        updatedAt: new Date(),
      })
      .where(and(eq(payment.organizationId, args.organizationId), eq(payment.id, args.id)))
      .returning();
    return row ?? null;
  },
};
