/**
 * SOT: orders-handlers, orders-handler-list
 * WHAT   Every handler the orders service serves, in one flat list.
 * WHY    defineService asserts at boot that this list covers exactly the resources the
 *        registry says this service owns. A missing handler is a crash on `make dev`.
 * WHERE  services/orders/src/index.ts
 */
import "server-only";

import { cartHandlers } from "./cart.handlers";
import { kitchenHandlers } from "./kitchen.handlers";
import { orderHandlers } from "./order.handlers";
import { paymentHandlers } from "./payment.handlers";

export const handlers = [...cartHandlers, ...orderHandlers, ...kitchenHandlers, ...paymentHandlers];
