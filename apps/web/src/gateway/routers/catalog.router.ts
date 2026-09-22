/**
 * SOT: catalog-gateway-router, restaurant-routes, menu-routes, combo-routes, quote-route
 * WHAT   The whole gateway surface of the catalogue: restaurants, branches, menus, items,
 *        modifiers, combos, and the pricing quote.
 * WHY    A route is a routing decision. Business logic lives in services/catalog.
 * HOW    One line per endpoint. The architecture check reads this file as text and refuses
 *        control flow in it, comments included.
 * WHERE  packages/core/src/gateway.ts, services/catalog
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const restaurantRouter = createTRPCRouter({
  list: gatewayQuery("restaurant", "read"),
  create: gatewayMutation("restaurant", "create"),
  update: gatewayMutation("restaurant", "update"),
  remove: gatewayMutation("restaurant", "delete"),
  setLive: gatewayMutation("restaurant", "manage"),
});

export const branchRouter = createTRPCRouter({
  list: gatewayQuery("branch", "read"),
  create: gatewayMutation("branch", "create"),
  update: gatewayMutation("branch", "update"),
  remove: gatewayMutation("branch", "delete"),
  setHours: gatewayMutation("branch", "manage"),
});

export const menuRouter = createTRPCRouter({
  list: gatewayQuery("menu", "read"),
  create: gatewayMutation("menu", "create"),
  update: gatewayMutation("menu", "update"),
  remove: gatewayMutation("menu", "delete"),
});

export const menuCategoryRouter = createTRPCRouter({
  list: gatewayQuery("menuCategory", "read"),
  create: gatewayMutation("menuCategory", "create"),
  update: gatewayMutation("menuCategory", "update"),
  remove: gatewayMutation("menuCategory", "delete"),
});

export const menuItemRouter = createTRPCRouter({
  list: gatewayQuery("menuItem", "read"),
  create: gatewayMutation("menuItem", "create"),
  update: gatewayMutation("menuItem", "update"),
  remove: gatewayMutation("menuItem", "delete"),
  bulk: gatewayMutation("menuItem", "manage"),
});

export const menuModifierRouter = createTRPCRouter({
  list: gatewayQuery("menuModifier", "read"),
  create: gatewayMutation("menuModifier", "create"),
  update: gatewayMutation("menuModifier", "update"),
  remove: gatewayMutation("menuModifier", "delete"),
});

export const comboRouter = createTRPCRouter({
  list: gatewayQuery("combo", "read"),
  create: gatewayMutation("combo", "create"),
  update: gatewayMutation("combo", "update"),
  remove: gatewayMutation("combo", "delete"),
  setAvailability: gatewayMutation("combo", "manage"),
});

export const quoteRouter = createTRPCRouter({
  price: gatewayQuery("quote", "read"),
});
