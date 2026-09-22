/**
 * SOT: quote-contract, pricing-contract, cart-line, priced-line, combo-pricing-wire
 * WHAT   The shape of a cart on its way to being priced, and the shape of the answer.
 * WHY    This is the only price anyone is allowed to believe. There is no price field in the
 *        input, on purpose: a client that could send a price is a client that could set one.
 *        The orders service calls this over the bus rather than importing the catalogue,
 *        and the browser renders what comes back rather than computing anything.
 * HOW    Every money field is an integer number of paise and says so in its name. A combo
 *        line prices as one unit; its constituents come back as child lines carrying zero,
 *        because they are there for the kitchen ticket and the receipt, not for money.
 * WHERE  services/catalog/src/pricing.ts, services/orders
 */
import { z } from "zod";

const paise = z.number().int();
const nonNegativePaise = paise.min(0);

/* ── What goes in ────────────────────────────────────────────────────────── */

export const itemLineInput = z.object({
  kind: z.literal("item"),
  itemId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).max(50),
  modifiers: z
    .array(
      z.object({
        modifierId: z.string(),
        optionIds: z.array(z.string()).min(1).max(20),
      }),
    )
    .max(20)
    .default([]),
  notes: z.string().max(200).optional(),
});

export const comboSelectionInput = z.object({
  groupId: z.string(),
  itemId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).max(10).default(1),
});

export const comboLineInput = z.object({
  kind: z.literal("combo"),
  comboId: z.string(),
  /** Multiplies the whole combo, children included - not one selection inside it. */
  quantity: z.number().int().min(1).max(20),
  selections: z.array(comboSelectionInput).min(1).max(30),
  notes: z.string().max(200).optional(),
});

export const cartLineInput = z.discriminatedUnion("kind", [itemLineInput, comboLineInput]);
export type CartLineInput = z.infer<typeof cartLineInput>;

/* ── What comes back ─────────────────────────────────────────────────────── */

export const pricedModifierDto = z.object({
  modifierId: z.string(),
  optionId: z.string(),
  nameSnapshot: z.string(),
  priceDeltaPaise: paise,
});

/**
 * A constituent of a combo. It carries the price the item had at pricing time so a receipt
 * can still be explained a year later, and a line total of zero so the sum over parent
 * lines is the subtotal with no double counting.
 */
export const comboChildLineDto = z.object({
  itemId: z.string(),
  variantId: z.string().nullable(),
  nameSnapshot: z.string(),
  variantNameSnapshot: z.string().nullable(),
  quantity: z.number().int(),
  unitPriceSnapshotPaise: nonNegativePaise,
  lineTotalPaise: z.literal(0),
});

export const pricedLineDto = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    itemId: z.string(),
    variantId: z.string().nullable(),
    nameSnapshot: z.string(),
    variantNameSnapshot: z.string().nullable(),
    quantity: z.number().int(),
    unitPricePaise: nonNegativePaise,
    lineTotalPaise: nonNegativePaise,
    modifiers: z.array(pricedModifierDto),
    taxPercent: z.number(),
    taxPaise: nonNegativePaise,
    notes: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("combo"),
    comboId: z.string(),
    nameSnapshot: z.string(),
    quantity: z.number().int(),
    /** The price of ONE combo. Flat rate ignores the parts; percentage is derived from them. */
    unitPricePaise: nonNegativePaise,
    lineTotalPaise: nonNegativePaise,
    /** What the parts would have cost separately, for the strike-through. */
    referencePricePaise: nonNegativePaise,
    /** Clamped at zero: a combo priced above its parts shows no saving, never a negative one. */
    savingsPaise: nonNegativePaise,
    taxPercent: z.number(),
    taxPaise: nonNegativePaise,
    notes: z.string().nullable(),
    children: z.array(comboChildLineDto),
  }),
]);
export type PricedLine = z.infer<typeof pricedLineDto>;

export const pricedCartDto = z.object({
  lines: z.array(pricedLineDto),
  /** Sum of the parent lines only. Child lines are zero and must not be added again. */
  subtotalPaise: nonNegativePaise,
  taxPaise: nonNegativePaise,
  /** Combo savings are already inside the line totals; this is the order-level discount. */
  discountPaise: nonNegativePaise,
  serviceChargePaise: nonNegativePaise,
  packagingPaise: nonNegativePaise,
  totalPaise: nonNegativePaise,
  currency: z.string(),
});

export const quoteContract = {
  read: {
    input: z.object({
      branchId: z.string(),
      lines: z.array(cartLineInput).min(1).max(50),
      /**
       * Applied after every line has been priced. Combo pricing is line-level and a coupon
       * is order-level; that order is fixed, and it is why a percentage coupon can never
       * re-discount a combo's parts.
       */
      couponCode: z.string().max(30).optional(),
      orderType: z.enum(["dine_in", "takeaway", "pickup", "delivery"]).default("dine_in"),
    }),
    output: pricedCartDto,
  },
} as const;
