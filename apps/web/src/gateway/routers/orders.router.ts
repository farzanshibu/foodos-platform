/**
 * SOT: orders-gateway-router, cart-routes, order-routes, kitchen-routes, payment-routes
 * WHAT   The whole gateway surface of ordering: the cart, the order, the kitchen ticket and
 *        the payment.
 * WHY    A route is a routing decision. Business logic lives in services/orders, and the
 *        prices come from the catalogue - never from a caller and never from here.
 * WHERE  packages/core/src/gateway.ts, services/orders
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const cartRouter = createTRPCRouter({
  get: gatewayQuery("cart", "read"),
  create: gatewayMutation("cart", "create"),
  update: gatewayMutation("cart", "update"),
  remove: gatewayMutation("cart", "delete"),
});

export const orderRouter = createTRPCRouter({
  list: gatewayQuery("order", "read"),
  create: gatewayMutation("order", "create"),
  update: gatewayMutation("order", "update"),
  setStatus: gatewayMutation("order", "manage"),
});

export const kitchenTicketRouter = createTRPCRouter({
  list: gatewayQuery("kitchenTicket", "read"),
  ticketAction: gatewayMutation("kitchenTicket", "manage"),
});

export const paymentRouter = createTRPCRouter({
  list: gatewayQuery("payment", "read"),
  open: gatewayMutation("payment", "create"),
  paymentAction: gatewayMutation("payment", "manage"),
});
