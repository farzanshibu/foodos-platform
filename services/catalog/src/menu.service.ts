/**
 * SOT: menu-service, menu-queries, item-queries, modifier-queries, catalog-storage
 * WHAT   The only code that reads or writes the menu tree: menus, categories, items,
 *        variants, modifiers and their options.
 * WHY    Handlers hold rules, this holds storage. Every signature takes organizationId, so
 *        there is no function here that could be called without a tenant.
 * WHERE  services/catalog/src/menu.handlers.ts, services/catalog/src/combo.service.ts
 */
import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, lt } from "drizzle-orm";

import { db } from "./db";
import {
  menu,
  menuCategory,
  menuItem,
  menuItemVariant,
  menuModifier,
  menuModifierOption,
  taxRate,
} from "./schema";

type Scope = { organizationId: string };

function page<T extends { createdAt: Date }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
}

export const menuService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      restaurantId?: string;
      branchId?: string;
      id?: string;
    },
  ) {
    const filters = [eq(menu.organizationId, args.organizationId)];
    if (args.restaurantId !== undefined) filters.push(eq(menu.restaurantId, args.restaurantId));
    if (args.branchId !== undefined) filters.push(eq(menu.branchId, args.branchId));
    if (args.id !== undefined) filters.push(eq(menu.id, args.id));
    if (args.cursor !== null) filters.push(lt(menu.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(menu)
      .where(and(...filters))
      .orderBy(desc(menu.createdAt))
      .limit(args.limit + 1);
    return page(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(menu)
      .where(and(eq(menu.organizationId, args.organizationId), eq(menu.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof menu.$inferInsert) {
    const [row] = await db.insert(menu).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof menu.$inferInsert> }) {
    const [row] = await db
      .update(menu)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(menu.organizationId, args.organizationId), eq(menu.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(menu)
      .where(and(eq(menu.organizationId, args.organizationId), eq(menu.id, args.id)))
      .returning({ id: menu.id });
    return row ?? null;
  },
};

export const categoryService = {
  async list(args: Scope & { limit: number; cursor: string | null; menuId?: string; id?: string }) {
    const filters = [eq(menuCategory.organizationId, args.organizationId)];
    if (args.menuId !== undefined) filters.push(eq(menuCategory.menuId, args.menuId));
    if (args.id !== undefined) filters.push(eq(menuCategory.id, args.id));
    if (args.cursor !== null) filters.push(lt(menuCategory.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(menuCategory)
      .where(and(...filters))
      .orderBy(asc(menuCategory.sortOrder), desc(menuCategory.createdAt))
      .limit(args.limit + 1);
    return page(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(menuCategory)
      .where(
        and(eq(menuCategory.organizationId, args.organizationId), eq(menuCategory.id, args.id)),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Every category in one menu, unpaged. The importer has to know the whole set before it
   * can tell a manager that "Deserts" is not a section - a page of it would let a row that
   * names a real category be rejected for being on the wrong page.
   */
  allIn(args: Scope & { menuId: string }) {
    return db
      .select()
      .from(menuCategory)
      .where(
        and(
          eq(menuCategory.organizationId, args.organizationId),
          eq(menuCategory.menuId, args.menuId),
        ),
      )
      .orderBy(asc(menuCategory.sortOrder));
  },

  async itemCounts(args: Scope & { categoryIds: readonly string[] }) {
    if (args.categoryIds.length === 0) return new Map<string, number>();
    const rows = await db
      .select({ categoryId: menuItem.categoryId, value: count() })
      .from(menuItem)
      .where(
        and(
          eq(menuItem.organizationId, args.organizationId),
          inArray(menuItem.categoryId, [...args.categoryIds]),
        ),
      )
      .groupBy(menuItem.categoryId);
    return new Map(rows.map((row) => [row.categoryId, row.value]));
  },

  async create(values: typeof menuCategory.$inferInsert) {
    const [row] = await db.insert(menuCategory).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof menuCategory.$inferInsert> }) {
    const [row] = await db
      .update(menuCategory)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(eq(menuCategory.organizationId, args.organizationId), eq(menuCategory.id, args.id)),
      )
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(menuCategory)
      .where(
        and(eq(menuCategory.organizationId, args.organizationId), eq(menuCategory.id, args.id)),
      )
      .returning({ id: menuCategory.id });
    return row ?? null;
  },
};

export const itemService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      menuId?: string;
      categoryId?: string;
      id?: string;
      search?: string;
      availableOnly: boolean;
    },
  ) {
    const filters = [eq(menuItem.organizationId, args.organizationId)];
    if (args.menuId !== undefined) filters.push(eq(menuItem.menuId, args.menuId));
    if (args.categoryId !== undefined) filters.push(eq(menuItem.categoryId, args.categoryId));
    if (args.id !== undefined) filters.push(eq(menuItem.id, args.id));
    if (args.search !== undefined) filters.push(ilike(menuItem.name, `%${args.search}%`));
    if (args.availableOnly) filters.push(eq(menuItem.isAvailable, true));
    if (args.cursor !== null) filters.push(lt(menuItem.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(menuItem)
      .where(and(...filters))
      .orderBy(asc(menuItem.sortOrder), desc(menuItem.createdAt))
      .limit(args.limit + 1);
    return page(rows, args.limit);
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(menuItem)
      .where(and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  byIds(args: Scope & { ids: readonly string[] }) {
    if (args.ids.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(menuItem)
      .where(
        and(eq(menuItem.organizationId, args.organizationId), inArray(menuItem.id, [...args.ids])),
      );
  },

  /**
   * Every item in one menu, unpaged. Both the exporter and the importer need the whole menu:
   * an import that matched against one page would create a duplicate of every dish on the
   * next one.
   */
  allIn(args: Scope & { menuId: string }) {
    return db
      .select()
      .from(menuItem)
      .where(
        and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.menuId, args.menuId)),
      )
      .orderBy(asc(menuItem.sortOrder), asc(menuItem.name));
  },

  /**
   * The whole import, or none of it. Every row was validated before this is called, so the
   * transaction is not there to catch a bad row - it is there so that a connection dropped
   * halfway through cannot leave a menu half-replaced, which is indistinguishable from an
   * importer that silently drops rows.
   */
  applyImport(
    args: Scope & {
      creates: ReadonlyArray<typeof menuItem.$inferInsert>;
      updates: ReadonlyArray<{ id: string; patch: Partial<typeof menuItem.$inferInsert> }>;
    },
  ) {
    return db.transaction(async (tx) => {
      if (args.creates.length > 0) await tx.insert(menuItem).values([...args.creates]);
      for (const row of args.updates) {
        await tx
          .update(menuItem)
          .set({ ...row.patch, updatedAt: new Date() })
          .where(and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.id, row.id)));
      }
      return args.creates.length + args.updates.length;
    });
  },

  async countIn(args: Scope & { menuId: string }) {
    const [row] = await db
      .select({ value: count() })
      .from(menuItem)
      .where(
        and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.menuId, args.menuId)),
      );
    return row?.value ?? 0;
  },

  async create(values: typeof menuItem.$inferInsert) {
    const [row] = await db.insert(menuItem).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof menuItem.$inferInsert> }) {
    const [row] = await db
      .update(menuItem)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.id, args.id)))
      .returning();
    return row ?? null;
  },

  async updateMany(
    args: Scope & { ids: readonly string[]; patch: Partial<typeof menuItem.$inferInsert> },
  ) {
    if (args.ids.length === 0) return 0;
    const rows = await db
      .update(menuItem)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(eq(menuItem.organizationId, args.organizationId), inArray(menuItem.id, [...args.ids])),
      )
      .returning({ id: menuItem.id });
    return rows.length;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(menuItem)
      .where(and(eq(menuItem.organizationId, args.organizationId), eq(menuItem.id, args.id)))
      .returning({ id: menuItem.id });
    return row ?? null;
  },

  variantsFor(args: Scope & { itemIds: readonly string[] }) {
    if (args.itemIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(menuItemVariant)
      .where(
        and(
          eq(menuItemVariant.organizationId, args.organizationId),
          inArray(menuItemVariant.itemId, [...args.itemIds]),
        ),
      )
      .orderBy(asc(menuItemVariant.sortOrder));
  },

  async replaceVariants(
    args: Scope & { itemId: string; rows: ReadonlyArray<typeof menuItemVariant.$inferInsert> },
  ) {
    await db
      .delete(menuItemVariant)
      .where(
        and(
          eq(menuItemVariant.organizationId, args.organizationId),
          eq(menuItemVariant.itemId, args.itemId),
        ),
      );
    if (args.rows.length > 0) await db.insert(menuItemVariant).values([...args.rows]);
  },

  async variantById(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(menuItemVariant)
      .where(
        and(
          eq(menuItemVariant.organizationId, args.organizationId),
          eq(menuItemVariant.id, args.id),
        ),
      )
      .limit(1);
    return row ?? null;
  },
};

export const modifierService = {
  async list(args: Scope & { limit: number; cursor: string | null; itemId?: string; id?: string }) {
    const filters = [eq(menuModifier.organizationId, args.organizationId)];
    if (args.itemId !== undefined) filters.push(eq(menuModifier.itemId, args.itemId));
    if (args.id !== undefined) filters.push(eq(menuModifier.id, args.id));
    if (args.cursor !== null) filters.push(lt(menuModifier.createdAt, new Date(args.cursor)));
    const rows = await db
      .select()
      .from(menuModifier)
      .where(and(...filters))
      .orderBy(asc(menuModifier.sortOrder), desc(menuModifier.createdAt))
      .limit(args.limit + 1);
    return page(rows, args.limit);
  },

  async forItems(args: Scope & { itemIds: readonly string[] }) {
    if (args.itemIds.length === 0) return { modifiers: [], options: [] };
    const modifiers = await db
      .select()
      .from(menuModifier)
      .where(
        and(
          eq(menuModifier.organizationId, args.organizationId),
          inArray(menuModifier.itemId, [...args.itemIds]),
        ),
      )
      .orderBy(asc(menuModifier.sortOrder));
    const ids = modifiers.map((row) => row.id);
    const options =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(menuModifierOption)
            .where(
              and(
                eq(menuModifierOption.organizationId, args.organizationId),
                inArray(menuModifierOption.modifierId, ids),
              ),
            )
            .orderBy(asc(menuModifierOption.sortOrder));
    return { modifiers, options };
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(menuModifier)
      .where(
        and(eq(menuModifier.organizationId, args.organizationId), eq(menuModifier.id, args.id)),
      )
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof menuModifier.$inferInsert) {
    const [row] = await db.insert(menuModifier).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof menuModifier.$inferInsert> }) {
    const [row] = await db
      .update(menuModifier)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(
        and(eq(menuModifier.organizationId, args.organizationId), eq(menuModifier.id, args.id)),
      )
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(menuModifier)
      .where(
        and(eq(menuModifier.organizationId, args.organizationId), eq(menuModifier.id, args.id)),
      )
      .returning({ id: menuModifier.id });
    return row ?? null;
  },

  async replaceOptions(
    args: Scope & {
      modifierId: string;
      rows: ReadonlyArray<typeof menuModifierOption.$inferInsert>;
    },
  ) {
    await db
      .delete(menuModifierOption)
      .where(
        and(
          eq(menuModifierOption.organizationId, args.organizationId),
          eq(menuModifierOption.modifierId, args.modifierId),
        ),
      );
    if (args.rows.length > 0) await db.insert(menuModifierOption).values([...args.rows]);
  },
};

export const taxService = {
  async byIds(args: Scope & { ids: readonly string[] }) {
    if (args.ids.length === 0) return new Map<string, number>();
    const rows = await db
      .select()
      .from(taxRate)
      .where(
        and(eq(taxRate.organizationId, args.organizationId), inArray(taxRate.id, [...args.ids])),
      );
    return new Map(rows.map((row) => [row.id, Number(row.percent)]));
  },
};
