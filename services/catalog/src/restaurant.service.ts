/**
 * SOT: restaurant-service, branch-service, restaurant-queries, branch-queries
 * WHAT   The only code that reads or writes the restaurant, branch and hours tables.
 * WHY    Database isolation inside the service too: handlers hold business rules, this holds
 *        storage. Every signature takes organizationId first, so there is no function here
 *        capable of a cross-tenant query.
 * HOW    organizationId always comes from ctx.orgId, which comes from the signed envelope.
 * WHERE  services/catalog/src/restaurant.handlers.ts
 */
import "server-only";

import { and, asc, count, desc, eq, lt } from "drizzle-orm";

import { db } from "./db";
import { branch, branchHours, restaurant } from "./schema";

type Scope = { organizationId: string };

export const restaurantService = {
  async list(args: Scope & { limit: number; cursor: string | null; id?: string; slug?: string }) {
    const filters = [eq(restaurant.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(restaurant.id, args.id));
    if (args.slug !== undefined) filters.push(eq(restaurant.slug, args.slug));
    if (args.cursor !== null) filters.push(lt(restaurant.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(restaurant)
      .where(and(...filters))
      .orderBy(desc(restaurant.createdAt))
      .limit(args.limit + 1);

    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(restaurant)
      .where(and(eq(restaurant.organizationId, args.organizationId), eq(restaurant.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async bySlug(args: Scope & { slug: string }) {
    const [row] = await db
      .select()
      .from(restaurant)
      .where(
        and(eq(restaurant.organizationId, args.organizationId), eq(restaurant.slug, args.slug)),
      )
      .limit(1);
    return row ?? null;
  },

  async branchCount(args: Scope & { restaurantId: string }) {
    const [row] = await db
      .select({ value: count() })
      .from(branch)
      .where(
        and(
          eq(branch.organizationId, args.organizationId),
          eq(branch.restaurantId, args.restaurantId),
        ),
      );
    return row?.value ?? 0;
  },

  async create(values: typeof restaurant.$inferInsert) {
    const [row] = await db.insert(restaurant).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof restaurant.$inferInsert> }) {
    const [row] = await db
      .update(restaurant)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(restaurant.organizationId, args.organizationId), eq(restaurant.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(restaurant)
      .where(and(eq(restaurant.organizationId, args.organizationId), eq(restaurant.id, args.id)))
      .returning({ id: restaurant.id });
    return row ?? null;
  },
};

export const branchService = {
  async list(
    args: Scope & { limit: number; cursor: string | null; restaurantId?: string; id?: string },
  ) {
    const filters = [eq(branch.organizationId, args.organizationId)];
    if (args.restaurantId !== undefined) filters.push(eq(branch.restaurantId, args.restaurantId));
    if (args.id !== undefined) filters.push(eq(branch.id, args.id));
    if (args.cursor !== null) filters.push(lt(branch.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(branch)
      .where(and(...filters))
      .orderBy(desc(branch.createdAt))
      .limit(args.limit + 1);

    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(branch)
      .where(and(eq(branch.organizationId, args.organizationId), eq(branch.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof branch.$inferInsert) {
    const [row] = await db.insert(branch).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof branch.$inferInsert> }) {
    const [row] = await db
      .update(branch)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(branch.organizationId, args.organizationId), eq(branch.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(branch)
      .where(and(eq(branch.organizationId, args.organizationId), eq(branch.id, args.id)))
      .returning({ id: branch.id });
    return row ?? null;
  },

  async hoursFor(args: Scope & { branchIds: readonly string[] }) {
    if (args.branchIds.length === 0) return [];
    const rows = await db
      .select()
      .from(branchHours)
      .where(eq(branchHours.organizationId, args.organizationId))
      .orderBy(asc(branchHours.dayOfWeek));
    const wanted = new Set(args.branchIds);
    return rows.filter((row) => wanted.has(row.branchId));
  },

  /** The whole week, replaced. A partial write is how a branch opens on a day nobody meant. */
  async replaceHours(
    args: Scope & { branchId: string; rows: ReadonlyArray<typeof branchHours.$inferInsert> },
  ) {
    await db
      .delete(branchHours)
      .where(
        and(
          eq(branchHours.organizationId, args.organizationId),
          eq(branchHours.branchId, args.branchId),
        ),
      );
    if (args.rows.length > 0) await db.insert(branchHours).values([...args.rows]);
  },
};
