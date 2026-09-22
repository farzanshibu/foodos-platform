/**
 * SOT: qr-service, qr-queries, session-queries, card-queries, scan-recording
 * WHAT   The only code that reads or writes the qr service's tables.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId -
 *        except the one that resolves a public token, which is the operation that DISCOVERS
 *        an organisation and is documented as such below.
 * WHERE  services/qr/src/*.handlers.ts
 */
import "server-only";

import { and, count, countDistinct, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "./db";
import { cardDesign, qrCode, qrScan, qrSession } from "./schema";

type Scope = { organizationId: string };

function paged<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const qrService = {
  /**
   * The one query in this codebase that is not scoped to an organisation, because it is the
   * query that FINDS one. A public token is global by construction - the person scanning it
   * has no session and no tenant yet. It is safe precisely because the token is ten
   * characters of CSPRNG output and reveals nothing about what it points at, and because the
   * only thing a caller can do with the result is open a session on that restaurant.
   */
  async byToken(token: string) {
    const [row] = await db.select().from(qrCode).where(eq(qrCode.token, token)).limit(1);
    return row ?? null;
  },

  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      restaurantId?: string;
      branchId?: string;
      placeId?: string;
      type?: string;
      status?: string;
      id?: string;
    },
  ) {
    const filters = [eq(qrCode.organizationId, args.organizationId)];
    if (args.restaurantId !== undefined) filters.push(eq(qrCode.restaurantId, args.restaurantId));
    if (args.branchId !== undefined) filters.push(eq(qrCode.branchId, args.branchId));
    if (args.placeId !== undefined) filters.push(eq(qrCode.placeId, args.placeId));
    if (args.type !== undefined) filters.push(eq(qrCode.type, args.type));
    if (args.status !== undefined) filters.push(eq(qrCode.status, args.status));
    if (args.id !== undefined) filters.push(eq(qrCode.id, args.id));
    if (args.cursor !== null) filters.push(lt(qrCode.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(qrCode)
      .where(and(...filters))
      .orderBy(desc(qrCode.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(qrCode)
      .where(and(eq(qrCode.organizationId, args.organizationId), eq(qrCode.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof qrCode.$inferInsert) {
    const [row] = await db.insert(qrCode).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof qrCode.$inferInsert> }) {
    const [row] = await db
      .update(qrCode)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(qrCode.organizationId, args.organizationId), eq(qrCode.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(qrCode)
      .where(and(eq(qrCode.organizationId, args.organizationId), eq(qrCode.id, args.id)))
      .returning({ id: qrCode.id });
    return row ?? null;
  },

  /** One row per scan, then the counters recomputed from it rather than blindly incremented. */
  async recordScan(args: {
    organizationId: string;
    qrCodeId: string;
    anonymousId: string | null;
    sessionId: string;
  }) {
    await db.insert(qrScan).values({
      id: crypto.randomUUID(),
      organizationId: args.organizationId,
      qrCodeId: args.qrCodeId,
      anonymousId: args.anonymousId,
      sessionId: args.sessionId,
    });

    const [totals] = await db
      .select({ scans: count(), unique: countDistinct(qrScan.anonymousId) })
      .from(qrScan)
      .where(eq(qrScan.qrCodeId, args.qrCodeId));

    await db
      .update(qrCode)
      .set({
        scanCount: totals?.scans ?? 0,
        uniqueScanCount: totals?.unique ?? 0,
        lastScannedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qrCode.id, args.qrCodeId));
  },

  async recordOrder(args: Scope & { qrCodeId: string; revenuePaise: number }) {
    await db
      .update(qrCode)
      .set({
        orderCount: sql`${qrCode.orderCount} + 1`,
        revenuePaise: sql`${qrCode.revenuePaise} + ${args.revenuePaise}`,
        updatedAt: new Date(),
      })
      .where(and(eq(qrCode.organizationId, args.organizationId), eq(qrCode.id, args.qrCodeId)));
  },
};

export const sessionService = {
  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(qrSession)
      .where(and(eq(qrSession.organizationId, args.organizationId), eq(qrSession.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof qrSession.$inferInsert) {
    const [row] = await db.insert(qrSession).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof qrSession.$inferInsert> }) {
    const [row] = await db
      .update(qrSession)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(qrSession.organizationId, args.organizationId), eq(qrSession.id, args.id)))
      .returning();
    return row ?? null;
  },
};

export const cardService = {
  async list(args: Scope & { limit: number; cursor: string | null; id?: string; slug?: string }) {
    const filters = [eq(cardDesign.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(cardDesign.id, args.id));
    if (args.slug !== undefined) filters.push(eq(cardDesign.slug, args.slug));
    if (args.cursor !== null) filters.push(lt(cardDesign.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(cardDesign)
      .where(and(...filters))
      .orderBy(desc(cardDesign.updatedAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(cardDesign)
      .where(and(eq(cardDesign.organizationId, args.organizationId), eq(cardDesign.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async bySlug(args: Scope & { slug: string }) {
    const [row] = await db
      .select()
      .from(cardDesign)
      .where(
        and(eq(cardDesign.organizationId, args.organizationId), eq(cardDesign.slug, args.slug)),
      )
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof cardDesign.$inferInsert) {
    const [row] = await db.insert(cardDesign).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof cardDesign.$inferInsert> }) {
    const [row] = await db
      .update(cardDesign)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(cardDesign.organizationId, args.organizationId), eq(cardDesign.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(cardDesign)
      .where(and(eq(cardDesign.organizationId, args.organizationId), eq(cardDesign.id, args.id)))
      .returning({ id: cardDesign.id });
    return row ?? null;
  },
};
