/**
 * SOT: requests-gateway-router, request-type-routes, service-request-routes
 * WHAT   The whole gateway surface of the server-driven request system.
 * WHY    A route is a routing decision. Business logic lives in services/requests, including
 *        the re-validation of a submitted form against the request type as it is right now.
 * WHERE  packages/core/src/gateway.ts, services/requests
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const requestTypeRouter = createTRPCRouter({
  list: gatewayQuery("requestType", "read"),
  create: gatewayMutation("requestType", "create"),
  update: gatewayMutation("requestType", "update"),
  remove: gatewayMutation("requestType", "delete"),
});

export const serviceRequestRouter = createTRPCRouter({
  list: gatewayQuery("serviceRequest", "read"),
  submit: gatewayMutation("serviceRequest", "create"),
  cancel: gatewayMutation("serviceRequest", "update"),
  staffAction: gatewayMutation("serviceRequest", "manage"),
});
