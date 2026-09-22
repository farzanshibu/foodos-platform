/**
 * SOT: quote-handler, cart-pricing, server-authoritative-price, coupon-application
 * WHAT   Prices a cart. The only endpoint in the product that decides what anything costs.
 * WHY    A price the caller can send is a price the caller can choose, so there is no price
 *        field in the input and none is read from one. The orders service calls this over the
 *        bus instead of importing the catalogue, and the browser renders what comes back.
 * HOW    Line-level first - variants, modifiers and combos - then the order-level coupon, then
 *        tax. That order is fixed, and it is the reason a percentage coupon can never
 *        re-discount the parts inside a combo that was already priced as one unit.
 * WHERE  services/catalog/src/pricing.ts, services/orders
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import { comboService, toComboDef } from "./combo.service";
import { itemService, modifierService, taxService } from "./menu.service";
import { priceComboSelection } from "./pricing";

type ItemLine = {
  kind: "item";
  itemId: string;
  variantId?: string | undefined;
  quantity: number;
  modifiers: ReadonlyArray<{ modifierId: string; optionIds: readonly string[] }>;
  notes?: string | undefined;
};

type ComboLine = {
  kind: "combo";
  comboId: string;
  quantity: number;
  selections: ReadonlyArray<{
    groupId: string;
    itemId: string;
    variantId?: string | undefined;
    quantity: number;
  }>;
  notes?: string | undefined;
};

type PricedItemLine = {
  kind: "item";
  itemId: string;
  variantId: string | null;
  nameSnapshot: string;
  variantNameSnapshot: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  modifiers: Array<{
    modifierId: string;
    optionId: string;
    nameSnapshot: string;
    priceDeltaPaise: number;
  }>;
  taxPercent: number;
  taxPaise: number;
  notes: string | null;
};

type PricedComboLine = {
  kind: "combo";
  comboId: string;
  nameSnapshot: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  referencePricePaise: number;
  savingsPaise: number;
  taxPercent: number;
  taxPaise: number;
  notes: string | null;
  children: Array<{
    itemId: string;
    variantId: string | null;
    nameSnapshot: string;
    variantNameSnapshot: string | null;
    quantity: number;
    unitPriceSnapshotPaise: number;
    lineTotalPaise: 0;
  }>;
};

type ModifierCatalogue = Awaited<ReturnType<typeof modifierService.forItems>>;

/**
 * Walks the item's own modifier groups rather than the caller's list, so a group the item
 * requires cannot be skipped by simply not sending it. The caller's list is checked for
 * strays afterwards - a group the item does not have means somebody is holding a stale menu.
 */
function resolveModifiers(
  available: ModifierCatalogue,
  requested: ReadonlyArray<{ modifierId: string; optionIds: readonly string[] }>,
): { chosen: PricedItemLine["modifiers"]; modifiersPaise: number } {
  const chosen: PricedItemLine["modifiers"] = [];
  let modifiersPaise = 0;

  for (const group of available.modifiers) {
    const optionIds = requested.find((entry) => entry.modifierId === group.id)?.optionIds ?? [];
    if (group.isRequired && optionIds.length < Math.max(1, group.minSelections)) {
      throw new ServiceError("INVALID_INPUT", `"${group.name}" needs a choice.`);
    }
    if (group.maxSelections !== null && optionIds.length > group.maxSelections) {
      throw new ServiceError(
        "INVALID_INPUT",
        `"${group.name}": choose at most ${group.maxSelections}.`,
      );
    }
    for (const optionId of optionIds) {
      const option = available.options.find(
        (candidate) =>
          candidate.id === optionId && candidate.modifierId === group.id && candidate.isAvailable,
      );
      if (option === undefined) {
        throw new ServiceError("INVALID_INPUT", `"${group.name}": that choice is not available.`);
      }
      modifiersPaise += option.priceDeltaPaise;
      chosen.push({
        modifierId: group.id,
        optionId: option.id,
        nameSnapshot: `${group.name}: ${option.name}`,
        priceDeltaPaise: option.priceDeltaPaise,
      });
    }
  }

  for (const entry of requested) {
    if (!available.modifiers.some((group) => group.id === entry.modifierId)) {
      throw new ServiceError("INVALID_INPUT", "The menu changed. Reload and try again.");
    }
  }

  return { chosen, modifiersPaise };
}

/** Tax is charged on the line, so it is computed on the line and rounded there once. */
const taxOn = (amountPaise: number, percent: number): number =>
  Math.floor((amountPaise * Math.round(percent * 100) + 5_000) / 10_000);

async function priceItemLine(
  organizationId: string,
  line: ItemLine,
  taxes: ReadonlyMap<string, number>,
): Promise<PricedItemLine> {
  const item = await itemService.byId({ organizationId, id: line.itemId });
  if (item === null || !item.isAvailable) {
    throw new ServiceError("NOT_FOUND", "One of the dishes is not available.");
  }

  const variant =
    line.variantId === undefined
      ? null
      : await itemService.variantById({ organizationId, id: line.variantId });
  if (line.variantId !== undefined && (variant === null || variant.itemId !== item.id)) {
    throw new ServiceError("INVALID_INPUT", `That option is not available for ${item.name}.`);
  }

  const basePaise = variant?.pricePaise ?? item.discountPricePaise ?? item.pricePaise;

  const available = await modifierService.forItems({ organizationId, itemIds: [item.id] });
  const { chosen, modifiersPaise } = resolveModifiers(available, line.modifiers);

  const unitPricePaise = basePaise + modifiersPaise;
  const lineTotalPaise = unitPricePaise * line.quantity;
  const taxPercent = item.taxRateId === null ? 0 : (taxes.get(item.taxRateId) ?? 0);

  return {
    kind: "item",
    itemId: item.id,
    variantId: variant?.id ?? null,
    nameSnapshot: item.name,
    variantNameSnapshot: variant?.name ?? null,
    quantity: line.quantity,
    unitPricePaise,
    lineTotalPaise,
    modifiers: chosen,
    taxPercent,
    taxPaise: taxOn(lineTotalPaise, taxPercent),
    notes: line.notes ?? null,
  };
}

async function priceComboLine(
  organizationId: string,
  line: ComboLine,
  taxes: ReadonlyMap<string, number>,
): Promise<PricedComboLine> {
  const row = await comboService.byId({ organizationId, id: line.comboId });
  if (row === null || !row.isAvailable) {
    throw new ServiceError("NOT_FOUND", "That combo is not available.");
  }
  const structure = await comboService.structureFor({ organizationId, comboIds: [row.id] });
  const definition = toComboDef(row, structure.groups, structure.members);
  const priced = priceComboSelection(definition, line.selections);

  const lineTotalPaise = priced.unitPricePaise * line.quantity;
  const taxPercent = row.taxRateId === null ? 0 : (taxes.get(row.taxRateId) ?? 0);

  return {
    kind: "combo",
    comboId: row.id,
    nameSnapshot: row.name,
    quantity: line.quantity,
    unitPricePaise: priced.unitPricePaise,
    lineTotalPaise,
    referencePricePaise: priced.referencePricePaise * line.quantity,
    savingsPaise: priced.savingsPaise * line.quantity,
    taxPercent,
    taxPaise: taxOn(lineTotalPaise, taxPercent),
    notes: line.notes ?? null,
    children: priced.children.map((child) => ({
      itemId: child.itemId,
      variantId: child.variantId,
      nameSnapshot: child.nameSnapshot,
      variantNameSnapshot: child.variantNameSnapshot,
      /** The line quantity multiplies the whole combo, children included. */
      quantity: child.quantity * line.quantity,
      unitPriceSnapshotPaise: child.unitPriceSnapshotPaise,
      lineTotalPaise: 0 as const,
    })),
  };
}

/**
 * The coupon lives in the crm service, so this asks it over the bus rather than reading a
 * table it does not own. A coupon that cannot be validated is refused rather than ignored:
 * quietly dropping a discount somebody typed in is a worse answer than saying it did not work.
 */
async function discountFor(args: {
  ctx: Parameters<Parameters<typeof handlerFor>[2]>[0]["ctx"];
  code: string;
  subtotalPaise: number;
}): Promise<number> {
  const found = await serviceCall({
    ctx: args.ctx,
    resource: "coupon",
    operation: "read",
    input: { code: args.code, activeOnly: true, limit: 1, cursor: null },
    secret: env.envelopeSecret(),
  });
  const [coupon] = found.items;
  if (coupon === undefined) throw new ServiceError("INVALID_INPUT", "That code is not valid.");

  const promotions = await serviceCall({
    ctx: args.ctx,
    resource: "promotion",
    operation: "read",
    input: { id: coupon.promotionId, activeOnly: true, limit: 1, cursor: null },
    secret: env.envelopeSecret(),
  });
  const [promotion] = promotions.items;
  if (promotion === undefined) throw new ServiceError("INVALID_INPUT", "That code is not valid.");

  const minimum = promotion.conditions.minimumOrderPaise;
  if (minimum !== null && args.subtotalPaise < minimum) {
    throw new ServiceError(
      "INVALID_INPUT",
      `This code needs an order of at least ₹${(minimum / 100).toFixed(0)}.`,
    );
  }

  if (promotion.percentage !== null) {
    return Math.min(
      args.subtotalPaise,
      Math.floor((args.subtotalPaise * Math.round(promotion.percentage * 100) + 5_000) / 10_000),
    );
  }
  return Math.min(args.subtotalPaise, promotion.amountPaise ?? 0);
}

export const quoteHandlers = [
  handlerFor("quote", "read", async ({ ctx, input }) => {
    const itemIds = input.lines.flatMap((line) => (line.kind === "item" ? [line.itemId] : []));
    const comboIds = input.lines.flatMap((line) => (line.kind === "combo" ? [line.comboId] : []));
    const items = await itemService.byIds({ organizationId: ctx.orgId, ids: itemIds });
    const combos = await Promise.all(
      comboIds.map((id) => comboService.byId({ organizationId: ctx.orgId, id })),
    );
    const taxes = await taxService.byIds({
      organizationId: ctx.orgId,
      ids: [
        ...items.flatMap((row) => (row.taxRateId === null ? [] : [row.taxRateId])),
        ...combos.flatMap((row) => (row?.taxRateId == null ? [] : [row.taxRateId])),
      ],
    });

    const lines: Array<PricedItemLine | PricedComboLine> = [];
    for (const line of input.lines) {
      lines.push(
        line.kind === "item"
          ? await priceItemLine(ctx.orgId, line, taxes)
          : await priceComboLine(ctx.orgId, line, taxes),
      );
    }

    /** Parent lines only. Combo children are zero and adding them would double-count. */
    const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
    const taxPaise = lines.reduce((sum, line) => sum + line.taxPaise, 0);
    const discountPaise =
      input.couponCode === undefined
        ? 0
        : await discountFor({ ctx, code: input.couponCode, subtotalPaise });

    return {
      lines,
      subtotalPaise,
      taxPaise,
      discountPaise,
      serviceChargePaise: 0,
      packagingPaise: 0,
      totalPaise: Math.max(0, subtotalPaise - discountPaise + taxPaise),
      currency: "INR",
    };
  }),
];
