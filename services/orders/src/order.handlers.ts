/**
 * SOT: order-handlers, order-create, order-status-transitions, order-pricing-call
 * WHAT   Business rules for placing an order and moving it through its life.
 * WHY    The rule that matters most is what is NOT here: no price is calculated in this file
 *        and none is read from the caller. The catalogue prices the lines, over the bus, and
 *        this service stores what it was told. A price a caller can send is a price a caller
 *        can choose.
 * HOW    Every status change goes through assertTransition, so an illegal move is a conflict
 *        the caller is told about rather than a corrupt order nobody notices.
 * WHERE  services/catalog/src/quote.handlers.ts, services/orders/src/constants.ts
 */
import "server-only";

import { type InputOf, ServiceError } from "@foodos/contracts";
import { handlerFor, type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";
import { openCart } from "./cart.handlers";
import {
  ACTIVE_ORDER_STATUSES,
  assertTransition,
  CANCELLED_ORDER_STATUSES,
  NEW_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "./constants";
import { asOrderStatus, toOrderDto, toTicketLines } from "./order.mapper";
import { cartService, kitchenService, orderService } from "./order.service";
import type { orderItem, orderItemModifier } from "./schema";
import { readEntries } from "./table-party";

type PricedCart = Awaited<ReturnType<typeof priceLines>>;
type ManageInput = InputOf<"order", "manage">;

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

/**
 * The pricing call. `serviceCall` inherits the org, the user, the role and the deadline from
 * the request that got us here, so an order placed by a guest can only ever price against
 * that guest's own restaurant - and this service still never imports the catalogue or reads
 * one of its tables.
 */
function priceLines(ctx: ServiceContext, input: InputOf<"quote", "read">) {
  return serviceCall({
    ctx,
    resource: "quote",
    operation: "read",
    input,
    secret: env.envelopeSecret(),
  });
}

/**
 * Which restaurant a branch belongs to. Asked of the catalogue rather than taken from the
 * caller, because an order that names its own restaurant is an order that can be filed under
 * somebody else's. The branch is required: without it there is no restaurant to file under
 * and no menu the lines could have come from.
 */
async function restaurantOf(ctx: ServiceContext, branchId: string): Promise<string> {
  const found = await serviceCall({
    ctx,
    resource: "branch",
    operation: "read",
    input: { id: branchId, limit: 1, cursor: null },
    secret: env.envelopeSecret(),
  });
  const [branch] = found.items;
  if (branch === undefined) throw new ServiceError("NOT_FOUND", "That branch does not exist.");
  return branch.restaurantId;
}

/**
 * The table's number, snapshotted so a receipt still reads "T12" after the floor plan is
 * redrawn. Best-effort on purpose: this is a label, and a floor service having a bad minute
 * must not stop a table from ordering. The order still carries the table id either way.
 */
async function placeLabelOf(
  ctx: ServiceContext,
  placeId: string | null | undefined,
): Promise<string | null> {
  if (placeId === null || placeId === undefined) return null;
  try {
    const found = await serviceCall({
      ctx,
      resource: "place",
      operation: "read",
      input: {
        id: placeId,
        limit: 1,
        cursor: null,
        parameterFilters: [],
        customerVisibleParametersOnly: true,
      },
      secret: env.envelopeSecret(),
    });
    return found.items[0]?.label ?? null;
  } catch (error) {
    console.warn("[orders] could not read the table number for the receipt", error);
    return null;
  }
}

/** Which statuses a console tab means. Expanded here so no caller writes a status list. */
function statusesFor(bucket: string | undefined, status: OrderStatus | undefined) {
  if (status !== undefined) return [status];
  switch (bucket) {
    case "new":
      return NEW_ORDER_STATUSES;
    case "active":
      return ACTIVE_ORDER_STATUSES;
    case "completed":
      return ["completed"] as const;
    case "cancelled":
      return CANCELLED_ORDER_STATUSES;
    case "refunded":
      return ["refunded"] as const;
    default:
      return undefined;
  }
}

async function loadOrder(organizationId: string, id: string) {
  const row = await orderService.byId({ organizationId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Order not found.");
  const { lines, modifiers } = await orderService.linesFor({
    organizationId,
    orderIds: [row.id],
  });
  return toOrderDto(row, lines, modifiers);
}

/**
 * Writes the priced cart down as order lines. A combo becomes one parent line holding the
 * money and one child line per constituent holding zero, so the invariant the console and
 * the receipt both rely on - subtotal is the sum over parentless lines - holds by construction.
 */
async function persistLines(args: {
  organizationId: string;
  orderId: string;
  priced: PricedCart;
  /**
   * Who chose each line, positionally parallel to the priced lines, or empty when the basket
   * was never shared. Only parent lines carry a name: a combo's constituents belong to the
   * combo, not to a second person, and printing a name against each of them would suggest
   * three people ordered one thali between them.
   */
  addedBy: readonly (string | null)[];
}) {
  const parents: Array<typeof orderItem.$inferInsert> = [];
  const children: Array<typeof orderItem.$inferInsert> = [];
  const modifiers: Array<typeof orderItemModifier.$inferInsert> = [];

  for (const [index, line] of args.priced.lines.entries()) {
    const parentId = crypto.randomUUID();
    const addedByName = args.addedBy[index] ?? null;
    if (line.kind === "item") {
      parents.push({
        id: parentId,
        organizationId: args.organizationId,
        orderId: args.orderId,
        lineKind: "item",
        parentOrderItemId: null,
        menuItemId: line.itemId,
        variantId: line.variantId,
        nameSnapshot: line.nameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.lineTotalPaise,
        taxPercent: String(line.taxPercent),
        taxPaise: line.taxPaise,
        notes: line.notes,
        addedByName,
      });
      for (const modifier of line.modifiers) {
        modifiers.push({
          id: crypto.randomUUID(),
          organizationId: args.organizationId,
          orderItemId: parentId,
          modifierId: modifier.modifierId,
          modifierOptionId: modifier.optionId,
          nameSnapshot: modifier.nameSnapshot,
          priceDeltaPaise: modifier.priceDeltaPaise,
        });
      }
      continue;
    }

    parents.push({
      id: parentId,
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineKind: "combo",
      parentOrderItemId: null,
      comboId: line.comboId,
      nameSnapshot: line.nameSnapshot,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      lineTotalPaise: line.lineTotalPaise,
      referencePricePaise: line.referencePricePaise,
      savingsPaise: line.savingsPaise,
      taxPercent: String(line.taxPercent),
      taxPaise: line.taxPaise,
      notes: line.notes,
      addedByName,
    });

    for (const child of line.children) {
      children.push({
        id: crypto.randomUUID(),
        organizationId: args.organizationId,
        orderId: args.orderId,
        lineKind: "combo_child",
        parentOrderItemId: parentId,
        menuItemId: child.itemId,
        variantId: child.variantId,
        nameSnapshot: child.nameSnapshot,
        variantNameSnapshot: child.variantNameSnapshot,
        quantity: child.quantity,
        unitPricePaise: child.unitPriceSnapshotPaise,
        /** Zero, always. The parent already carries this combo's money. */
        lineTotalPaise: 0,
        taxPercent: "0",
        taxPaise: 0,
      });
    }
  }

  await orderService.insertLines(parents);
  await orderService.insertLines(children);
  await orderService.insertModifiers(modifiers);
}

/**
 * The action a console tab fires, mapped to the status it means. A switch rather than a
 * keyed object because the action names are wire values and therefore snake_case, and this
 * way the exhaustiveness is still checked without a second vocabulary or a lint exemption.
 */
function targetOf(action: ManageInput["action"]): OrderStatus {
  switch (action) {
    case "accept":
      return "accepted";
    case "start_preparing":
      return "preparing";
    case "mark_ready":
      return "ready";
    case "mark_served":
      return "served";
    case "complete":
      return "completed";
    default:
      return "cancelled_by_restaurant";
  }
}

const TIMESTAMP_OF: Partial<Record<OrderStatus, "acceptedAt" | "readyAt" | "completedAt">> = {
  accepted: "acceptedAt",
  ready: "readyAt",
  completed: "completedAt",
};

export const orderHandlers = [
  handlerFor("order", "read", async ({ ctx, input }) => {
    const statuses = statusesFor(input.bucket, input.status);
    const page = await orderService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.id, "id"),
      ...set(input.branchId, "branchId"),
      ...set(input.placeId, "placeId"),
      ...set(input.customerId, "customerId"),
      ...set(statuses, "statuses"),
      ...set(input.from, "from"),
      ...set(input.to, "to"),
      /**
       * A guest sees their own session's orders and nothing else. Staff hold a role above
       * guest, so they are not narrowed - the registry already decided who may call this.
       */
      ...(ctx.role === "guest" ? { sessionId: ctx.userId } : {}),
    });
    const { lines, modifiers } = await orderService.linesFor({
      organizationId: ctx.orgId,
      orderIds: page.items.map((row) => row.id),
    });
    return {
      items: page.items.map((row) => toOrderDto(row, lines, modifiers)),
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("order", "create", async ({ ctx, input }) => {
    /**
     * When a basket is named, the basket is the truth - not the copy of it the browser sent.
     *
     * That matters most for a table sharing one: the phone confirming holds whatever it last
     * read, which is already stale if somebody added a dish a second ago, and it has no
     * honest way to know who added what. Reading the basket server-side gets both right, and
     * closes the ordinary hole of a client sending a line list that is not what it was shown.
     */
    const basket = input.cartId === undefined ? null : await openCart(ctx, input.cartId);
    const entries = basket === null ? [] : readEntries(basket.lines);
    const lines = basket === null ? input.lines : entries.map((entry) => entry.line);
    if (lines.length === 0) {
      throw new ServiceError("INVALID_INPUT", "There is nothing in this basket to order.");
    }

    const priced = await priceLines(ctx, {
      branchId: input.branchId,
      lines,
      orderType: input.orderType,
      ...set(input.couponCode, "couponCode"),
    });

    const orderId = crypto.randomUUID();
    const created = await orderService.create({
      id: orderId,
      organizationId: ctx.orgId,
      restaurantId: await restaurantOf(ctx, input.branchId),
      branchId: input.branchId,
      placeId: input.placeId ?? null,
      placeLabel: await placeLabelOf(ctx, input.placeId),
      customerId: null,
      sessionId: ctx.role === "guest" ? ctx.userId : null,
      guestName: input.guestName ?? null,
      guestPhone: input.guestPhone ?? null,
      guestEmail: input.guestEmail ?? null,
      orderNumber: await orderService.nextOrderNumber({
        organizationId: ctx.orgId,
        branchId: input.branchId,
      }),
      orderType: input.orderType,
      source: ctx.role === "guest" ? "qr" : "manual",
      status: "payment_pending",
      paymentStatus: "pending",
      subtotalPaise: priced.subtotalPaise,
      discountPaise: priced.discountPaise,
      taxPaise: priced.taxPaise,
      serviceChargePaise: priced.serviceChargePaise,
      packagingPaise: priced.packagingPaise,
      totalPaise: priced.totalPaise,
      currency: priced.currency,
      couponCode: input.couponCode ?? null,
      notes: input.notes ?? null,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The order was not created.");

    await persistLines({
      organizationId: ctx.orgId,
      orderId,
      priced,
      addedBy: entries.map((entry) => entry.addedByName),
    });

    /**
     * The basket is spent. Marking it converted is what makes the next person to scan this
     * table start a fresh one rather than walk into a basket that has already been cooked -
     * and it tells the other phones still holding it open, through the ordinary notice.
     */
    if (basket !== null) {
      await cartService.update({
        organizationId: ctx.orgId,
        id: basket.id,
        patch: { status: "converted" },
      });
    }
    return loadOrder(ctx.orgId, orderId);
  }),

  handlerFor("order", "update", async ({ ctx, input }) => {
    const updated = await orderService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.placeId, "placeId"),
        ...set(input.notes, "notes"),
        ...set(input.guestName, "guestName"),
        ...set(input.guestPhone, "guestPhone"),
        ...set(input.guestEmail, "guestEmail"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Order not found.");
    return loadOrder(ctx.orgId, input.id);
  }),

  handlerFor("order", "manage", async ({ ctx, input }) => {
    const existing = await orderService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Order not found.");

    const from = asOrderStatus(existing.status);
    const to = targetOf(input.action);
    assertTransition(ORDER_TRANSITIONS, from, to, "order");

    const stamp = TIMESTAMP_OF[to];
    await orderService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        status: to,
        ...(stamp === undefined ? {} : { [stamp]: new Date() }),
        ...(input.action === "cancel" ? { cancellationReason: input.reason } : {}),
      },
    });

    /** Accepting an order is what puts it in front of the kitchen, not placing it. */
    if (to === "accepted") {
      const { lines, modifiers } = await orderService.linesFor({
        organizationId: ctx.orgId,
        orderIds: [existing.id],
      });
      if (toTicketLines(lines, modifiers).length > 0) {
        await kitchenService.create({
          id: crypto.randomUUID(),
          organizationId: ctx.orgId,
          branchId: existing.branchId,
          orderId: existing.id,
          stationId: null,
          ticketNumber: await kitchenService.nextTicketNumber({
            organizationId: ctx.orgId,
            branchId: existing.branchId,
          }),
          status: "pending",
        });
      }
    }

    return loadOrder(ctx.orgId, input.id);
  }),
];
