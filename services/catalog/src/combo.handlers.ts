/**
 * SOT: combo-handlers, combo-crud, combo-availability
 * WHAT   Business rules for combos: creating them, editing their pick-groups, and taking one
 *        off the menu without erasing it from last week's receipts.
 * WHY    The pricing itself is in pricing.ts and is pure; what belongs here is everything the
 *        engine is not allowed to assume - that the items in a group exist, belong to this
 *        organisation, and are still on a menu the restaurant owns.
 * WHERE  services/catalog/src/combo.service.ts, services/catalog/src/pricing.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import { comboService, toComboDef } from "./combo.service";
import { itemService } from "./menu.service";
import { comboDisplayHint } from "./pricing";
import type { ComboRow } from "./schema";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

type GroupInput = {
  name: string;
  minSelections: number;
  maxSelections?: number | null | undefined;
  sortOrder: number;
  items: ReadonlyArray<{
    itemId: string;
    variantId?: string | null | undefined;
    sortOrder: number;
  }>;
};

/**
 * A combo may only bundle items this organisation owns. Without this a group could name any
 * item id at all, and the pricing engine would happily price something from another tenant's
 * menu - the engine trusts what it is handed, which is exactly why the handler must not.
 */
async function assertItemsOwned(organizationId: string, groups: readonly GroupInput[]) {
  const itemIds = [...new Set(groups.flatMap((group) => group.items.map((row) => row.itemId)))];
  const owned = await itemService.byIds({ organizationId, ids: itemIds });
  if (owned.length !== itemIds.length) {
    throw new ServiceError("NOT_FOUND", "One of the items in this combo does not exist.");
  }
  for (const group of groups) {
    for (const entry of group.items) {
      if (entry.variantId === undefined || entry.variantId === null) continue;
      const variant = await itemService.variantById({ organizationId, id: entry.variantId });
      if (variant === null || variant.itemId !== entry.itemId) {
        throw new ServiceError("INVALID_INPUT", "A variant in this combo belongs to another item.");
      }
    }
  }
}

const normaliseGroups = (groups: readonly GroupInput[]) =>
  groups.map((group) => ({
    name: group.name,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections ?? null,
    sortOrder: group.sortOrder,
    items: group.items.map((entry) => ({
      itemId: entry.itemId,
      variantId: entry.variantId ?? null,
      sortOrder: entry.sortOrder,
    })),
  }));

/** Reads a combo back with its groups and the display hint a menu card renders. */
async function loadCombo(organizationId: string, id: string) {
  const row = await comboService.byId({ organizationId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Combo not found.");
  return decorateCombo(organizationId, [row]).then((rows) => {
    const [only] = rows;
    if (only === undefined) throw new ServiceError("INTERNAL", "The combo could not be read.");
    return only;
  });
}

async function decorateCombo(organizationId: string, rows: readonly ComboRow[]) {
  const structure = await comboService.structureFor({
    organizationId,
    comboIds: rows.map((row) => row.id),
  });
  return rows.map((row) => {
    const definition = toComboDef(row, structure.groups, structure.members);
    return {
      id: row.id,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      name: row.name,
      description: row.description,
      imageUrl: row.imageUrl,
      pricingMode: definition.pricingMode,
      flatRatePaise: row.flatRatePaise,
      flatPercentage: definition.flatPercentage,
      taxRateId: row.taxRateId,
      isAvailable: row.isAvailable,
      sortOrder: row.sortOrder,
      groups: definition.groups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: 0,
        items: [...group.allowed.values()].map((option) => ({
          itemId: option.itemId,
          variantId: option.variantId,
          name: option.name,
          variantName: option.variantName,
          unitPricePaise: option.unitPricePaise,
          isAvailable: true,
          sortOrder: 0,
        })),
      })),
      hint: comboDisplayHint(definition),
      createdAt: row.createdAt,
    };
  });
}

export const comboHandlers = [
  handlerFor("combo", "read", async ({ ctx, input }) => {
    const result = await comboService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      availableOnly: input.availableOnly,
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.branchId, "branchId"),
      ...set(input.id, "id"),
    });
    return { items: await decorateCombo(ctx.orgId, result.items), nextCursor: result.nextCursor };
  }),

  handlerFor("combo", "create", async ({ ctx, input }) => {
    await assertItemsOwned(ctx.orgId, input.groups);
    const id = crypto.randomUUID();
    const created = await comboService.create({
      id,
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      pricingMode: input.pricingMode,
      flatRatePaise: input.flatRatePaise ?? null,
      flatPercentage:
        input.flatPercentage === undefined || input.flatPercentage === null
          ? null
          : String(input.flatPercentage),
      taxRateId: input.taxRateId ?? null,
      ...set(input.sortOrder, "sortOrder"),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The combo was not created.");
    await comboService.replaceGroups({
      organizationId: ctx.orgId,
      comboId: id,
      groups: normaliseGroups(input.groups),
    });
    return loadCombo(ctx.orgId, id);
  }),

  handlerFor("combo", "update", async ({ ctx, input }) => {
    if (input.groups !== undefined) await assertItemsOwned(ctx.orgId, input.groups);
    const updated = await comboService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.description, "description"),
        ...set(input.imageUrl, "imageUrl"),
        ...set(input.pricingMode, "pricingMode"),
        ...set(input.flatRatePaise, "flatRatePaise"),
        ...set(input.taxRateId, "taxRateId"),
        ...set(input.sortOrder, "sortOrder"),
        ...(input.flatPercentage === undefined
          ? {}
          : {
              flatPercentage: input.flatPercentage === null ? null : String(input.flatPercentage),
            }),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Combo not found.");
    if (input.groups !== undefined) {
      await comboService.replaceGroups({
        organizationId: ctx.orgId,
        comboId: input.id,
        groups: normaliseGroups(input.groups),
      });
    }
    return loadCombo(ctx.orgId, input.id);
  }),

  handlerFor("combo", "delete", async ({ ctx, input }) => {
    const removed = await comboService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Combo not found.");
    return removed;
  }),

  /**
   * Availability, not deletion. Orders keep their own snapshots, so a combo taken off the
   * menu today still renders correctly on a receipt from last week.
   */
  handlerFor("combo", "manage", async ({ ctx, input }) => {
    const updated = await comboService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { isAvailable: input.isAvailable },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Combo not found.");
    return loadCombo(ctx.orgId, input.id);
  }),
];
