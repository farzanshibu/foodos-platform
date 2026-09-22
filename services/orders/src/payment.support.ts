/**
 * SOT: payment-support, order-status-narrowing
 * WHAT   The two helpers the payment handlers need from the order state machine.
 * WHY    Re-exported through one file so payment.handlers.ts imports the transition rules
 *        rather than re-deciding them, and so narrowing a stored status happens in exactly
 *        one place across this service.
 * WHERE  services/orders/src/constants.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";

import { isOrderStatus, type OrderStatus } from "./constants";

export { assertTransition } from "./constants";

/**
 * Narrows a stored status, and refuses rather than falling back. A payment is about to move
 * money; guessing at a status we cannot read is exactly the wrong place to be forgiving.
 */
export function asOrderStatusOrThrow(value: string): OrderStatus {
  if (!isOrderStatus(value)) {
    throw new ServiceError("INTERNAL", `Unrecognised order status "${value}".`);
  }
  return value;
}
