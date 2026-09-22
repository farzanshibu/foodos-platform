/**
 * SOT: orders-schema, cart-table, order-table, order-item-table, kitchen-table, payment-table
 * WHAT   Every table the orders service owns: carts, orders and their lines, kitchen tickets,
 *        payments and refunds.
 * WHY    Service isolation is a data boundary before it is a code boundary. The menu lives in
 *        the catalog service and is never joined to from here - what an order keeps is a
 *        snapshot, so a receipt from last week still reads correctly after the menu moved on.
 * NOTE   organization_id is a plain column, not a foreign key: the organisation lives in the
 *        identity service's schema. Integrity across services is enforced by events.
 * NOTE   Money is an integer number of paise. Every such column ends in `_paise`.
 * NOTE   Only a line with no parent carries money. A combo's children exist for the kitchen
 *        ticket and the receipt and always hold zero, so the subtotal is the sum over parent
 *        lines with no double counting.
 * WHERE  services/orders/src/*.service.ts
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });

/* ── Cart ────────────────────────────────────────────────────────────────── */

export const cart = pgTable(
  "ord_cart",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    placeId: text("place_id"),
    /** Snapshotted on allocation so the guest is told "Table 12", not an id. */
    placeLabel: text("place_label"),
    placeKind: text("place_kind"),
    guestName: text("guest_name"),
    /** The QR session that owns it, so a guest only ever sees their own basket. */
    sessionId: text("session_id"),
    customerId: text("customer_id"),
    orderType: text("order_type").default("dine_in").notNull(),
    couponCode: text("coupon_code"),
    /**
     * The lines exactly as the customer chose them, not as they were priced. Prices are
     * fetched from the catalogue every time the cart is read, so a menu change between
     * adding an item and paying for it shows up before the order exists rather than after.
     */
    lines: jsonb("lines").default([]).notNull(),
    status: text("status").default("active").notNull(),
    /**
     * Bumped on every write, so a watcher can tell a notice it has already acted on from one
     * it has not. Not a lock: concurrent line edits are serialised by `SELECT ... FOR UPDATE`
     * on this row, which is what makes two phones adding at once both succeed.
     */
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ord_cart_org_idx").on(table.organizationId, table.branchId),
    index("ord_cart_session_idx").on(table.sessionId),
    /**
     * The shared basket lookup: everyone who scans the code on table twelve resolves to the
     * one open basket for that place. Partial on `active`, because a table that has already
     * ordered starts a fresh basket rather than reopening last night's.
     */
    index("ord_cart_place_idx")
      .on(table.organizationId, table.placeId, table.status)
      .where(sql`${table.placeId} is not null`),
    /** The door queue: everything sent from the entrance that still needs seating. */
    index("ord_cart_status_idx").on(table.organizationId, table.branchId, table.status),
  ],
);

/**
 * Who is sitting at the basket.
 *
 * A row per phone, not per person: the same diner scanning twice from two devices is two
 * members, which is the honest reading of what the server can actually know. The display name
 * is generated on join and stored, so it survives a reload and cannot collide with somebody
 * already at that table.
 */
export const cartMember = pgTable(
  "ord_cart_member",
  {
    cartId: text("cart_id").notNull(),
    /** The QR session id. One session is one phone for as long as the ticket lives. */
    sessionId: text("session_id").notNull(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.sessionId] }),
    index("ord_cart_member_cart_idx").on(table.cartId),
  ],
);

export type CartMemberRow = typeof cartMember.$inferSelect;

/* ── Order ───────────────────────────────────────────────────────────────── */

export const order = pgTable(
  "ord_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    branchId: text("branch_id").notNull(),
    placeId: text("place_id"),
    /** Snapshotted so a receipt still names the table after the floor plan is redrawn. */
    placeLabel: text("place_label"),
    customerId: text("customer_id"),
    sessionId: text("session_id"),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    guestEmail: text("guest_email"),
    /** Per branch, per day, human-readable. Uniqueness is enforced by the index below. */
    orderNumber: text("order_number").notNull(),
    orderType: text("order_type").notNull(),
    source: text("source").default("qr").notNull(),
    status: text("status").default("created").notNull(),
    paymentStatus: text("payment_status").default("pending").notNull(),
    subtotalPaise: money("subtotal_paise").notNull(),
    discountPaise: money("discount_paise").default(0).notNull(),
    taxPaise: money("tax_paise").default(0).notNull(),
    serviceChargePaise: money("service_charge_paise").default(0).notNull(),
    packagingPaise: money("packaging_paise").default(0).notNull(),
    totalPaise: money("total_paise").notNull(),
    currency: text("currency").default("INR").notNull(),
    couponCode: text("coupon_code"),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    placedAt: timestamp("placed_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    readyAt: timestamp("ready_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ord_order_number_idx").on(table.organizationId, table.branchId, table.orderNumber),
    index("ord_order_status_idx").on(table.organizationId, table.branchId, table.status),
    index("ord_order_created_idx").on(table.organizationId, table.createdAt),
    index("ord_order_customer_idx").on(table.customerId, table.createdAt),
    index("ord_order_place_idx").on(table.placeId, table.createdAt),
  ],
);

export const orderItem = pgTable(
  "ord_order_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    /** item | combo | combo_child. A combo_child is the only kind that has a parent. */
    lineKind: text("line_kind").default("item").notNull(),
    parentOrderItemId: text("parent_order_item_id"),
    menuItemId: text("menu_item_id"),
    variantId: text("variant_id"),
    comboId: text("combo_id"),
    nameSnapshot: text("name_snapshot").notNull(),
    variantNameSnapshot: text("variant_name_snapshot"),
    quantity: integer("quantity").notNull(),
    unitPricePaise: money("unit_price_paise").default(0).notNull(),
    /** Zero for every child line. Only parents are summed into the subtotal. */
    lineTotalPaise: money("line_total_paise").default(0).notNull(),
    referencePricePaise: money("reference_price_paise"),
    savingsPaise: money("savings_paise"),
    taxPercent: text("tax_percent").default("0").notNull(),
    taxPaise: money("tax_paise").default(0).notNull(),
    notes: text("notes"),
    /**
     * Who chose this dish, when the basket it came from was shared by a table. Snapshotted
     * like every other name on an order: the QR session that added it is gone within hours,
     * and a receipt has to still say "Amber Heron" a year later. Null for a basket that was
     * never shared, which is most of them.
     */
    addedByName: text("added_by_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ord_order_item_order_idx").on(table.orderId),
    index("ord_order_item_parent_idx").on(table.parentOrderItemId),
  ],
);

export const orderItemModifier = pgTable(
  "ord_order_item_modifier",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItem.id, { onDelete: "cascade" }),
    modifierId: text("modifier_id"),
    modifierOptionId: text("modifier_option_id"),
    nameSnapshot: text("name_snapshot").notNull(),
    priceDeltaPaise: money("price_delta_paise").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ord_order_item_modifier_idx").on(table.orderItemId)],
);

/* ── Kitchen ─────────────────────────────────────────────────────────────── */

export const kitchenStation = pgTable(
  "ord_kitchen_station",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    name: text("name").notNull(),
    stationType: text("station_type"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ord_station_branch_name_idx").on(table.branchId, table.name)],
);

export const kitchenTicket = pgTable(
  "ord_kitchen_ticket",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    stationId: text("station_id").references(() => kitchenStation.id),
    ticketNumber: integer("ticket_number").notNull(),
    status: text("status").default("pending").notNull(),
    priority: text("priority").default("normal").notNull(),
    estimatedMinutes: smallint("estimated_minutes"),
    assignedStaffId: text("assigned_staff_id"),
    acceptedAt: timestamp("accepted_at"),
    readyAt: timestamp("ready_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ord_ticket_order_station_idx").on(table.orderId, table.stationId),
    index("ord_ticket_branch_status_idx").on(table.organizationId, table.branchId, table.status),
  ],
);

/* ── Payments ────────────────────────────────────────────────────────────── */

export const payment = pgTable(
  "ord_payment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    method: text("method"),
    amountPaise: money("amount_paise").notNull(),
    refundedPaise: money("refunded_paise").default(0).notNull(),
    currency: text("currency").default("INR").notNull(),
    status: text("status").default("created").notNull(),
    /**
     * True only once a webhook signature has been verified. Nothing a browser says can set
     * it, which is the entire reason an order is not confirmed by the success screen.
     */
    signatureVerified: boolean("signature_verified").default(false).notNull(),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ord_payment_order_idx").on(table.orderId),
    uniqueIndex("ord_payment_provider_idx").on(table.provider, table.providerPaymentId),
  ],
);

export const refund = pgTable(
  "ord_refund",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    amountPaise: money("amount_paise").notNull(),
    reason: text("reason"),
    status: text("status").default("pending").notNull(),
    providerRefundId: text("provider_refund_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("ord_refund_payment_idx").on(table.paymentId)],
);

export type CartRow = typeof cart.$inferSelect;
export type OrderRow = typeof order.$inferSelect;
export type OrderItemRow = typeof orderItem.$inferSelect;
export type OrderItemModifierRow = typeof orderItemModifier.$inferSelect;
export type KitchenTicketRow = typeof kitchenTicket.$inferSelect;
export type KitchenStationRow = typeof kitchenStation.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
export type RefundRow = typeof refund.$inferSelect;
