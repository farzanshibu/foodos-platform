/**
 * SOT: crm-gateway-router, customer-routes, review-routes, promotion-routes, loyalty-routes
 * WHAT   The whole gateway surface of the customer side: diners, reviews, favourites,
 *        promotions, coupons and loyalty.
 * WHY    A route is a routing decision. Business logic lives in services/crm.
 * WHERE  packages/core/src/gateway.ts, services/crm
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const customerRouter = createTRPCRouter({
  list: gatewayQuery("customer", "read"),
  identify: gatewayMutation("customer", "create"),
  update: gatewayMutation("customer", "update"),
  remove: gatewayMutation("customer", "delete"),
});

export const reviewRouter = createTRPCRouter({
  list: gatewayQuery("review", "read"),
  create: gatewayMutation("review", "create"),
  reply: gatewayMutation("review", "update"),
  remove: gatewayMutation("review", "delete"),
  moderate: gatewayMutation("review", "manage"),
});

export const favoriteRouter = createTRPCRouter({
  list: gatewayQuery("favorite", "read"),
  add: gatewayMutation("favorite", "create"),
  remove: gatewayMutation("favorite", "delete"),
});

export const promotionRouter = createTRPCRouter({
  list: gatewayQuery("promotion", "read"),
  create: gatewayMutation("promotion", "create"),
  update: gatewayMutation("promotion", "update"),
  remove: gatewayMutation("promotion", "delete"),
});

export const couponRouter = createTRPCRouter({
  list: gatewayQuery("coupon", "read"),
  create: gatewayMutation("coupon", "create"),
  update: gatewayMutation("coupon", "update"),
  remove: gatewayMutation("coupon", "delete"),
});

export const loyaltyRouter = createTRPCRouter({
  read: gatewayQuery("loyalty", "read"),
  createProgramme: gatewayMutation("loyalty", "create"),
  updateProgramme: gatewayMutation("loyalty", "update"),
  adjust: gatewayMutation("loyalty", "manage"),
});
