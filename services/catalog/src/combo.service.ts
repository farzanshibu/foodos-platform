/**
 * SOT: combo-service, combo-queries, combo-definition-loader
 * WHAT   The only code that reads or writes combos, their pick-groups and the items in them,
 *        plus the loader that turns a stored combo into the shape the pricing engine takes.
 * WHY    The engine is pure so it can be tested without a database; something still has to
 *        fetch the combo with the prices its items carry *right now*, and that is this file.
 *        A percentage combo priced from stale numbers is a percentage combo priced wrongly.
 * WHERE  services/catalog/src/pricing.ts, services/catalog/src/combo.handlers.ts
 */
import "server-only";

import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import { db } from "./db";
import type { ComboDef, ComboGroupDef, PricedItemRef } from "./pricing";
import { combo, comboGroup, comboGroupItem, menuItem, menuItemVariant } from "./schema";

type Scope = { organizationId: string };

export const comboService = {
  async list(
    args: Scope & {
      limit: number;
      cursor: string | null;
      restaurantId?: string;
      branchId?: string;
      id?: string;
      availableOnly: boolean;
    },
  ) {
    const filters = [eq(combo.organizationId, args.organizationId)];
    if (args.restaurantId !== undefined) filters.push(eq(combo.restaurantId, args.restaurantId));
    if (args.branchId !== undefined) filters.push(eq(combo.branchId, args.branchId));
    if (args.id !== undefined) filters.push(eq(combo.id, args.id));
    if (args.availableOnly) filters.push(eq(combo.isAvailable, true));
    if (args.cursor !== null) filters.push(lt(combo.createdAt, new Date(args.cursor)));

    const rows = await db
      .select()
      .from(combo)
      .where(and(...filters))
      .orderBy(asc(combo.sortOrder), desc(combo.createdAt))
      .limit(args.limit + 1);

    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null };
  },

  async byId(args: Scope & { id: string }) {
    const [row] = await db
      .select()
      .from(combo)
      .where(and(eq(combo.organizationId, args.organizationId), eq(combo.id, args.id)))
      .limit(1);
    return row ?? null;
  },

  async create(values: typeof combo.$inferInsert) {
    const [row] = await db.insert(combo).values(values).returning();
    return row ?? null;
  },

  async update(args: Scope & { id: string; patch: Partial<typeof combo.$inferInsert> }) {
    const [row] = await db
      .update(combo)
      .set({ ...args.patch, updatedAt: new Date() })
      .where(and(eq(combo.organizationId, args.organizationId), eq(combo.id, args.id)))
      .returning();
    return row ?? null;
  },

  async remove(args: Scope & { id: string }) {
    const [row] = await db
      .delete(combo)
      .where(and(eq(combo.organizationId, args.organizationId), eq(combo.id, args.id)))
      .returning({ id: combo.id });
    return row ?? null;
  },

  /** Groups and their members, replaced as a set: a partial edit is a combo nobody can price. */
  async replaceGroups(
    args: Scope & {
      comboId: string;
      groups: ReadonlyArray<{
        name: string;
        minSelections: number;
        maxSelections: number | null;
        sortOrder: number;
        items: ReadonlyArray<{ itemId: string; variantId: string | null; sortOrder: number }>;
      }>;
    },
  ) {
    await db
      .delete(comboGroup)
      .where(
        and(
          eq(comboGroup.organizationId, args.organizationId),
          eq(comboGroup.comboId, args.comboId),
        ),
      );
    for (const group of args.groups) {
      const groupId = crypto.randomUUID();
      await db.insert(comboGroup).values({
        id: groupId,
        organizationId: args.organizationId,
        comboId: args.comboId,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: group.sortOrder,
      });
      if (group.items.length === 0) continue;
      await db.insert(comboGroupItem).values(
        group.items.map((entry) => ({
          id: crypto.randomUUID(),
          organizationId: args.organizationId,
          groupId,
          itemId: entry.itemId,
          variantId: entry.variantId,
          sortOrder: entry.sortOrder,
        })),
      );
    }
  },

  /**
   * Every group and member of a set of combos, joined to the menu so each option carries the
   * price it has right now. Unavailable items are dropped here rather than filtered later:
   * an option nobody can order is not an option the engine should be able to price.
   */
  async structureFor(args: Scope & { comboIds: readonly string[] }) {
    if (args.comboIds.length === 0) return { groups: [], members: [] };
    const groups = await db
      .select()
      .from(comboGroup)
      .where(
        and(
          eq(comboGroup.organizationId, args.organizationId),
          inArray(comboGroup.comboId, [...args.comboIds]),
        ),
      )
      .orderBy(asc(comboGroup.sortOrder));

    const groupIds = groups.map((row) => row.id);
    const members =
      groupIds.length === 0
        ? []
        : await db
            .select({
              groupId: comboGroupItem.groupId,
              itemId: comboGroupItem.itemId,
              variantId: comboGroupItem.variantId,
              sortOrder: comboGroupItem.sortOrder,
              itemName: menuItem.name,
              itemPricePaise: menuItem.pricePaise,
              itemAvailable: menuItem.isAvailable,
              variantName: menuItemVariant.name,
              variantPricePaise: menuItemVariant.pricePaise,
            })
            .from(comboGroupItem)
            .innerJoin(menuItem, eq(menuItem.id, comboGroupItem.itemId))
            .leftJoin(menuItemVariant, eq(menuItemVariant.id, comboGroupItem.variantId))
            .where(
              and(
                eq(comboGroupItem.organizationId, args.organizationId),
                inArray(comboGroupItem.groupId, groupIds),
              ),
            )
            .orderBy(asc(comboGroupItem.sortOrder));

    return { groups, members };
  },
};

export type ComboMember = Awaited<ReturnType<typeof comboService.structureFor>>["members"][number];

export type ComboGroupRowWithCombo = Awaited<
  ReturnType<typeof comboService.structureFor>
>["groups"][number];

const optionKey = (itemId: string, variantId: string | null): string =>
  `${itemId}:${variantId ?? ""}`;

/** Turns stored rows into the pure shape the engine takes. No pricing decision happens here. */
export function toComboDef(
  row: typeof combo.$inferSelect,
  groups: readonly ComboGroupRowWithCombo[],
  members: readonly ComboMember[],
): ComboDef {
  const mine: ComboGroupDef[] = groups
    .filter((group) => group.comboId === row.id)
    .map((group) => {
      const allowed = new Map<string, PricedItemRef>();
      for (const member of members) {
        if (member.groupId !== group.id || !member.itemAvailable) continue;
        allowed.set(optionKey(member.itemId, member.variantId), {
          itemId: member.itemId,
          variantId: member.variantId,
          name: member.itemName,
          variantName: member.variantName,
          unitPricePaise: member.variantPricePaise ?? member.itemPricePaise,
        });
      }
      return {
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        allowed,
      };
    });

  return {
    id: row.id,
    name: row.name,
    pricingMode: row.pricingMode === "flat_percentage" ? "flat_percentage" : "flat_rate",
    flatRatePaise: row.flatRatePaise,
    flatPercentage: row.flatPercentage === null ? null : Number(row.flatPercentage),
    groups: mine,
  };
}
