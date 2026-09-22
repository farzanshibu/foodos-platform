/**
 * SOT: floor-service, table-queries, parameter-queries, section-queries
 * WHAT   The only code that reads or writes the floor service's tables.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId, so
 *        there is no function here capable of a cross-tenant query.
 * WHERE  services/floor/src/*.handlers.ts
 */
import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "./db";
import { parameterDefinition, place, placeParameterValue, section } from "./schema";

type Scope = { organizationId: string };

function paged<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const sectionService = {
  async list(args: Scope & { limit: number; cursor: string | null; branchId?: string }) {
    const filters = [eq(section.organizationId, args.organizationId)];
    if (args.branchId !== undefined) filters.push(eq(section.branchId, args.branchId));
    if (args.cursor !== null) filters.push(lt(section.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(section)
      .where(and(...filters))
      .orderBy(asc(section.floor), asc(section.sortOrder))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async placeCounts(args: Scope & { sectionIds: readonly string[] }) {
    if (args.sectionIds.length === 0) return new Map<string, number>();
    const rows = await db
      .select({ sectionId: place.sectionId, value: count() })
      .from(place)
      .where(
        and(
          eq(place.organizationId, args.organizationId),
          inArray(place.sectionId, [...args.sectionIds]),
        ),
      )
      .groupBy(place.sectionId);
    return new Map(
      rows.flatMap((row) => (row.sectionId === null ? [] : [[row.sectionId, row.value] as const])),
    );
  },

  async create(values: typeof section.$inferInsert) {
    const [row] = await db.insert(section).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof section.$inferInsert> }) {
    const [row] = await db
      .update(section)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(section.organizationId, args.organizationId), eq(section.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(section)
      .where(and(eq(section.organizationId, args.organizationId), eq(section.id, args.id)))
      .returning({ id: section.id });
    return row ?? null;
  },
};

export const placeService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      branchId?: string;
      sectionId?: string;
      id?: string;
      status?: string;
      kind?: string;
      minCapacity?: number;
    },
  ) {
    const filters = [eq(place.organizationId, args.organizationId)];
    if (args.branchId !== undefined) filters.push(eq(place.branchId, args.branchId));
    if (args.sectionId !== undefined) filters.push(eq(place.sectionId, args.sectionId));
    if (args.id !== undefined) filters.push(eq(place.id, args.id));
    if (args.status !== undefined) filters.push(eq(place.status, args.status));
    if (args.kind !== undefined) filters.push(eq(place.kind, args.kind));
    if (args.minCapacity !== undefined) filters.push(gte(place.capacity, args.minCapacity));
    if (args.cursor !== null) filters.push(lt(place.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(place)
      .where(and(...filters))
      /**
       * Grid order, then label. Postgres sorts nulls last on ASC, so a place with no
       * coordinate lands after the grid rather than in front of row A - which is also the
       * order the seat map wants to draw them in.
       */
      .orderBy(asc(place.rowLabel), asc(place.columnNumber), asc(place.label))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(place)
      .where(and(eq(place.organizationId, args.organizationId), eq(place.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async byNumber(args: Scope & { branchId: string; label: string }) {
    const [row] = await db
      .select()
      .from(place)
      .where(
        and(
          eq(place.organizationId, args.organizationId),
          eq(place.branchId, args.branchId),
          eq(place.label, args.label),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof place.$inferInsert) {
    const [row] = await db.insert(place).values(values).returning();
    return row ?? null;
  },

  /**
   * A whole grid in one statement. `onConflictDoNothing` is the idempotency: the branch/label
   * unique index is the natural key, so laying out the same screen twice - or two managers
   * doing it at the same moment - inserts each seat exactly once and returns only the rows
   * that were really new. The caller reports the rest as skipped.
   */
  createMany(values: ReadonlyArray<typeof place.$inferInsert>) {
    if (values.length === 0) return Promise.resolve([]);
    return db
      .insert(place)
      .values([...values])
      .onConflictDoNothing()
      .returning();
  },

  async update(args: Scope & { id: string; patch: Partial<typeof place.$inferInsert> }) {
    const [row] = await db
      .update(place)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(place.organizationId, args.organizationId), eq(place.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(place)
      .where(and(eq(place.organizationId, args.organizationId), eq(place.id, args.id)))
      .returning({ id: place.id });
    return row ?? null;
  },
};

export const parameterService = {
  async list(args: Scope & { limit: number; cursor: string | null; includeInactive: boolean }) {
    const filters = [eq(parameterDefinition.organizationId, args.organizationId)];
    if (!args.includeInactive) filters.push(eq(parameterDefinition.isActive, true));
    if (args.cursor !== null) {
      filters.push(lt(parameterDefinition.createdAt, new Date(args.cursor)));
    }
    const rows = await db
      .select()
      .from(parameterDefinition)
      .where(and(...filters))
      .orderBy(asc(parameterDefinition.sortOrder), desc(parameterDefinition.createdAt))
      .limit(args.limit + 1);
    return paged(rows, args.limit);
  },

  byIds(args: Scope & { ids: readonly string[] }) {
    if (args.ids.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(parameterDefinition)
      .where(
        and(
          eq(parameterDefinition.organizationId, args.organizationId),
          inArray(parameterDefinition.id, [...args.ids]),
        ),
      );
  },

  all(args: Scope) {
    return db
      .select()
      .from(parameterDefinition)
      .where(eq(parameterDefinition.organizationId, args.organizationId))
      .orderBy(asc(parameterDefinition.sortOrder));
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(parameterDefinition)
      .where(
        and(
          eq(parameterDefinition.organizationId, args.organizationId),
          eq(parameterDefinition.id, args.id),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async byKey(args: Scope & { key: string }) {
    const [row] = await db
      .select()
      .from(parameterDefinition)
      .where(
        and(
          eq(parameterDefinition.organizationId, args.organizationId),
          eq(parameterDefinition.key, args.key),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof parameterDefinition.$inferInsert) {
    const [row] = await db.insert(parameterDefinition).values(values).returning();
    return row ?? null;
  },

  async update(
    args: Scope & { id: string; patch: Partial<typeof parameterDefinition.$inferInsert> },
  ) {
    const [row] = await db
      .update(parameterDefinition)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(
          eq(parameterDefinition.organizationId, args.organizationId),
          eq(parameterDefinition.id, args.id),
        ),
      )
      .returning();
    return row ?? null;
  },

  valuesFor(args: Scope & { placeIds: readonly string[] }) {
    if (args.placeIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(placeParameterValue)
      .where(
        and(
          eq(placeParameterValue.organizationId, args.organizationId),
          inArray(placeParameterValue.placeId, [...args.placeIds]),
        ),
      );
  },

  /** Upsert on (table, definition): assigning a value twice is an edit, not a second row. */
  async assign(
    args: Scope & {
      placeId: string;
      entries: ReadonlyArray<{ definitionId: string; value: unknown }>;
    },
  ) {
    for (const entry of args.entries) {
      await db
        .insert(placeParameterValue)
        .values({
          id: crypto.randomUUID(),
          organizationId: args.organizationId,
          placeId: args.placeId,
          definitionId: entry.definitionId,
          value: entry.value,
        })
        .onConflictDoUpdate({
          target: [placeParameterValue.placeId, placeParameterValue.definitionId],
          set: { value: entry.value, updatedAt: new Date() },
        });
    }
  },
};
