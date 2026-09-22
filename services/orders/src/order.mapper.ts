/**
 * SOT: order-mapper, order-dto, priced-line-rehydration, kitchen-ticket-lines
 * WHAT   Turns stored order rows back into the priced shape the contract describes.
 * WHY    An order is written once and read many times, by the customer tracking it, the
 *        console working it and the receipt explaining it. Rebuilding that shape in three
 *        places is how three screens end up disagreeing about a total.
 * HOW    Parent lines carry money; a combo's children are attached to their parent and
 *        always read back as zero, so a caller summing the lines it is given cannot
 *        double-count. Nothing here recomputes a price - it reads what was stored.
 * WHERE  services/orders/src/order.handlers.ts, services/orders/src/kitchen.handlers.ts
 */
import "server-only";

import { isOrderStatus, type OrderStatus } from "./constants";
import type { OrderItemModifierRow, OrderItemRow, OrderRow } from "./schema";

const ORDER_TYPES = ["dine_in", "takeaway", "pickup", "delivery"] as const;
const ORDER_SOURCES = ["marketplace", "qr", "manual"] as const;
const PAYMENT_STATUSES = ["pending", "paid", "partially_refunded", "refunded", "failed"] as const;

type OrderType = (typeof ORDER_TYPES)[number];
type OrderSource = (typeof ORDER_SOURCES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The status columns are plain `text` - a Postgres enum is a migration every time the
 * product learns a word. Narrowing happens here, on the way out, against the same unions the
 * contract publishes, and an unrecognised value falls back rather than being asserted.
 */
const asOrderType = (value: string): OrderType =>
  ORDER_TYPES.find((candidate) => candidate === value) ?? "dine_in";

const asSource = (value: string): OrderSource =>
  ORDER_SOURCES.find((candidate) => candidate === value) ?? "qr";

const asPaymentStatus = (value: string): PaymentStatus =>
  PAYMENT_STATUSES.find((candidate) => candidate === value) ?? "pending";

export const asOrderStatus = (value: string): OrderStatus =>
  isOrderStatus(value) ? value : "created";

function toItemLine(row: OrderItemRow, modifiers: readonly OrderItemModifierRow[]) {
  return {
    kind: "item" as const,
    itemId: row.menuItemId ?? "",
    variantId: row.variantId,
    nameSnapshot: row.nameSnapshot,
    variantNameSnapshot: row.variantNameSnapshot,
    quantity: row.quantity,
    unitPricePaise: row.unitPricePaise,
    lineTotalPaise: row.lineTotalPaise,
    modifiers: modifiers
      .filter((modifier) => modifier.orderItemId === row.id)
      .map((modifier) => ({
        modifierId: modifier.modifierId ?? "",
        optionId: modifier.modifierOptionId ?? "",
        nameSnapshot: modifier.nameSnapshot,
        priceDeltaPaise: modifier.priceDeltaPaise,
      })),
    taxPercent: Number(row.taxPercent),
    taxPaise: row.taxPaise,
    notes: row.notes,
  };
}

function toComboLine(row: OrderItemRow, children: readonly OrderItemRow[]) {
  return {
    kind: "combo" as const,
    comboId: row.comboId ?? "",
    nameSnapshot: row.nameSnapshot,
    quantity: row.quantity,
    unitPricePaise: row.unitPricePaise,
    lineTotalPaise: row.lineTotalPaise,
    referencePricePaise: row.referencePricePaise ?? row.lineTotalPaise,
    savingsPaise: row.savingsPaise ?? 0,
    taxPercent: Number(row.taxPercent),
    taxPaise: row.taxPaise,
    notes: row.notes,
    children: children
      .filter((child) => child.parentOrderItemId === row.id)
      .map((child) => ({
        itemId: child.menuItemId ?? "",
        variantId: child.variantId,
        nameSnapshot: child.nameSnapshot,
        variantNameSnapshot: child.variantNameSnapshot,
        quantity: child.quantity,
        unitPriceSnapshotPaise: child.unitPricePaise,
        lineTotalPaise: 0 as const,
      })),
  };
}

export function toPricedLines(
  lines: readonly OrderItemRow[],
  modifiers: readonly OrderItemModifierRow[],
) {
  /** Parents only. A child is reached through its parent, never listed beside it. */
  return lines
    .filter((row) => row.parentOrderItemId === null)
    .map((row) =>
      row.lineKind === "combo" ? toComboLine(row, lines) : toItemLine(row, modifiers),
    );
}

export function toOrderDto(
  row: OrderRow,
  lines: readonly OrderItemRow[],
  modifiers: readonly OrderItemModifierRow[],
) {
  const mine = lines.filter((line) => line.orderId === row.id);
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    branchId: row.branchId,
    placeId: row.placeId,
    placeLabel: row.placeLabel,
    customerId: row.customerId,
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    orderNumber: row.orderNumber,
    orderType: asOrderType(row.orderType),
    source: asSource(row.source),
    status: asOrderStatus(row.status),
    paymentStatus: asPaymentStatus(row.paymentStatus),
    lines: toPricedLines(mine, modifiers),
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    taxPaise: row.taxPaise,
    serviceChargePaise: row.serviceChargePaise,
    packagingPaise: row.packagingPaise,
    totalPaise: row.totalPaise,
    currency: row.currency,
    couponCode: row.couponCode,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    placedAt: row.placedAt,
    acceptedAt: row.acceptedAt,
    readyAt: row.readyAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * What the kitchen actually cooks: item lines and combo CHILDREN, never the combo parent.
 * The parent is a price, and a kitchen cannot plate a price - but the child says which combo
 * it belongs to so the pass can send them out together.
 */
export function toTicketLines(
  lines: readonly OrderItemRow[],
  modifiers: readonly OrderItemModifierRow[],
) {
  return lines
    .filter((row) => row.lineKind !== "combo")
    .map((row) => {
      const parent =
        row.parentOrderItemId === null
          ? null
          : (lines.find((candidate) => candidate.id === row.parentOrderItemId) ?? null);
      return {
        nameSnapshot: row.nameSnapshot,
        variantNameSnapshot: row.variantNameSnapshot,
        quantity: row.quantity,
        modifiers: modifiers
          .filter((modifier) => modifier.orderItemId === row.id)
          .map((modifier) => modifier.nameSnapshot),
        notes: row.notes,
        comboNameSnapshot: parent === null ? null : parent.nameSnapshot,
      };
    });
}
