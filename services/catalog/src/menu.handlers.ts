/**
 * SOT: menu-handlers, category-handlers
 * WHAT   Business rules for menus and their categories.
 * WHY    A menu is the one thing a restaurant owner edits every week, so the rules that make
 *        it safe live here rather than being remembered at each call site: exactly one default
 *        menu per restaurant, and a category that still holds items cannot be deleted out
 *        from under them.
 * WHERE  services/catalog/src/menu.service.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import { categoryService, itemService, menuService } from "./menu.service";
import type { MenuCategoryRow, MenuRow } from "./schema";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const toMenuDto = (row: MenuRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  branchId: row.branchId,
  name: row.name,
  description: row.description,
  isDefault: row.isDefault,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt,
});

const toCategoryDto = (row: MenuCategoryRow, itemCount: number) => ({
  id: row.id,
  menuId: row.menuId,
  name: row.name,
  description: row.description,
  imageUrl: row.imageUrl,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  itemCount,
  createdAt: row.createdAt,
});

/**
 * "Default" is a property of the restaurant, not of the row being written: promoting one menu
 * has to demote the others, or a branch resolving its menu finds two and picks arbitrarily.
 */
async function clearOtherDefaults(args: {
  organizationId: string;
  restaurantId: string;
  keepId: string;
}) {
  const existing = await menuService.list({
    organizationId: args.organizationId,
    limit: 100,
    cursor: null,
    restaurantId: args.restaurantId,
  });
  for (const row of existing.items) {
    if (row.id === args.keepId || !row.isDefault) continue;
    await menuService.update({
      organizationId: args.organizationId,
      id: row.id,
      patch: { isDefault: false },
    });
  }
}

export const menuHandlers = [
  handlerFor("menu", "read", async ({ ctx, input }) => {
    const result = await menuService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.branchId, "branchId"),
      ...set(input.id, "id"),
    });
    return { items: result.items.map(toMenuDto), nextCursor: result.nextCursor };
  }),

  handlerFor("menu", "create", async ({ ctx, input }) => {
    const created = await menuService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      name: input.name,
      description: input.description ?? null,
      ...set(input.isDefault, "isDefault"),
      ...set(input.sortOrder, "sortOrder"),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The menu was not created.");
    if (created.isDefault) {
      await clearOtherDefaults({
        organizationId: ctx.orgId,
        restaurantId: created.restaurantId,
        keepId: created.id,
      });
    }
    return toMenuDto(created);
  }),

  handlerFor("menu", "update", async ({ ctx, input }) => {
    const updated = await menuService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.description, "description"),
        ...set(input.isDefault, "isDefault"),
        ...set(input.isActive, "isActive"),
        ...set(input.sortOrder, "sortOrder"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Menu not found.");
    if (input.isDefault === true) {
      await clearOtherDefaults({
        organizationId: ctx.orgId,
        restaurantId: updated.restaurantId,
        keepId: updated.id,
      });
    }
    return toMenuDto(updated);
  }),

  handlerFor("menu", "delete", async ({ ctx, input }) => {
    const items = await itemService.countIn({ organizationId: ctx.orgId, menuId: input.id });
    if (items > 0) {
      throw new ServiceError(
        "CONFLICT",
        `This menu still has ${items} item${items === 1 ? "" : "s"}. Move or delete them first.`,
      );
    }
    const removed = await menuService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Menu not found.");
    return removed;
  }),
];

export const categoryHandlers = [
  handlerFor("menuCategory", "read", async ({ ctx, input }) => {
    const result = await categoryService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.menuId, "menuId"),
      ...set(input.id, "id"),
    });
    const counts = await categoryService.itemCounts({
      organizationId: ctx.orgId,
      categoryIds: result.items.map((row) => row.id),
    });
    return {
      items: result.items.map((row) => toCategoryDto(row, counts.get(row.id) ?? 0)),
      nextCursor: result.nextCursor,
    };
  }),

  handlerFor("menuCategory", "create", async ({ ctx, input }) => {
    const parent = await menuService.byId({ organizationId: ctx.orgId, id: input.menuId });
    if (parent === null) throw new ServiceError("NOT_FOUND", "Menu not found.");
    const created = await categoryService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      menuId: input.menuId,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      ...set(input.sortOrder, "sortOrder"),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The category was not created.");
    return toCategoryDto(created, 0);
  }),

  handlerFor("menuCategory", "update", async ({ ctx, input }) => {
    const updated = await categoryService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.description, "description"),
        ...set(input.imageUrl, "imageUrl"),
        ...set(input.isActive, "isActive"),
        ...set(input.sortOrder, "sortOrder"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Category not found.");
    const counts = await categoryService.itemCounts({
      organizationId: ctx.orgId,
      categoryIds: [updated.id],
    });
    return toCategoryDto(updated, counts.get(updated.id) ?? 0);
  }),

  handlerFor("menuCategory", "delete", async ({ ctx, input }) => {
    const counts = await categoryService.itemCounts({
      organizationId: ctx.orgId,
      categoryIds: [input.id],
    });
    const held = counts.get(input.id) ?? 0;
    if (held > 0) {
      throw new ServiceError(
        "CONFLICT",
        `This category still holds ${held} item${held === 1 ? "" : "s"}. Move them first.`,
      );
    }
    const removed = await categoryService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Category not found.");
    return removed;
  }),
];
