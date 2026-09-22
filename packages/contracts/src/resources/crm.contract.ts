/**
 * SOT: crm-contract, customer-contract, review-contract, promotion-contract, loyalty-contract
 * WHAT   Input and output schemas for the people side of the product: diners, what they
 *        thought, what they saved, and what keeps them coming back.
 * WHY    Everything here is downstream of an order, so nothing here may set a price or a
 *        total. A promotion declares a rule; the catalogue and the orders service apply it.
 * HOW    A loyalty balance is never written directly - `manage` posts a ledger entry and the
 *        balance is what the ledger sums to. A number somebody can set is a number somebody
 *        can set to anything.
 * WHERE  packages/contracts/src/contracts.ts, services/crm
 */
import { z } from "zod";

import { wireDate } from "../wire";

export const CUSTOMER_SEGMENTS = ["new", "returning", "vip", "inactive", "high_value"] as const;
export const REVIEW_STATUSES = ["pending", "published", "flagged", "removed"] as const;
export const PROMOTION_TYPES = [
  "percentage",
  "fixed",
  "bogo",
  "free_item",
  "first_order",
  "happy_hour",
  "coupon",
] as const;
export const LOYALTY_TXN_TYPES = ["earn", "redeem", "expire", "adjust"] as const;

const paise = z.number().int();
const nonNegativePaise = paise.min(0);

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── Customers ───────────────────────────────────────────────────────────── */

export const customerDto = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  totalOrders: z.number().int(),
  totalSpendPaise: nonNegativePaise,
  averageOrderPaise: nonNegativePaise,
  lastVisitAt: wireDate.nullable(),
  segment: z.enum(CUSTOMER_SEGMENTS),
  favouriteItems: z.array(
    z.object({ itemId: z.string(), name: z.string(), count: z.number().int() }),
  ),
  reviewCount: z.number().int(),
  loyaltyPoints: z.number().int(),
  notes: z.string().nullable(),
  createdAt: wireDate,
});

export const customerContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      search: z.string().max(120).optional(),
      segment: z.enum(CUSTOMER_SEGMENTS).optional(),
      sort: z.enum(["recent", "spend", "orders", "name"]).default("recent"),
    }),
    output: pageOf(customerDto),
  },
  /** A guest naming themselves at checkout. Matched on phone, so scanning twice is one diner. */
  create: {
    input: z.object({
      name: z.string().min(1).max(80),
      phone: z
        .string()
        .regex(/^\+?[0-9]{7,15}$/, "Not a phone number.")
        .optional(),
      email: z.string().email().optional(),
    }),
    output: customerDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      phone: z
        .string()
        .regex(/^\+?[0-9]{7,15}$/, "Not a phone number.")
        .nullable()
        .optional(),
      email: z.string().email().nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
    }),
    output: customerDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Reviews ─────────────────────────────────────────────────────────────── */

const rating = z.number().int().min(1).max(5);

export const reviewDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  branchId: z.string().nullable(),
  orderId: z.string().nullable(),
  customerId: z.string().nullable(),
  authorName: z.string().nullable(),
  food: rating,
  service: rating,
  ambience: rating,
  value: rating,
  /** The mean of the four, computed once in the service so no two screens round differently. */
  overall: z.number(),
  body: z.string().nullable(),
  status: z.enum(REVIEW_STATUSES),
  reply: z.string().nullable(),
  repliedAt: wireDate.nullable(),
  flagReason: z.string().nullable(),
  createdAt: wireDate,
});

export const reviewContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      status: z.enum(REVIEW_STATUSES).optional(),
      minOverall: z.number().min(1).max(5).optional(),
      withReplyOnly: z.boolean().default(false),
    }),
    output: pageOf(reviewDto),
  },
  create: {
    input: z.object({
      restaurantId: z.string(),
      branchId: z.string().nullable().optional(),
      orderId: z.string().nullable().optional(),
      food: rating,
      service: rating,
      ambience: rating,
      value: rating,
      body: z.string().max(2000).optional(),
      authorName: z.string().max(80).optional(),
    }),
    output: reviewDto,
  },
  /** The restaurant's public reply. The ratings themselves are never editable. */
  update: {
    input: z.object({ id: z.string(), reply: z.string().min(1).max(1000) }),
    output: reviewDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("flag"),
        id: z.string(),
        reason: z.string().min(3).max(300),
      }),
      z.object({ action: z.literal("unflag"), id: z.string() }),
    ]),
    output: reviewDto,
  },
} as const;

/* ── Favourites ──────────────────────────────────────────────────────────── */

export const favoriteDto = z.object({
  id: z.string(),
  kind: z.enum(["restaurant", "item"]),
  targetId: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  createdAt: wireDate,
});

export const favoriteContract = {
  read: {
    input: z.object({ ...cursorPage, kind: z.enum(["restaurant", "item"]).optional() }),
    output: pageOf(favoriteDto),
  },
  create: {
    input: z.object({ kind: z.enum(["restaurant", "item"]), targetId: z.string() }),
    output: favoriteDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Promotions and coupons ──────────────────────────────────────────────── */

/**
 * Conditions are a closed object, not a free-form record. A rule engine that takes arbitrary
 * JSON is a rule engine nobody can audit, and this is the thing that decides what a customer
 * pays.
 */
export const promotionConditionsDto = z.object({
  minimumOrderPaise: nonNegativePaise.nullable(),
  itemIds: z.array(z.string()),
  categoryIds: z.array(z.string()),
  comboIds: z.array(z.string()),
  branchIds: z.array(z.string()),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  audience: z.enum(["everyone", "new_customers", "returning_customers"]),
  maxRedemptions: z.number().int().nullable(),
  maxRedemptionsPerCustomer: z.number().int().nullable(),
});

export const promotionDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(PROMOTION_TYPES),
  /** A percentage for percentage types, an amount in paise for fixed ones. */
  percentage: z.number().nullable(),
  amountPaise: nonNegativePaise.nullable(),
  freeItemId: z.string().nullable(),
  conditions: promotionConditionsDto,
  startsAt: wireDate.nullable(),
  endsAt: wireDate.nullable(),
  isActive: z.boolean(),
  redemptionCount: z.number().int(),
  createdAt: wireDate,
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

const promotionConditionsInput = z.object({
  minimumOrderPaise: nonNegativePaise.nullable().optional(),
  itemIds: z.array(z.string()).max(200).optional(),
  categoryIds: z.array(z.string()).max(50).optional(),
  comboIds: z.array(z.string()).max(50).optional(),
  branchIds: z.array(z.string()).max(50).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: timeOfDay.nullable().optional(),
  endTime: timeOfDay.nullable().optional(),
  audience: z.enum(["everyone", "new_customers", "returning_customers"]).optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  maxRedemptionsPerCustomer: z.number().int().min(1).nullable().optional(),
});

/**
 * A percentage promotion needs a percentage, a fixed one needs an amount, a free-item one
 * needs an item. Refused here so a promotion that cannot be applied cannot be saved.
 */
function refinePromotionValue(
  value: {
    type?: (typeof PROMOTION_TYPES)[number] | undefined;
    percentage?: number | null | undefined;
    amountPaise?: number | null | undefined;
    freeItemId?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === undefined) return;
  const needsPercentage = value.type === "percentage" || value.type === "happy_hour";
  if (needsPercentage && value.percentage == null) {
    ctx.addIssue({
      code: "custom",
      path: ["percentage"],
      message: "This promotion type needs a percentage.",
    });
  }
  if (value.type === "fixed" && value.amountPaise == null) {
    ctx.addIssue({
      code: "custom",
      path: ["amountPaise"],
      message: "A fixed promotion needs an amount.",
    });
  }
  if (value.type === "free_item" && value.freeItemId == null) {
    ctx.addIssue({
      code: "custom",
      path: ["freeItemId"],
      message: "A free-item promotion needs an item.",
    });
  }
}

const promotionFields = {
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  percentage: z.number().min(1).max(100).nullable().optional(),
  amountPaise: nonNegativePaise.min(1).nullable().optional(),
  freeItemId: z.string().nullable().optional(),
  conditions: promotionConditionsInput.optional(),
  startsAt: wireDate.nullable().optional(),
  endsAt: wireDate.nullable().optional(),
  isActive: z.boolean().optional(),
};

export const promotionContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      restaurantId: z.string().optional(),
      activeOnly: z.boolean().default(false),
    }),
    output: pageOf(promotionDto),
  },
  create: {
    input: z
      .object({ restaurantId: z.string(), type: z.enum(PROMOTION_TYPES), ...promotionFields })
      .superRefine(refinePromotionValue),
    output: promotionDto,
  },
  update: {
    input: z
      .object({
        id: z.string(),
        type: z.enum(PROMOTION_TYPES).optional(),
        ...promotionFields,
        name: z.string().min(1).max(80).optional(),
      })
      .superRefine(refinePromotionValue),
    output: promotionDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

export const couponDto = z.object({
  id: z.string(),
  promotionId: z.string(),
  promotionName: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  redemptionCount: z.number().int(),
  maxRedemptions: z.number().int().nullable(),
  expiresAt: wireDate.nullable(),
  createdAt: wireDate,
});

export const couponContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      code: z.string().max(30).optional(),
      promotionId: z.string().optional(),
      activeOnly: z.boolean().default(false),
    }),
    output: pageOf(couponDto),
  },
  create: {
    input: z.object({
      promotionId: z.string(),
      code: z
        .string()
        .min(3)
        .max(30)
        .regex(/^[A-Z0-9-]+$/, "Uppercase letters, digits and hyphens."),
      maxRedemptions: z.number().int().min(1).nullable().optional(),
      expiresAt: wireDate.nullable().optional(),
    }),
    output: couponDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      isActive: z.boolean().optional(),
      maxRedemptions: z.number().int().min(1).nullable().optional(),
      expiresAt: wireDate.nullable().optional(),
    }),
    output: couponDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Loyalty ─────────────────────────────────────────────────────────────── */

export const loyaltyTierDto = z.object({
  name: z.string(),
  minPoints: z.number().int().min(0),
  earnMultiplier: z.number().min(1).max(10),
});

export const loyaltyProgrammeDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  name: z.string(),
  /** Points earned per 100 rupees spent. Declared once, applied by the orders consumer. */
  pointsPerHundred: z.number().int().min(1).max(1000),
  /** Paise of discount one point is worth when redeemed. */
  redeemPaisePerPoint: z.number().int().min(1).max(10_000),
  minimumRedeemPoints: z.number().int().min(1),
  expiryDays: z.number().int().min(1).nullable(),
  tiers: z.array(loyaltyTierDto),
  isActive: z.boolean(),
  createdAt: wireDate,
});

export const loyaltyTransactionDto = z.object({
  id: z.string(),
  customerId: z.string(),
  type: z.enum(LOYALTY_TXN_TYPES),
  points: z.number().int(),
  orderId: z.string().nullable(),
  description: z.string().nullable(),
  expiresAt: wireDate.nullable(),
  createdAt: wireDate,
});

export const loyaltyAccountDto = z.object({
  customerId: z.string(),
  pointsBalance: z.number().int().min(0),
  tier: z.string(),
  transactions: z.array(loyaltyTransactionDto),
});

export const loyaltyContract = {
  read: {
    input: z.object({
      ...cursorPage,
      /** With a customer id it is that diner's account; without one it is the programme. */
      customerId: z.string().optional(),
    }),
    output: z.object({
      programme: loyaltyProgrammeDto.nullable(),
      account: loyaltyAccountDto.nullable(),
    }),
  },
  create: {
    input: z.object({
      restaurantId: z.string(),
      name: z.string().min(1).max(80),
      pointsPerHundred: z.number().int().min(1).max(1000),
      redeemPaisePerPoint: z.number().int().min(1).max(10_000),
      minimumRedeemPoints: z.number().int().min(1).default(100),
      expiryDays: z.number().int().min(1).max(3650).nullable().optional(),
      tiers: z
        .array(
          z.object({
            name: z.string().min(1).max(40),
            minPoints: z.number().int().min(0),
            earnMultiplier: z.number().min(1).max(10).default(1),
          }),
        )
        .max(6)
        .default([]),
    }),
    output: loyaltyProgrammeDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      pointsPerHundred: z.number().int().min(1).max(1000).optional(),
      redeemPaisePerPoint: z.number().int().min(1).max(10_000).optional(),
      minimumRedeemPoints: z.number().int().min(1).optional(),
      expiryDays: z.number().int().min(1).max(3650).nullable().optional(),
      tiers: z
        .array(
          z.object({
            name: z.string().min(1).max(40),
            minPoints: z.number().int().min(0),
            earnMultiplier: z.number().min(1).max(10).default(1),
          }),
        )
        .max(6)
        .optional(),
      isActive: z.boolean().optional(),
    }),
    output: loyaltyProgrammeDto,
  },
  /**
   * Always a ledger entry, never a new total. `points` may be negative for a redemption or a
   * correction; the balance is whatever the ledger sums to, which is the only version of a
   * balance that can be explained to the person holding it.
   */
  manage: {
    input: z.object({
      customerId: z.string(),
      points: z
        .number()
        .int()
        .refine((value) => value !== 0, "A zero adjustment is not a change."),
      reason: z.string().min(3).max(200),
      orderId: z.string().nullable().optional(),
    }),
    output: loyaltyAccountDto,
  },
} as const;
