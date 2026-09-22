/**
 * SOT: crm-schema, customer-table, review-table, promotion-table, loyalty-table
 * WHAT   Every table the crm service owns: diners, what they thought, what they saved and
 *        what keeps them coming back.
 * WHY    Everything here is downstream of an order, so nothing here sets a price. A promotion
 *        declares a rule; the catalogue applies it when it prices a cart.
 * NOTE   organization_id is a plain column, not a foreign key. A customer row is per tenant on
 *        purpose: two restaurants knowing the same phone number are two relationships, and
 *        merging them would be a cross-tenant read wearing a helpful hat.
 * WHERE  services/crm/src/*.service.ts
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });

export const customer = pgTable(
  "crm_customer",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    /** Maintained by the order consumer, so a profile is never a live join across services. */
    totalOrders: integer("total_orders").default(0).notNull(),
    totalSpendPaise: money("total_spend_paise").default(0).notNull(),
    lastVisitAt: timestamp("last_visit_at"),
    favouriteItems: jsonb("favourite_items").default([]).notNull(),
    reviewCount: integer("review_count").default(0).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("crm_customer_org_phone_idx").on(table.organizationId, table.phone),
    index("crm_customer_org_spend_idx").on(table.organizationId, table.totalSpendPaise),
    index("crm_customer_org_visit_idx").on(table.organizationId, table.lastVisitAt),
  ],
);

export const review = pgTable(
  "crm_review",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    branchId: text("branch_id"),
    orderId: text("order_id"),
    customerId: text("customer_id").references(() => customer.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    food: smallint("food").notNull(),
    service: smallint("service").notNull(),
    ambience: smallint("ambience").notNull(),
    value: smallint("value").notNull(),
    /** The mean of the four, computed once here so no two screens round it differently. */
    overall: numeric("overall", { precision: 3, scale: 2 }).notNull(),
    body: text("body"),
    status: text("status").default("published").notNull(),
    reply: text("reply"),
    repliedAt: timestamp("replied_at"),
    flagReason: text("flag_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("crm_review_org_idx").on(table.organizationId, table.restaurantId, table.status),
    /** One review per order: an invitation to rate is not an invitation to rate repeatedly. */
    uniqueIndex("crm_review_order_idx").on(table.orderId),
  ],
);

export const favorite = pgTable(
  "crm_favorite",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    customerId: text("customer_id"),
    sessionId: text("session_id"),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("crm_favorite_owner_idx").on(table.organizationId, table.customerId)],
);

export const promotion = pgTable(
  "crm_promotion",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    percentage: numeric("percentage", { precision: 5, scale: 2 }),
    amountPaise: money("amount_paise"),
    freeItemId: text("free_item_id"),
    minimumOrderPaise: money("minimum_order_paise"),
    itemIds: text("item_ids").array().default([]).notNull(),
    categoryIds: text("category_ids").array().default([]).notNull(),
    comboIds: text("combo_ids").array().default([]).notNull(),
    branchIds: text("branch_ids").array().default([]).notNull(),
    daysOfWeek: smallint("days_of_week").array().default([]).notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    audience: text("audience").default("everyone").notNull(),
    maxRedemptions: integer("max_redemptions"),
    maxRedemptionsPerCustomer: integer("max_redemptions_per_customer"),
    startsAt: timestamp("starts_at"),
    endsAt: timestamp("ends_at"),
    isActive: boolean("is_active").default(true).notNull(),
    redemptionCount: integer("redemption_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("crm_promotion_org_idx").on(table.organizationId, table.restaurantId)],
);

export const coupon = pgTable(
  "crm_coupon",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotion.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    redemptionCount: integer("redemption_count").default(0).notNull(),
    maxRedemptions: integer("max_redemptions"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("crm_coupon_org_code_idx").on(table.organizationId, table.code)],
);

export const loyaltyProgramme = pgTable(
  "crm_loyalty_programme",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    name: text("name").notNull(),
    pointsPerHundred: integer("points_per_hundred").default(10).notNull(),
    redeemPaisePerPoint: integer("redeem_paise_per_point").default(10).notNull(),
    minimumRedeemPoints: integer("minimum_redeem_points").default(100).notNull(),
    expiryDays: integer("expiry_days"),
    tiers: jsonb("tiers").default([]).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("crm_loyalty_org_restaurant_idx").on(table.organizationId, table.restaurantId),
  ],
);

/**
 * A ledger, not a balance. The balance is what this sums to, which is the only version of a
 * balance that can be explained to the person holding it - and the only one an adjustment
 * cannot quietly overwrite.
 */
export const loyaltyTransaction = pgTable(
  "crm_loyalty_transaction",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** Negative for a redemption or a correction. */
    points: integer("points").notNull(),
    orderId: text("order_id"),
    description: text("description"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("crm_loyalty_tx_customer_idx").on(table.customerId, table.createdAt)],
);

export type CustomerRow = typeof customer.$inferSelect;
export type ReviewRow = typeof review.$inferSelect;
export type FavoriteRow = typeof favorite.$inferSelect;
export type PromotionRow = typeof promotion.$inferSelect;
export type CouponRow = typeof coupon.$inferSelect;
export type LoyaltyProgrammeRow = typeof loyaltyProgramme.$inferSelect;
export type LoyaltyTransactionRow = typeof loyaltyTransaction.$inferSelect;
