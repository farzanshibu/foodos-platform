/**
 * SOT: crm-service, customer-queries, review-queries, promotion-queries, loyalty-ledger
 * WHAT   The only code that reads or writes the crm service's tables.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId.
 * WHERE  services/crm/src/*.handlers.ts
 */
import "server-only";

import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from "drizzle-orm";

import { db } from "./db";
import {
  coupon,
  customer,
  favorite,
  loyaltyProgramme,
  loyaltyTransaction,
  promotion,
  review,
} from "./schema";

type Scope = { organizationId: string };

function paged<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const customerService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      search?: string;
      sort: "recent" | "spend" | "orders" | "name";
    },
  ) {
    const filters = [eq(customer.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(customer.id, args.id));
    if (args.search !== undefined) {
      const term = `%${args.search}%`;
      const match = or(
        ilike(customer.name, term),
        ilike(customer.phone, term),
        ilike(customer.email, term),
      );
      if (match !== undefined) filters.push(match);
    }
    if (args.cursor !== null) filters.push(lt(customer.createdAt, new Date(args.cursor)));

    const order =
      args.sort === "spend"
        ? desc(customer.totalSpendPaise)
        : args.sort === "orders"
          ? desc(customer.totalOrders)
          : args.sort === "name"
            ? asc(customer.name)
            : desc(customer.createdAt);

    const rows = await db
      .select()
      .from(customer)
      .where(and(...filters))
      .orderBy(order)
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(customer)
      .where(and(eq(customer.organizationId, args.organizationId), eq(customer.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async byPhone(args: Scope & { phone: string }) {
    const [row] = await db
      .select()
      .from(customer)
      .where(and(eq(customer.organizationId, args.organizationId), eq(customer.phone, args.phone)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof customer.$inferInsert) {
    const [row] = await db.insert(customer).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof customer.$inferInsert> }) {
    const [row] = await db
      .update(customer)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(customer.organizationId, args.organizationId), eq(customer.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(customer)
      .where(and(eq(customer.organizationId, args.organizationId), eq(customer.id, args.id)))
      .returning({ id: customer.id });
    return row ?? null;
  },
};

export const reviewService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      restaurantId?: string;
      branchId?: string;
      status?: string;
      minOverall?: number;
    },
  ) {
    const filters = [eq(review.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(review.id, args.id));
    if (args.restaurantId !== undefined) filters.push(eq(review.restaurantId, args.restaurantId));
    if (args.branchId !== undefined) filters.push(eq(review.branchId, args.branchId));
    if (args.status !== undefined) filters.push(eq(review.status, args.status));
    if (args.minOverall !== undefined) {
      filters.push(gte(review.overall, String(args.minOverall)));
    }
    if (args.cursor !== null) filters.push(lt(review.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(review)
      .where(and(...filters))
      .orderBy(desc(review.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(review)
      .where(and(eq(review.organizationId, args.organizationId), eq(review.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async byOrder(args: Scope & { orderId: string }) {
    const [row] = await db
      .select()
      .from(review)
      .where(and(eq(review.organizationId, args.organizationId), eq(review.orderId, args.orderId)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof review.$inferInsert) {
    const [row] = await db.insert(review).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof review.$inferInsert> }) {
    const [row] = await db
      .update(review)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(review.organizationId, args.organizationId), eq(review.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(review)
      .where(and(eq(review.organizationId, args.organizationId), eq(review.id, args.id)))
      .returning({ id: review.id });
    return row ?? null;
  },
};

export const favoriteService = {
  async list(
    args: Scope & { limit: number; cursor: string | null; kind?: string; owner: string | null },
  ) {
    const filters = [eq(favorite.organizationId, args.organizationId)];
    if (args.kind !== undefined) filters.push(eq(favorite.kind, args.kind));
    if (args.owner !== null) filters.push(eq(favorite.sessionId, args.owner));
    if (args.cursor !== null) filters.push(lt(favorite.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(favorite)
      .where(and(...filters))
      .orderBy(desc(favorite.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async create(values: typeof favorite.$inferInsert) {
    const [row] = await db.insert(favorite).values(values).returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(favorite)
      .where(and(eq(favorite.organizationId, args.organizationId), eq(favorite.id, args.id)))
      .returning({ id: favorite.id });
    return row ?? null;
  },
};

export const promotionService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      restaurantId?: string;
      activeOnly: boolean;
    },
  ) {
    const filters = [eq(promotion.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(promotion.id, args.id));
    if (args.restaurantId !== undefined) {
      filters.push(eq(promotion.restaurantId, args.restaurantId));
    }
    if (args.activeOnly) filters.push(eq(promotion.isActive, true));
    if (args.cursor !== null) filters.push(lt(promotion.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(promotion)
      .where(and(...filters))
      .orderBy(desc(promotion.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(promotion)
      .where(and(eq(promotion.organizationId, args.organizationId), eq(promotion.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof promotion.$inferInsert) {
    const [row] = await db.insert(promotion).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof promotion.$inferInsert> }) {
    const [row] = await db
      .update(promotion)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(promotion.organizationId, args.organizationId), eq(promotion.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(promotion)
      .where(and(eq(promotion.organizationId, args.organizationId), eq(promotion.id, args.id)))
      .returning({ id: promotion.id });
    return row ?? null;
  },
};

export const couponService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      code?: string;
      promotionId?: string;
      activeOnly: boolean;
    },
  ) {
    const filters = [eq(coupon.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(coupon.id, args.id));
    if (args.code !== undefined) filters.push(eq(coupon.code, args.code.toUpperCase()));
    if (args.promotionId !== undefined) filters.push(eq(coupon.promotionId, args.promotionId));
    if (args.activeOnly) filters.push(eq(coupon.isActive, true));
    if (args.cursor !== null) filters.push(lt(coupon.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(coupon)
      .where(and(...filters))
      .orderBy(desc(coupon.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(coupon)
      .where(and(eq(coupon.organizationId, args.organizationId), eq(coupon.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof coupon.$inferInsert) {
    const [row] = await db.insert(coupon).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof coupon.$inferInsert> }) {
    const [row] = await db
      .update(coupon)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(coupon.organizationId, args.organizationId), eq(coupon.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(coupon)
      .where(and(eq(coupon.organizationId, args.organizationId), eq(coupon.id, args.id)))
      .returning({ id: coupon.id });
    return row ?? null;
  },

  promotionsFor(args: Scope & { ids: readonly string[] }) {
    if (args.ids.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(promotion)
      .where(
        and(
          eq(promotion.organizationId, args.organizationId),
          inArray(promotion.id, [...args.ids]),
        ),
      );
  },
};

export const loyaltyService = {
  async programme(args: Scope) {
    const [row] = await db
      .select()
      .from(loyaltyProgramme)
      .where(eq(loyaltyProgramme.organizationId, args.organizationId))
      .limit(1);
    return row ?? null;
  },

  async createProgramme(values: typeof loyaltyProgramme.$inferInsert) {
    const [row] = await db.insert(loyaltyProgramme).values(values).returning();
    return row ?? null;
  },

  async updateProgramme(
    args: Scope & { id: string; patch: Partial<typeof loyaltyProgramme.$inferInsert> },
  ) {
    const [row] = await db
      .update(loyaltyProgramme)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(
          eq(loyaltyProgramme.organizationId, args.organizationId),
          eq(loyaltyProgramme.id, args.id),
        ),
      )
      .returning();
    return row ?? null;
  },

  /** The balance is the ledger's sum. There is no column anybody could set to a wrong number. */
  async balance(args: Scope & { customerId: string }) {
    const [row] = await db
      .select({ total: sum(loyaltyTransaction.points) })
      .from(loyaltyTransaction)
      .where(
        and(
          eq(loyaltyTransaction.organizationId, args.organizationId),
          eq(loyaltyTransaction.customerId, args.customerId),
        ),
      );
    return Number(row?.total ?? 0);
  },

  transactions(args: Scope & { customerId: string; limit: number }) {
    return db
      .select()
      .from(loyaltyTransaction)
      .where(
        and(
          eq(loyaltyTransaction.organizationId, args.organizationId),
          eq(loyaltyTransaction.customerId, args.customerId),
        ),
      )
      .orderBy(desc(loyaltyTransaction.createdAt))
      .limit(args.limit);
  },

  async post(values: typeof loyaltyTransaction.$inferInsert) {
    const [row] = await db.insert(loyaltyTransaction).values(values).returning();
    return row ?? null;
  },

  async bumpReviewCount(args: Scope & { customerId: string }) {
    await db
      .update(customer)
      .set({ reviewCount: sql`${customer.reviewCount} + 1`, updatedAt: new Date() })
      .where(
        and(eq(customer.organizationId, args.organizationId), eq(customer.id, args.customerId)),
      );
  },
};
