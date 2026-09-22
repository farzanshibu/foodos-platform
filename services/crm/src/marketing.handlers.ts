/**
 * SOT: promotion-handlers, coupon-handlers, loyalty-handlers, loyalty-ledger-rules
 * WHAT   Business rules for promotions, the codes that redeem them, and the loyalty ledger.
 * WHY    None of this sets a price. A promotion declares a rule and the catalogue applies it
 *        when it prices a cart - which is why a discount cannot be forged by editing a
 *        promotion after the fact, and why this file has no arithmetic on an order in it.
 * HOW    A loyalty balance is never written. `manage` posts a ledger entry and the balance is
 *        what the ledger sums to, so every point a diner holds can be accounted for.
 * WHERE  services/crm/src/crm.service.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import { couponService, customerService, loyaltyService, promotionService } from "./crm.service";
import type { CouponRow, LoyaltyProgrammeRow, LoyaltyTransactionRow, PromotionRow } from "./schema";

const PROMOTION_TYPES = [
  "percentage",
  "fixed",
  "bogo",
  "free_item",
  "first_order",
  "happy_hour",
  "coupon",
] as const;
type PromotionType = (typeof PROMOTION_TYPES)[number];

const AUDIENCES = ["everyone", "new_customers", "returning_customers"] as const;
type Audience = (typeof AUDIENCES)[number];

const TXN_TYPES = ["earn", "redeem", "expire", "adjust"] as const;
type TxnType = (typeof TXN_TYPES)[number];

const asType = (value: string): PromotionType =>
  PROMOTION_TYPES.find((candidate) => candidate === value) ?? "percentage";
const asAudience = (value: string): Audience =>
  AUDIENCES.find((candidate) => candidate === value) ?? "everyone";
const asTxnType = (value: string): TxnType =>
  TXN_TYPES.find((candidate) => candidate === value) ?? "adjust";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const toPromotionDto = (row: PromotionRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  name: row.name,
  description: row.description,
  type: asType(row.type),
  percentage: row.percentage === null ? null : Number(row.percentage),
  amountPaise: row.amountPaise,
  freeItemId: row.freeItemId,
  conditions: {
    minimumOrderPaise: row.minimumOrderPaise,
    itemIds: row.itemIds,
    categoryIds: row.categoryIds,
    comboIds: row.comboIds,
    branchIds: row.branchIds,
    daysOfWeek: row.daysOfWeek,
    startTime: row.startTime === null ? null : row.startTime.slice(0, 5),
    endTime: row.endTime === null ? null : row.endTime.slice(0, 5),
    audience: asAudience(row.audience),
    maxRedemptions: row.maxRedemptions,
    maxRedemptionsPerCustomer: row.maxRedemptionsPerCustomer,
  },
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  isActive: row.isActive,
  redemptionCount: row.redemptionCount,
  createdAt: row.createdAt,
});

const toCouponDto = (row: CouponRow, promotionName: string) => ({
  id: row.id,
  promotionId: row.promotionId,
  promotionName,
  code: row.code,
  isActive: row.isActive,
  redemptionCount: row.redemptionCount,
  maxRedemptions: row.maxRedemptions,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
});

function readTiers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const fields: ReadonlyMap<string, unknown> =
      typeof entry === "object" && entry !== null ? new Map(Object.entries(entry)) : new Map();
    const name = fields.get("name");
    const minPoints = fields.get("minPoints");
    const earnMultiplier = fields.get("earnMultiplier");
    return typeof name === "string" && typeof minPoints === "number"
      ? [
          {
            name,
            minPoints,
            earnMultiplier: typeof earnMultiplier === "number" ? earnMultiplier : 1,
          },
        ]
      : [];
  });
}

const toProgrammeDto = (row: LoyaltyProgrammeRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  name: row.name,
  pointsPerHundred: row.pointsPerHundred,
  redeemPaisePerPoint: row.redeemPaisePerPoint,
  minimumRedeemPoints: row.minimumRedeemPoints,
  expiryDays: row.expiryDays,
  tiers: readTiers(row.tiers),
  isActive: row.isActive,
  createdAt: row.createdAt,
});

const toTransactionDto = (row: LoyaltyTransactionRow) => ({
  id: row.id,
  customerId: row.customerId,
  type: asTxnType(row.type),
  points: row.points,
  orderId: row.orderId,
  description: row.description,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
});

/** Which tier a balance reaches. The highest threshold it clears, or the lowest declared. */
function tierFor(programme: LoyaltyProgrammeRow | null, points: number): string {
  const tiers = readTiers(programme?.tiers).sort((left, right) => left.minPoints - right.minPoints);
  if (tiers.length === 0) return "member";
  let held = tiers[0]?.name ?? "member";
  for (const tier of tiers) {
    if (points >= tier.minPoints) held = tier.name;
  }
  return held;
}

const conditionPatch = (conditions: {
  minimumOrderPaise?: number | null | undefined;
  itemIds?: string[] | undefined;
  categoryIds?: string[] | undefined;
  comboIds?: string[] | undefined;
  branchIds?: string[] | undefined;
  daysOfWeek?: number[] | undefined;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  audience?: Audience | undefined;
  maxRedemptions?: number | null | undefined;
  maxRedemptionsPerCustomer?: number | null | undefined;
}) => ({
  ...set(conditions.minimumOrderPaise, "minimumOrderPaise"),
  ...set(conditions.itemIds, "itemIds"),
  ...set(conditions.categoryIds, "categoryIds"),
  ...set(conditions.comboIds, "comboIds"),
  ...set(conditions.branchIds, "branchIds"),
  ...set(conditions.daysOfWeek, "daysOfWeek"),
  ...set(conditions.startTime, "startTime"),
  ...set(conditions.endTime, "endTime"),
  ...set(conditions.audience, "audience"),
  ...set(conditions.maxRedemptions, "maxRedemptions"),
  ...set(conditions.maxRedemptionsPerCustomer, "maxRedemptionsPerCustomer"),
});

export const promotionHandlers = [
  handlerFor("promotion", "read", async ({ ctx, input }) => {
    const page = await promotionService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      /** A guest is only ever shown live offers. */
      activeOnly: ctx.role === "guest" || input.activeOnly,
      ...set(input.id, "id"),
      ...set(input.restaurantId, "restaurantId"),
    });
    return { items: page.items.map(toPromotionDto), nextCursor: page.nextCursor };
  }),

  handlerFor("promotion", "create", async ({ ctx, input }) => {
    const created = await promotionService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      percentage: input.percentage == null ? null : String(input.percentage),
      amountPaise: input.amountPaise ?? null,
      freeItemId: input.freeItemId ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      ...conditionPatch(input.conditions ?? {}),
      ...set(input.isActive, "isActive"),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The promotion was not created.");
    return toPromotionDto(created);
  }),

  handlerFor("promotion", "update", async ({ ctx, input }) => {
    const updated = await promotionService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.description, "description"),
        ...set(input.type, "type"),
        ...set(input.amountPaise, "amountPaise"),
        ...set(input.freeItemId, "freeItemId"),
        ...set(input.startsAt, "startsAt"),
        ...set(input.endsAt, "endsAt"),
        ...set(input.isActive, "isActive"),
        ...(input.percentage === undefined
          ? {}
          : { percentage: input.percentage === null ? null : String(input.percentage) }),
        ...conditionPatch(input.conditions ?? {}),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Promotion not found.");
    return toPromotionDto(updated);
  }),

  handlerFor("promotion", "delete", async ({ ctx, input }) => {
    const removed = await promotionService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Promotion not found.");
    return removed;
  }),
];

export const couponHandlers = [
  handlerFor("coupon", "read", async ({ ctx, input }) => {
    const page = await couponService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      activeOnly: ctx.role === "guest" || input.activeOnly,
      ...set(input.id, "id"),
      ...set(input.code, "code"),
      ...set(input.promotionId, "promotionId"),
    });
    const promotions = await couponService.promotionsFor({
      organizationId: ctx.orgId,
      ids: page.items.map((row) => row.promotionId),
    });
    return {
      items: page.items.map((row) =>
        toCouponDto(
          row,
          promotions.find((promotion) => promotion.id === row.promotionId)?.name ?? "",
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("coupon", "create", async ({ ctx, input }) => {
    const parent = await promotionService.byId({
      organizationId: ctx.orgId,
      id: input.promotionId,
    });
    if (parent === null) throw new ServiceError("NOT_FOUND", "Promotion not found.");
    const created = await couponService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      promotionId: input.promotionId,
      code: input.code.toUpperCase(),
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    if (created === null) throw new ServiceError("CONFLICT", "That code is already in use.");
    return toCouponDto(created, parent.name);
  }),

  handlerFor("coupon", "update", async ({ ctx, input }) => {
    const updated = await couponService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.isActive, "isActive"),
        ...set(input.maxRedemptions, "maxRedemptions"),
        ...set(input.expiresAt, "expiresAt"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Coupon not found.");
    const parent = await promotionService.byId({
      organizationId: ctx.orgId,
      id: updated.promotionId,
    });
    return toCouponDto(updated, parent?.name ?? "");
  }),

  handlerFor("coupon", "delete", async ({ ctx, input }) => {
    const removed = await couponService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Coupon not found.");
    return removed;
  }),
];

export const loyaltyHandlers = [
  handlerFor("loyalty", "read", async ({ ctx, input }) => {
    const programme = await loyaltyService.programme({ organizationId: ctx.orgId });
    if (input.customerId === undefined) {
      return { programme: programme === null ? null : toProgrammeDto(programme), account: null };
    }

    const points = await loyaltyService.balance({
      organizationId: ctx.orgId,
      customerId: input.customerId,
    });
    const transactions = await loyaltyService.transactions({
      organizationId: ctx.orgId,
      customerId: input.customerId,
      limit: input.limit,
    });

    return {
      programme: programme === null ? null : toProgrammeDto(programme),
      account: {
        customerId: input.customerId,
        pointsBalance: Math.max(0, points),
        tier: tierFor(programme, points),
        transactions: transactions.map(toTransactionDto),
      },
    };
  }),

  handlerFor("loyalty", "create", async ({ ctx, input }) => {
    const existing = await loyaltyService.programme({ organizationId: ctx.orgId });
    if (existing !== null) {
      throw new ServiceError("CONFLICT", "This organisation already has a loyalty programme.");
    }
    const created = await loyaltyService.createProgramme({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      name: input.name,
      pointsPerHundred: input.pointsPerHundred,
      redeemPaisePerPoint: input.redeemPaisePerPoint,
      minimumRedeemPoints: input.minimumRedeemPoints,
      expiryDays: input.expiryDays ?? null,
      tiers: input.tiers,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The programme was not created.");
    return toProgrammeDto(created);
  }),

  handlerFor("loyalty", "update", async ({ ctx, input }) => {
    const updated = await loyaltyService.updateProgramme({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.pointsPerHundred, "pointsPerHundred"),
        ...set(input.redeemPaisePerPoint, "redeemPaisePerPoint"),
        ...set(input.minimumRedeemPoints, "minimumRedeemPoints"),
        ...set(input.expiryDays, "expiryDays"),
        ...set(input.tiers, "tiers"),
        ...set(input.isActive, "isActive"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Loyalty programme not found.");
    return toProgrammeDto(updated);
  }),

  /**
   * Always a ledger entry, never a new total. A redemption is refused when the balance cannot
   * cover it, here, rather than allowed to go negative and reconciled by somebody later.
   */
  handlerFor("loyalty", "manage", async ({ ctx, input }) => {
    const diner = await customerService.byId({ organizationId: ctx.orgId, id: input.customerId });
    if (diner === null) throw new ServiceError("NOT_FOUND", "Customer not found.");

    const programme = await loyaltyService.programme({ organizationId: ctx.orgId });
    const balance = await loyaltyService.balance({
      organizationId: ctx.orgId,
      customerId: input.customerId,
    });
    if (input.points < 0 && balance + input.points < 0) {
      throw new ServiceError("CONFLICT", `This customer only has ${balance} points.`);
    }

    const expiresAt =
      input.points > 0 && programme?.expiryDays != null
        ? new Date(Date.now() + programme.expiryDays * 24 * 60 * 60 * 1000)
        : null;

    await loyaltyService.post({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      customerId: input.customerId,
      type: input.points > 0 ? "earn" : "redeem",
      points: input.points,
      orderId: input.orderId ?? null,
      description: input.reason,
      expiresAt,
    });

    const after = await loyaltyService.balance({
      organizationId: ctx.orgId,
      customerId: input.customerId,
    });
    const transactions = await loyaltyService.transactions({
      organizationId: ctx.orgId,
      customerId: input.customerId,
      limit: 20,
    });

    return {
      customerId: input.customerId,
      pointsBalance: Math.max(0, after),
      tier: tierFor(programme, after),
      transactions: transactions.map(toTransactionDto),
    };
  }),
];
