/**
 * SOT: item-handlers, modifier-handlers, bulk-menu-edit, menu-import-export
 * WHAT   Business rules for dishes, their variants, and the modifier groups hung off them.
 * WHY    This is where a restaurant spends its time, so the bulk verbs matter as much as the
 *        single ones: setting fifty items unavailable at once is the difference between the
 *        product being usable during a rush and not.
 * HOW    `export` and `import` are one CSV format in two directions - export a menu, hand the
 *        same file back, and nothing changes. The decisions an import makes live in
 *        menu-import.ts; this file only routes to them.
 * WHERE  services/catalog/src/menu.service.ts, services/catalog/src/menu-import.ts
 */
import "server-only";

import { type InputOf, ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";
import { categoryService, itemService, modifierService, taxService } from "./menu.service";
import { menuCsv } from "./menu-csv";
import { runMenuImport } from "./menu-import";
import type {
  MenuItemRow,
  MenuItemVariantRow,
  MenuModifierOptionRow,
  MenuModifierRow,
} from "./schema";

const DIETARY_LABELS = [
  "vegetarian",
  "vegan",
  "halal",
  "jain",
  "gluten_free",
  "egg_free",
  "contains_alcohol",
] as const;
type DietaryLabel = (typeof DIETARY_LABELS)[number];

/** Derived from the contract, never restated: a hand-written copy is a copy that drifts. */
type ManageInput = InputOf<"menuItem", "manage">;

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const asDietary = (values: readonly string[]): DietaryLabel[] =>
  values.flatMap((value) => DIETARY_LABELS.filter((candidate) => candidate === value));

const toVariantDto = (row: MenuItemVariantRow) => ({
  id: row.id,
  name: row.name,
  pricePaise: row.pricePaise,
  isDefault: row.isDefault,
  sortOrder: row.sortOrder,
});

const toOptionDto = (row: MenuModifierOptionRow) => ({
  id: row.id,
  name: row.name,
  priceDeltaPaise: row.priceDeltaPaise,
  isDefault: row.isDefault,
  isAvailable: row.isAvailable,
  sortOrder: row.sortOrder,
});

const toModifierDto = (row: MenuModifierRow, options: readonly MenuModifierOptionRow[]) => ({
  id: row.id,
  itemId: row.itemId,
  name: row.name,
  isRequired: row.isRequired,
  minSelections: row.minSelections,
  maxSelections: row.maxSelections,
  sortOrder: row.sortOrder,
  options: options.filter((option) => option.modifierId === row.id).map(toOptionDto),
});

function toItemDto(
  row: MenuItemRow,
  variants: readonly MenuItemVariantRow[],
  modifiers: readonly MenuModifierRow[],
  options: readonly MenuModifierOptionRow[],
  taxPercent: number | null,
) {
  return {
    id: row.id,
    menuId: row.menuId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    pricePaise: row.pricePaise,
    discountPricePaise: row.discountPricePaise,
    sku: row.sku,
    prepTimeMinutes: row.prepTimeMinutes,
    calories: row.calories,
    ingredients: row.ingredients,
    allergens: row.allergens,
    spiceLevel: row.spiceLevel,
    dietaryLabels: asDietary(row.dietaryLabels),
    isAvailable: row.isAvailable,
    availableFrom: row.availableFrom === null ? null : row.availableFrom.slice(0, 5),
    availableTo: row.availableTo === null ? null : row.availableTo.slice(0, 5),
    taxRateId: row.taxRateId,
    taxPercent,
    sortOrder: row.sortOrder,
    variants: variants.filter((variant) => variant.itemId === row.id).map(toVariantDto),
    modifiers: modifiers
      .filter((modifier) => modifier.itemId === row.id)
      .map((modifier) => toModifierDto(modifier, options)),
    createdAt: row.createdAt,
  };
}

/** Loads everything hanging off a set of items in one pass, so a list is not N+1 queries. */
async function decorate(organizationId: string, rows: readonly MenuItemRow[]) {
  const itemIds = rows.map((row) => row.id);
  const [variants, modifierSet, taxes] = await Promise.all([
    itemService.variantsFor({ organizationId, itemIds }),
    modifierService.forItems({ organizationId, itemIds }),
    taxService.byIds({
      organizationId,
      ids: rows.flatMap((row) => (row.taxRateId === null ? [] : [row.taxRateId])),
    }),
  ]);
  return rows.map((row) =>
    toItemDto(
      row,
      variants,
      modifierSet.modifiers,
      modifierSet.options,
      row.taxRateId === null ? null : (taxes.get(row.taxRateId) ?? null),
    ),
  );
}

async function loadOne(organizationId: string, id: string) {
  const row = await itemService.byId({ organizationId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Item not found.");
  const [decorated] = await decorate(organizationId, [row]);
  if (decorated === undefined) throw new ServiceError("INTERNAL", "The item could not be read.");
  return decorated;
}

const itemPatch = (input: {
  name?: string | undefined;
  description?: string | null | undefined;
  imageUrl?: string | null | undefined;
  pricePaise?: number | undefined;
  discountPricePaise?: number | null | undefined;
  sku?: string | null | undefined;
  prepTimeMinutes?: number | null | undefined;
  calories?: number | null | undefined;
  ingredients?: string | null | undefined;
  allergens?: string[] | undefined;
  spiceLevel?: number | null | undefined;
  dietaryLabels?: string[] | undefined;
  isAvailable?: boolean | undefined;
  availableFrom?: string | null | undefined;
  availableTo?: string | null | undefined;
  taxRateId?: string | null | undefined;
  sortOrder?: number | undefined;
}) => ({
  ...set(input.name, "name"),
  ...set(input.description, "description"),
  ...set(input.imageUrl, "imageUrl"),
  ...set(input.pricePaise, "pricePaise"),
  ...set(input.discountPricePaise, "discountPricePaise"),
  ...set(input.sku, "sku"),
  ...set(input.prepTimeMinutes, "prepTimeMinutes"),
  ...set(input.calories, "calories"),
  ...set(input.ingredients, "ingredients"),
  ...set(input.allergens, "allergens"),
  ...set(input.spiceLevel, "spiceLevel"),
  ...set(input.dietaryLabels, "dietaryLabels"),
  ...set(input.isAvailable, "isAvailable"),
  ...set(input.availableFrom, "availableFrom"),
  ...set(input.availableTo, "availableTo"),
  ...set(input.taxRateId, "taxRateId"),
  ...set(input.sortOrder, "sortOrder"),
});

export const itemHandlers = [
  handlerFor("menuItem", "read", async ({ ctx, input }) => {
    const result = await itemService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      availableOnly: input.availableOnly,
      ...set(input.menuId, "menuId"),
      ...set(input.categoryId, "categoryId"),
      ...set(input.id, "id"),
      ...set(input.search, "search"),
    });
    return {
      items: await decorate(ctx.orgId, result.items),
      nextCursor: result.nextCursor,
    };
  }),

  handlerFor("menuItem", "create", async ({ ctx, input }) => {
    const category = await categoryService.byId({
      organizationId: ctx.orgId,
      id: input.categoryId,
    });
    if (category === null) throw new ServiceError("NOT_FOUND", "Category not found.");
    if (category.menuId !== input.menuId) {
      throw new ServiceError("INVALID_INPUT", "That category belongs to a different menu.");
    }
    const id = crypto.randomUUID();
    const created = await itemService.create({
      id,
      organizationId: ctx.orgId,
      menuId: input.menuId,
      categoryId: input.categoryId,
      name: input.name,
      pricePaise: input.pricePaise,
      ...itemPatch(input),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The item was not created.");
    if (input.variants !== undefined) {
      await itemService.replaceVariants({
        organizationId: ctx.orgId,
        itemId: id,
        rows: input.variants.map((variant) => ({
          id: crypto.randomUUID(),
          organizationId: ctx.orgId,
          itemId: id,
          name: variant.name,
          pricePaise: variant.pricePaise,
          isDefault: variant.isDefault,
          sortOrder: variant.sortOrder,
        })),
      });
    }
    return loadOne(ctx.orgId, id);
  }),

  handlerFor("menuItem", "update", async ({ ctx, input }) => {
    const updated = await itemService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { ...itemPatch(input), ...set(input.categoryId, "categoryId") },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Item not found.");
    if (input.variants !== undefined) {
      await itemService.replaceVariants({
        organizationId: ctx.orgId,
        itemId: input.id,
        rows: input.variants.map((variant) => ({
          id: variant.id ?? crypto.randomUUID(),
          organizationId: ctx.orgId,
          itemId: input.id,
          name: variant.name,
          pricePaise: variant.pricePaise,
          isDefault: variant.isDefault,
          sortOrder: variant.sortOrder,
        })),
      });
    }
    return loadOne(ctx.orgId, input.id);
  }),

  handlerFor("menuItem", "delete", async ({ ctx, input }) => {
    const removed = await itemService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Item not found.");
    return removed;
  }),

  handlerFor("menuItem", "manage", async ({ ctx, input }) => bulk(ctx.orgId, input)),
];

/**
 * The bulk verbs. Every branch answers with the same `{ changed, document }` shape, so the
 * caller never has to know which action it asked for to read the reply.
 */
type BulkResult = {
  changed: number;
  document: string | null;
  report: Awaited<ReturnType<typeof runMenuImport>>["report"] | null;
};

const bulkOnly = (changed: number): BulkResult => ({ changed, document: null, report: null });

async function adjustPrice(
  organizationId: string,
  ids: readonly string[],
  deltaPaise: number | undefined,
  percent: number | undefined,
): Promise<BulkResult> {
  if ((deltaPaise === undefined) === (percent === undefined)) {
    throw new ServiceError("INVALID_INPUT", "Give either a delta or a percentage, not both.");
  }
  const rows = await itemService.byIds({ organizationId, ids });
  let changed = 0;
  for (const row of rows) {
    const next =
      deltaPaise !== undefined
        ? row.pricePaise + deltaPaise
        : Math.floor((row.pricePaise * (100 + (percent ?? 0)) + 50) / 100);
    if (next < 0) {
      throw new ServiceError("INVALID_INPUT", `That change would price "${row.name}" below zero.`);
    }
    await itemService.update({ organizationId, id: row.id, patch: { pricePaise: next } });
    changed += 1;
  }
  return bulkOnly(changed);
}

/** A duplicate arrives unavailable: a half-edited copy on a live menu is somebody's mistake. */
async function duplicateItem(organizationId: string, id: string): Promise<BulkResult> {
  const row = await itemService.byId({ organizationId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Item not found.");
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = row;
  const copy = await itemService.create({
    ...rest,
    id: crypto.randomUUID(),
    name: `${row.name} (copy)`,
    isAvailable: false,
  });
  return bulkOnly(copy === null ? 0 : 1);
}

async function reorderItems(organizationId: string, ids: readonly string[]): Promise<BulkResult> {
  let changed = 0;
  for (const [index, id] of ids.entries()) {
    const updated = await itemService.update({ organizationId, id, patch: { sortOrder: index } });
    if (updated !== null) changed += 1;
  }
  return bulkOnly(changed);
}

/**
 * The menu as the spreadsheet a restaurant already thinks in. It is CSV rather than JSON
 * because the file has to survive being opened, edited and saved by somebody who has never
 * heard of JSON, and it writes the item's own `id` in the first column so that handing the
 * file straight back updates those dishes in place instead of adding a second copy of each.
 */
async function exportMenu(organizationId: string, menuId: string): Promise<BulkResult> {
  const [items, categories] = await Promise.all([
    itemService.allIn({ organizationId, menuId }),
    categoryService.allIn({ organizationId, menuId }),
  ]);
  const sectionNames = new Map(categories.map((row) => [row.id, row.name]));
  const document = menuCsv(
    items.map((row) => ({
      id: row.id,
      categoryName: sectionNames.get(row.categoryId) ?? "",
      name: row.name,
      description: row.description,
      pricePaise: row.pricePaise,
      discountPricePaise: row.discountPricePaise,
      sku: row.sku,
      prepTimeMinutes: row.prepTimeMinutes,
      calories: row.calories,
      spiceLevel: row.spiceLevel,
      dietaryLabels: row.dietaryLabels,
      allergens: row.allergens,
      isAvailable: row.isAvailable,
    })),
  );
  return { changed: items.length, document, report: null };
}

/**
 * The bulk verbs. Every branch answers with the same `{ changed, document }` shape, so the
 * caller never has to know which action it asked for to read the reply.
 */
async function bulk(organizationId: string, input: ManageInput): Promise<BulkResult> {
  switch (input.action) {
    case "set_availability":
      return bulkOnly(
        await itemService.updateMany({
          organizationId,
          ids: input.ids,
          patch: { isAvailable: input.isAvailable },
        }),
      );
    case "set_category": {
      const category = await categoryService.byId({ organizationId, id: input.categoryId });
      if (category === null) throw new ServiceError("NOT_FOUND", "Category not found.");
      return bulkOnly(
        await itemService.updateMany({
          organizationId,
          ids: input.ids,
          patch: { categoryId: input.categoryId, menuId: category.menuId },
        }),
      );
    }
    case "adjust_price":
      return adjustPrice(organizationId, input.ids, input.deltaPaise, input.percent);
    case "duplicate":
      return duplicateItem(organizationId, input.id);
    case "reorder":
      return reorderItems(organizationId, input.ids);
    case "export":
      return exportMenu(organizationId, input.menuId);
    case "import": {
      /**
       * No `default` on this switch: the union comes from the contract, so a new action added
       * there stops compiling here until somebody decides what it does.
       */
      const { changed, report } = await runMenuImport(organizationId, input);
      return { changed, document: null, report };
    }
  }
}

export const modifierHandlers = [
  handlerFor("menuModifier", "read", async ({ ctx, input }) => {
    const result = await modifierService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.itemId, "itemId"),
      ...set(input.id, "id"),
    });
    const options = await modifierService.forItems({
      organizationId: ctx.orgId,
      itemIds: [...new Set(result.items.map((row) => row.itemId))],
    });
    return {
      items: result.items.map((row) => toModifierDto(row, options.options)),
      nextCursor: result.nextCursor,
    };
  }),

  handlerFor("menuModifier", "create", async ({ ctx, input }) => {
    const item = await itemService.byId({ organizationId: ctx.orgId, id: input.itemId });
    if (item === null) throw new ServiceError("NOT_FOUND", "Item not found.");
    const id = crypto.randomUUID();
    const created = await modifierService.create({
      id,
      organizationId: ctx.orgId,
      itemId: input.itemId,
      name: input.name,
      isRequired: input.isRequired,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections ?? null,
      sortOrder: input.sortOrder,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The modifier was not created.");
    await modifierService.replaceOptions({
      organizationId: ctx.orgId,
      modifierId: id,
      rows: input.options.map((option) => ({
        id: crypto.randomUUID(),
        organizationId: ctx.orgId,
        modifierId: id,
        name: option.name,
        priceDeltaPaise: option.priceDeltaPaise,
        isDefault: option.isDefault,
        isAvailable: option.isAvailable,
        sortOrder: option.sortOrder,
      })),
    });
    const loaded = await modifierService.forItems({
      organizationId: ctx.orgId,
      itemIds: [input.itemId],
    });
    return toModifierDto(created, loaded.options);
  }),

  handlerFor("menuModifier", "update", async ({ ctx, input }) => {
    const updated = await modifierService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.isRequired, "isRequired"),
        ...set(input.minSelections, "minSelections"),
        ...set(input.maxSelections, "maxSelections"),
        ...set(input.sortOrder, "sortOrder"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Modifier not found.");
    if (input.options !== undefined) {
      await modifierService.replaceOptions({
        organizationId: ctx.orgId,
        modifierId: input.id,
        rows: input.options.map((option) => ({
          id: option.id ?? crypto.randomUUID(),
          organizationId: ctx.orgId,
          modifierId: input.id,
          name: option.name,
          priceDeltaPaise: option.priceDeltaPaise,
          isDefault: option.isDefault,
          isAvailable: option.isAvailable,
          sortOrder: option.sortOrder,
        })),
      });
    }
    const loaded = await modifierService.forItems({
      organizationId: ctx.orgId,
      itemIds: [updated.itemId],
    });
    return toModifierDto(updated, loaded.options);
  }),

  handlerFor("menuModifier", "delete", async ({ ctx, input }) => {
    const removed = await modifierService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Modifier not found.");
    return removed;
  }),
];
