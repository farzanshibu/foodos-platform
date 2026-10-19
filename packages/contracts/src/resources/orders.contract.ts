/**
 * SOT: orders-contract, cart-contract, order-contract, kitchen-contract, payment-contract
 * WHAT   Input and output schemas for a cart, the order it becomes, the ticket the kitchen
 *        sees and the payment that confirms it.
 * WHY    There is no price field in any input in this file, and that is the whole point. The
 *        catalogue prices a cart; the orders service asks it and stores what it was told.
 *        A price the caller could send is a price the caller could choose.
 * HOW    Line shapes are imported from the quote contract rather than restated, so an order
 *        line and a priced line cannot drift apart. Output lines carry snapshots, because a
 *        receipt has to still make sense after the menu has moved on.
 * WHERE  packages/contracts/src/resources/pricing.contract.ts, services/orders
 */
import { z } from "zod";

import { wireDate } from "../wire";
import { cartLineInput, pricedCartDto, pricedLineDto } from "./pricing.contract";

export const ORDER_TYPES = ["dine_in", "takeaway", "pickup", "delivery"] as const;
export const ORDER_SOURCES = ["marketplace", "qr", "manual"] as const;

export const ORDER_STATUSES = [
  "created",
  "payment_pending",
  "paid",
  "accepted",
  "preparing",
  "ready",
  "served",
  "completed",
  "cancelled_by_customer",
  "cancelled_by_restaurant",
  "payment_failed",
  "refunded",
] as const;

export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
] as const;
export const PAYMENT_METHODS = ["upi", "card", "netbanking", "wallet", "cash"] as const;
export const KITCHEN_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;

const paise = z.number().int();
const nonNegativePaise = paise.min(0);

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const guestContact = {
  guestName: z.string().min(1).max(80).optional(),
  guestPhone: z
    .string()
    .regex(/^\+?[0-9]{7,15}$/, "Not a phone number.")
    .optional(),
  guestEmail: z.string().email().optional(),
};

/* ── Cart ────────────────────────────────────────────────────────────────── */

/**
 * Where a basket is in the walk-in flow.
 *
 * `active` is somebody still choosing. `awaiting_place` is a basket that has been sent but
 * has nowhere to go yet - the guest ordered at the door, before being seated. `allocated`
 * means staff have given it a table or a seat, and it is now waiting for the guest to
 * confirm at that place. Only then does an order exist.
 */
/**
 * `abandoned` is the other way a basket ends. `converted` means it became an order and got
 * cooked; `abandoned` means the party left without sending it, which is what staff clearing
 * the table says. Two names rather than one, because a restaurant reading its own numbers
 * later has every reason to tell "they ordered" apart from "they walked out".
 */
export const CART_STATUSES = [
  "active",
  "awaiting_place",
  "allocated",
  "converted",
  "abandoned",
] as const;

export type CartStatus = (typeof CART_STATUSES)[number];

/**
 * The statuses that mean the basket is over. Declared beside the vocabulary rather than in
 * the service, because "closed" has to mean the same thing to everything that asks: the
 * handler refusing a change, the checkout refusing to cook it, and the query deciding which
 * baskets a cleared table still has to close.
 */
export const TERMINAL_CART_STATUSES: readonly CartStatus[] = ["converted", "abandoned"];

/** Whether this basket can still be added to, priced and sent. */
export function isCartOpen(status: CartStatus): boolean {
  return !TERMINAL_CART_STATUSES.includes(status);
}

/**
 * A cart is the priced view of some lines, not a stored total. The prices come back from the
 * catalogue every time it is read, so a menu change between adding an item and paying for it
 * is visible before the order exists rather than after.
 */
/**
 * A line as it is STORED: what was chosen, plus who chose it.
 *
 * Lives here rather than in the orders service because it is the shape that survives a write
 * and has to be read back honestly - the service holds it in a jsonb column, so it arrives as
 * `unknown` and is parsed with this, never trusted. The chosen half is the pricing contract's
 * own shape and is passed to the catalogue untouched: who ordered a dish is none of the
 * pricing service's business.
 *
 * `addedBySessionId` and `addedByName` tolerate a missing value rather than failing the whole
 * entry, because a basket written before the table shared it has neither and must still read.
 */
export const cartLineEntry = z.object({
  lineId: z.string(),
  addedBySessionId: z.string().nullable().catch(null),
  addedByName: z.string().nullable().catch(null),
  line: cartLineInput,
});
export type CartLineEntry = z.infer<typeof cartLineEntry>;

/**
 * One person at the table.
 *
 * The name is assigned by the server from a word list, never asked for. A diner who has just
 * sat down will not type their name to add a dish, and a free-text field shared with strangers
 * at the next table is a field somebody writes something unpleasant into. A random name is
 * enough to answer the only question attribution has to answer - "whose naan is that" - and
 * it is stable for as long as the basket lives.
 */
export const cartMemberDto = z.object({
  sessionId: z.string(),
  name: z.string(),
  /** True for the member doing the asking, so a client never has to compare session ids. */
  isYou: z.boolean(),
  joinedAt: wireDate,
});

/**
 * Who added a line, positionally parallel to `priced.lines`.
 *
 * Kept beside the priced lines rather than inside them because pricing is the catalogue's
 * job and who ordered a dish is none of its business. The service pairs them by position,
 * which is sound because it controls both the order it sends and the order it receives - and
 * if the two ever disagree in length it drops attribution entirely rather than guess, since
 * putting somebody else's dish against your name is worse than showing no name at all.
 */
export const cartLineOwnerDto = z.object({
  lineId: z.string(),
  addedByName: z.string().nullable(),
  isMine: z.boolean(),
});

export const cartDto = z.object({
  id: z.string(),
  branchId: z.string(),
  placeId: z.string().nullable(),
  /** Snapshotted when staff allocate, so the guest is told where to go, not just an id. */
  placeLabel: z.string().nullable(),
  placeKind: z.enum(["table", "seat"]).nullable(),
  status: z.enum(CART_STATUSES),
  guestName: z.string().nullable(),
  orderType: z.enum(ORDER_TYPES),
  couponCode: z.string().nullable(),
  priced: pricedCartDto,
  /**
   * True when this basket belongs to a place rather than to one phone. Everybody who scans
   * the code on table twelve lands in the same basket; a walk-in who has not been seated yet
   * has no place, so their basket stays their own until staff allocate one.
   */
  isShared: z.boolean(),
  members: z.array(cartMemberDto),
  attribution: z.array(cartLineOwnerDto),
  /**
   * Bumped on every change. A watcher that has been told to re-read compares this against
   * what it already holds, so a notice that arrives after the read it describes is ignored
   * instead of causing a second pointless round trip.
   */
  version: z.number().int(),
  updatedAt: wireDate,
});

export const cartContract = {
  /**
   * A guest asking with no id gets their own basket. Staff get the queue: every basket sent
   * from the door that is still waiting for somewhere to sit. One operation, because it is
   * the same question asked by two people with different scopes.
   */
  read: {
    input: z.object({
      id: z.string().optional(),
      branchId: z.string().optional(),
      status: z.enum(CART_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().nullish(),
    }),
    output: z.object({ items: z.array(cartDto), nextCursor: z.string().nullable() }),
  },
  create: {
    input: z.object({
      branchId: z.string(),
      placeId: z.string().nullable().optional(),
      orderType: z.enum(ORDER_TYPES).default("dine_in"),
      lines: z.array(cartLineInput).max(50).default([]),
    }),
    output: cartDto,
  },
  /**
   * One change at a time, named.
   *
   * This used to take the whole line list and replace it, with a comment explaining that a
   * cart is small and a merge is a race. That was true while a basket belonged to one phone.
   * It is exactly wrong once three people share one: two phones each sending a whole list
   * means the slower write erases the faster one's dish, silently, and the person who lost it
   * finds out when the food does not arrive. So the operations are line-level and commutative
   * instead - two people adding at the same moment both get their dish, because neither
   * message says anything about the other's.
   *
   * `lineId` is minted by the client, which makes every one of these idempotent: a retry after
   * a dropped connection re-adds nothing and re-removes nothing.
   */
  update: {
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("add_line"),
        id: z.string(),
        lineId: z.string().min(8).max(64),
        line: cartLineInput,
      }),
      z.object({
        action: z.literal("set_quantity"),
        id: z.string(),
        lineId: z.string().min(8).max(64),
        /** Zero is not a quantity; removing is its own action, so intent is never inferred. */
        quantity: z.number().int().min(1).max(99),
      }),
      z.object({
        action: z.literal("remove_line"),
        id: z.string(),
        lineId: z.string().min(8).max(64),
      }),
      z.object({
        action: z.literal("set_coupon"),
        id: z.string(),
        couponCode: z.string().max(30).nullable(),
      }),
      z.object({
        action: z.literal("set_order_type"),
        id: z.string(),
        orderType: z.enum(ORDER_TYPES),
      }),
      /**
       * The walk-in handshake, still two halves of one endpoint. A guest says they are ready
       * and joins the queue; staff seat them. The service decides who may do which by who is
       * asking - `request_place` refuses staff and `allocate` refuses a guest, so neither can
       * be reached by sending the other's body.
       */
      z.object({ action: z.literal("request_place"), id: z.string() }),
      z.object({
        action: z.literal("allocate"),
        id: z.string(),
        placeId: z.string(),
      }),
    ]),
    output: cartDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * Closing the basket a place is holding, because the party that owned it has gone.
   *
   * Addressed by PLACE and not by cart id, because the caller is the floor service clearing a
   * table and it has no business knowing a cart id - it knows which table it just freed. The
   * basket is not deleted: an abandoned basket is a real thing that happened at that table,
   * and it is what the next scan has to step over rather than inherit.
   */
  manage: {
    input: z.object({
      action: z.literal("close_at_place"),
      placeId: z.string(),
    }),
    /**
     * `id` names the basket that was closed, or null when the table was already clear. It is
     * spelled `id` deliberately: that is the field the block reads to announce the change on
     * `notice.cart.<id>`, so the phones still holding this basket open are told it closed
     * instead of finding out when their next tap is refused.
     */
    output: z.object({ id: z.string().nullable(), closed: z.number().int().min(0) }),
  },
} as const;

/* ── Order ───────────────────────────────────────────────────────────────── */

export const orderDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  branchId: z.string(),
  placeId: z.string().nullable(),
  placeLabel: z.string().nullable(),
  customerId: z.string().nullable(),
  guestName: z.string().nullable(),
  guestPhone: z.string().nullable(),
  orderNumber: z.string(),
  orderType: z.enum(ORDER_TYPES),
  source: z.enum(ORDER_SOURCES),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  lines: z.array(pricedLineDto),
  subtotalPaise: nonNegativePaise,
  discountPaise: nonNegativePaise,
  taxPaise: nonNegativePaise,
  serviceChargePaise: nonNegativePaise,
  packagingPaise: nonNegativePaise,
  totalPaise: nonNegativePaise,
  currency: z.string(),
  couponCode: z.string().nullable(),
  notes: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  placedAt: wireDate,
  acceptedAt: wireDate.nullable(),
  readyAt: wireDate.nullable(),
  completedAt: wireDate.nullable(),
  createdAt: wireDate,
  updatedAt: wireDate,
});

export const orderContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      branchId: z.string().optional(),
      placeId: z.string().optional(),
      customerId: z.string().optional(),
      status: z.enum(ORDER_STATUSES).optional(),
      /** The staff console's four tabs, expanded server-side into status sets. */
      bucket: z.enum(["new", "active", "completed", "cancelled", "refunded", "all"]).optional(),
      from: wireDate.optional(),
      to: wireDate.optional(),
    }),
    output: pageOf(orderDto),
  },
  /**
   * No price, no total, no tax. The service prices the lines against the catalogue and
   * refuses anything it cannot price. A field for money here would be a field an attacker
   * could fill in.
   */
  create: {
    input: z
      .object({
        branchId: z.string(),
        orderType: z.enum(ORDER_TYPES),
        placeId: z.string().nullable().optional(),
        cartId: z.string().optional(),
        /**
         * Empty is allowed ONLY when a basket is named: a table sharing one holds its dishes on
         * the server, so the phone confirming has none of its own. The service reads the
         * basket and refuses an empty one; this refine refuses "no dishes and no basket".
         */
        lines: z.array(cartLineInput).max(50).default([]),
        couponCode: z.string().max(30).optional(),
        notes: z.string().max(500).optional(),
        ...guestContact,
      })
      .superRefine((value, ctx) => {
        if (value.lines.length === 0 && value.cartId === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["lines"],
            message: "Add at least one dish to order.",
          });
        }
        if (value.orderType === "dine_in" && value.placeId == null) {
          ctx.addIssue({
            code: "custom",
            path: ["placeId"],
            message: "A dine-in order belongs to a table.",
          });
        }
      }),
    output: orderDto,
  },
  /** Staff corrections that are not status changes: a note, a table move, guest details. */
  update: {
    input: z.object({
      id: z.string(),
      placeId: z.string().nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
      ...guestContact,
    }),
    output: orderDto,
  },
  /**
   * Every status change. The legal transitions live in the orders service as one map, and an
   * illegal one is a conflict rather than a silent write - so this input names a target, not
   * an arbitrary status field somebody could set from anywhere.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("accept"), id: z.string() }),
      z.object({ action: z.literal("start_preparing"), id: z.string() }),
      z.object({ action: z.literal("mark_ready"), id: z.string() }),
      z.object({ action: z.literal("mark_served"), id: z.string() }),
      z.object({ action: z.literal("complete"), id: z.string() }),
      z.object({
        action: z.literal("cancel"),
        id: z.string(),
        reason: z.string().min(3).max(300),
      }),
    ]),
    output: orderDto,
  },
} as const;

/* ── Kitchen ─────────────────────────────────────────────────────────────── */

/**
 * A ticket is built from the order's item lines and its combo CHILD lines - the combo parent
 * is a price, and a kitchen cannot cook a price.
 */
export const kitchenTicketLineDto = z.object({
  nameSnapshot: z.string(),
  variantNameSnapshot: z.string().nullable(),
  quantity: z.number().int(),
  modifiers: z.array(z.string()),
  notes: z.string().nullable(),
  /** Set when this line came from inside a combo, so the pass can plate them together. */
  comboNameSnapshot: z.string().nullable(),
});

export const kitchenTicketDto = z.object({
  id: z.string(),
  orderId: z.string(),
  branchId: z.string(),
  stationId: z.string().nullable(),
  stationName: z.string().nullable(),
  ticketNumber: z.number().int(),
  orderNumber: z.string(),
  placeLabel: z.string().nullable(),
  status: z.enum(KITCHEN_STATUSES),
  priority: z.enum(["normal", "high"]),
  estimatedMinutes: z.number().int().nullable(),
  /** Age in seconds at read time, so a display does not have to trust the device clock. */
  ageSeconds: z.number().int(),
  isDelayed: z.boolean(),
  lines: z.array(kitchenTicketLineDto),
  createdAt: wireDate,
});

export const kitchenTicketContract = {
  read: {
    input: z.object({
      ...cursorPage,
      branchId: z.string(),
      stationId: z.string().optional(),
      status: z.enum(KITCHEN_STATUSES).optional(),
      bucket: z.enum(["new", "preparing", "ready", "delayed", "all"]).default("all"),
    }),
    output: pageOf(kitchenTicketDto),
  },
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("accept"), id: z.string() }),
      z.object({ action: z.literal("start"), id: z.string() }),
      z.object({ action: z.literal("ready"), id: z.string() }),
      z.object({
        action: z.literal("set_priority"),
        id: z.string(),
        priority: z.enum(["normal", "high"]),
      }),
      z.object({
        action: z.literal("route"),
        id: z.string(),
        stationId: z.string().nullable(),
      }),
    ]),
    output: kitchenTicketDto,
  },
} as const;

/* ── Payment ─────────────────────────────────────────────────────────────── */

export const paymentDto = z.object({
  id: z.string(),
  orderId: z.string(),
  provider: z.string(),
  providerOrderId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  method: z.enum(PAYMENT_METHODS).nullable(),
  amountPaise: nonNegativePaise,
  refundedPaise: nonNegativePaise,
  currency: z.string(),
  status: z.enum(["created", "pending", "authorized", "captured", "failed", "refunded"]),
  /**
   * True only once a webhook signature has been verified. A client-side success screen never
   * sets it, which is why it is on the wire at all: the UI has to be able to tell the two apart.
   */
  signatureVerified: z.boolean(),
  createdAt: wireDate,
  updatedAt: wireDate,
});

export const paymentContract = {
  read: {
    input: z.object({ ...cursorPage, orderId: z.string().optional(), id: z.string().optional() }),
    output: pageOf(paymentDto),
  },
  /**
   * Opens a payment with the provider and hands back what the client needs to complete it.
   * It marks nothing paid: only a signature-verified webhook may do that, through `manage`.
   */
  create: {
    input: z.object({
      orderId: z.string(),
      method: z.enum(PAYMENT_METHODS),
    }),
    output: z.object({
      payment: paymentDto,
      /** Opaque provider handoff. The service builds it; the client only forwards it. */
      checkout: z.object({
        provider: z.string(),
        providerOrderId: z.string(),
        amountPaise: nonNegativePaise,
        currency: z.string(),
        publicKey: z.string().nullable(),
        redirectUrl: z.string().nullable(),
      }),
    }),
  },
  manage: {
    input: z.discriminatedUnion("action", [
      /**
       * Called only from the webhook route, and only after its signature has been verified
       * there. The service checks the provider's own record again before it moves an order.
       */
      z.object({
        action: z.literal("reconcile"),
        providerPaymentId: z.string(),
        providerOrderId: z.string(),
        outcome: z.enum(["captured", "failed"]),
        method: z.enum(PAYMENT_METHODS).optional(),
        amountPaise: nonNegativePaise,
      }),
      z.object({
        action: z.literal("refund"),
        id: z.string(),
        amountPaise: nonNegativePaise.min(1),
        reason: z.string().min(3).max(300),
      }),
      z.object({
        action: z.literal("record_cash"),
        orderId: z.string(),
        amountPaise: nonNegativePaise.min(1),
      }),
    ]),
    output: paymentDto,
  },
} as const;
