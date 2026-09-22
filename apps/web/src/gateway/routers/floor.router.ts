/**
 * SOT: floor-gateway-router, table-routes, table-parameter-routes
 * WHAT   The whole gateway surface of the floor: tables, sections and table parameters.
 * WHY    A route is a routing decision. Business logic lives in services/floor.
 * WHERE  packages/core/src/gateway.ts, services/floor
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const placeRouter = createTRPCRouter({
  list: gatewayQuery("place", "read"),
  create: gatewayMutation("place", "create"),
  update: gatewayMutation("place", "update"),
  remove: gatewayMutation("place", "delete"),
  floorAction: gatewayMutation("place", "manage"),
});

export const sectionRouter = createTRPCRouter({
  list: gatewayQuery("section", "read"),
  create: gatewayMutation("section", "create"),
  update: gatewayMutation("section", "update"),
  remove: gatewayMutation("section", "delete"),
});

export const parameterDefinitionRouter = createTRPCRouter({
  list: gatewayQuery("parameterDefinition", "read"),
  create: gatewayMutation("parameterDefinition", "create"),
  update: gatewayMutation("parameterDefinition", "update"),
  remove: gatewayMutation("parameterDefinition", "delete"),
});
