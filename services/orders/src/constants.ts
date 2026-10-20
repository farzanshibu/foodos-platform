/**
 * SOT: order-state-machine, order-transitions, kitchen-state-machine, assert-transition
 * WHAT   The legal shape of an order's life, and the one function allowed to move it.
 * WHY    A status set inline is a status set to anything. Every write goes through
 *        assertTransition, so "paid twice", "ready before accepted" and "uncancel" are
 *        conflicts a caller is told about rather than states the database quietly holds.
 * HOW    Unions and a transition map, both `as const`, so an unhandled status is a compile
 *        error rather than a branch nobody wrote.
 * NOTE   This file is on the `useNamingConvention` exemption list in biome.json, for the same
 *        reason packages/contracts/src/errors.ts is: the keys of these maps ARE the wire
 *        values, which are snake_case because the contract says so. Renaming them to satisfy
 *        the linter would mean a second vocabulary for statuses and a translation between the
 *        two - which is precisely the kind of parallel list this codebase exists to avoid.
 * WHERE  services/orders/src/order.handlers.ts, services/orders/src/kitchen.handlers.ts
 */
import { ServiceError } from "@foodos/contracts";

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
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * What each status may become. A terminal state has no exits, which is what makes
 * "reopen a completed order" impossible rather than merely discouraged.
 *
 * `payment_failed` returns to `payment_pending` on purpose: a card that was declined is a
 * card somebody tries again, and forcing a new order would lose the table's basket.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ["payment_pending", "paid", "cancelled_by_customer", "cancelled_by_restaurant"],
  // Pay-at-the-end: a dine-in order can be accepted before it is paid, and the bill is settled
  // later without touching the fulfilment status (see recordCash).
  payment_pending: [
    "paid",
    "accepted",
    "payment_failed",
    "cancelled_by_customer",
    "cancelled_by_restaurant",
  ],
  payment_failed: ["payment_pending", "cancelled_by_customer", "cancelled_by_restaurant"],
  paid: ["accepted", "cancelled_by_restaurant", "refunded"],
  accepted: ["preparing", "cancelled_by_restaurant"],
  preparing: ["ready", "cancelled_by_restaurant"],
  ready: ["served"],
  served: ["completed"],
  completed: ["refunded"],
  cancelled_by_customer: [],
  cancelled_by_restaurant: [],
  refunded: [],
};

/** The statuses a restaurant is actively working on. Drives the console's default view. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "payment_pending",
  "paid",
  "accepted",
  "preparing",
  "ready",
  "served",
];

export const NEW_ORDER_STATUSES: readonly OrderStatus[] = ["created", "payment_pending", "paid"];

export const CANCELLED_ORDER_STATUSES: readonly OrderStatus[] = [
  "cancelled_by_customer",
  "cancelled_by_restaurant",
  "payment_failed",
];

export const KITCHEN_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export const KITCHEN_TRANSITIONS: Readonly<Record<KitchenStatus, readonly KitchenStatus[]>> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served"],
  served: [],
  cancelled: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.some((candidate) => candidate === value);
}

export function isKitchenStatus(value: string): value is KitchenStatus {
  return KITCHEN_STATUSES.some((candidate) => candidate === value);
}

/**
 * The only way a status changes. Named "assert" rather than "can" because the refusal is the
 * point: a caller that wanted to know first can read the map, and a caller that just wrote
 * gets a conflict instead of a corrupt order.
 */
export function assertTransition<T extends string>(
  map: Readonly<Record<T, readonly T[]>>,
  from: T,
  to: T,
  noun: string,
): void {
  if (from === to) {
    throw new ServiceError("CONFLICT", `This ${noun} is already ${to.replace(/_/g, " ")}.`);
  }
  if (!map[from].some((candidate) => candidate === to)) {
    throw new ServiceError(
      "CONFLICT",
      `A ${noun} that is ${from.replace(/_/g, " ")} cannot become ${to.replace(/_/g, " ")}.`,
    );
  }
}
