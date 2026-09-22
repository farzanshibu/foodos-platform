/**
 * SOT: request-service, request-type-queries, service-request-queries, request-events
 * WHAT   The only code that reads or writes the requests service's tables.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId.
 * WHERE  services/requests/src/*.handlers.ts
 */
import "server-only";

import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "./db";
import { requestEvent, requestType, serviceRequest } from "./schema";

type Scope = { organizationId: string };

function paged<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const typeService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      branchId?: string;
      id?: string;
      activeOnly: boolean;
    },
  ) {
    const filters = [eq(requestType.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(requestType.id, args.id));
    if (args.activeOnly) filters.push(eq(requestType.isActive, true));
    if (args.cursor !== null) filters.push(lt(requestType.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(requestType)
      .where(and(...filters))
      .orderBy(asc(requestType.sortOrder), desc(requestType.createdAt))
      .limit(args.limit + 1);

    /** A type scoped to one branch is invisible from the others; a null branch is universal. */
    const scoped =
      args.branchId === undefined
        ? rows
        : rows.filter((row) => row.branchId === null || row.branchId === args.branchId);
    return paged(scoped, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(requestType)
      .where(and(eq(requestType.organizationId, args.organizationId), eq(requestType.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async byKey(args: Scope & { key: string }) {
    const [row] = await db
      .select()
      .from(requestType)
      .where(
        and(eq(requestType.organizationId, args.organizationId), eq(requestType.key, args.key)),
      )
      .limit(1);
    return row ?? null;
  },

  byIds(args: Scope & { ids: readonly string[] }) {
    if (args.ids.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(requestType)
      .where(
        and(
          eq(requestType.organizationId, args.organizationId),
          inArray(requestType.id, [...args.ids]),
        ),
      );
  },

  async create(values: typeof requestType.$inferInsert) {
    const [row] = await db.insert(requestType).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof requestType.$inferInsert> }) {
    const [row] = await db
      .update(requestType)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(requestType.organizationId, args.organizationId), eq(requestType.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(requestType)
      .where(and(eq(requestType.organizationId, args.organizationId), eq(requestType.id, args.id)))
      .returning({ id: requestType.id });
    return row ?? null;
  },
};

export const requestService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      id?: string;
      branchId?: string;
      placeId?: string;
      requestTypeId?: string;
      sessionId?: string;
      statuses?: readonly string[];
      since?: Date;
    },
  ) {
    const filters = [eq(serviceRequest.organizationId, args.organizationId)];
    if (args.id !== undefined) filters.push(eq(serviceRequest.id, args.id));
    if (args.branchId !== undefined) filters.push(eq(serviceRequest.branchId, args.branchId));
    if (args.placeId !== undefined) filters.push(eq(serviceRequest.placeId, args.placeId));
    if (args.requestTypeId !== undefined) {
      filters.push(eq(serviceRequest.requestTypeId, args.requestTypeId));
    }
    if (args.sessionId !== undefined) filters.push(eq(serviceRequest.sessionId, args.sessionId));
    if (args.statuses !== undefined && args.statuses.length > 0) {
      filters.push(inArray(serviceRequest.status, [...args.statuses]));
    }
    if (args.since !== undefined) filters.push(gte(serviceRequest.submittedAt, args.since));
    if (args.cursor !== null) filters.push(lt(serviceRequest.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(serviceRequest)
      .where(and(...filters))
      .orderBy(desc(serviceRequest.submittedAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(serviceRequest)
      .where(
        and(eq(serviceRequest.organizationId, args.organizationId), eq(serviceRequest.id, args.id)),
      )
      .limit(1);
    return row ?? null;
  },

  /** Anti-spam: how many of this type the table already has open. */
  openForTable(args: Scope & { placeId: string; requestTypeId: string }) {
    return db
      .select()
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.organizationId, args.organizationId),
          eq(serviceRequest.placeId, args.placeId),
          eq(serviceRequest.requestTypeId, args.requestTypeId),
          inArray(serviceRequest.status, ["submitted", "acknowledged", "in_progress"]),
        ),
      );
  },

  async create(values: typeof serviceRequest.$inferInsert) {
    const [row] = await db.insert(serviceRequest).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof serviceRequest.$inferInsert> }) {
    const [row] = await db
      .update(serviceRequest)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(eq(serviceRequest.organizationId, args.organizationId), eq(serviceRequest.id, args.id)),
      )
      .returning();
    return row ?? null;
  },

  async addEvent(values: typeof requestEvent.$inferInsert) {
    await db.insert(requestEvent).values(values);
  },

  eventsFor(args: Scope & { requestIds: readonly string[] }) {
    if (args.requestIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(requestEvent)
      .where(
        and(
          eq(requestEvent.organizationId, args.organizationId),
          inArray(requestEvent.serviceRequestId, [...args.requestIds]),
        ),
      )
      .orderBy(asc(requestEvent.createdAt));
  },
};
