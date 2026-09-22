/**
 * SOT: insights-gateway-router, analytics-routes, platform-admin-routes
 * WHAT   The whole gateway surface of the event stream, reporting and the platform console.
 * WHY    A route is a routing decision. Business logic lives in services/insights - including
 *        the rule that matters most here: the platform console is refused unless the caller is
 *        the organisation the deployment named as its own.
 * WHERE  packages/core/src/gateway.ts, services/insights
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const analyticsEventRouter = createTRPCRouter({
  track: gatewayMutation("analyticsEvent", "create"),
  list: gatewayQuery("analyticsEvent", "read"),
});

export const analyticsRouter = createTRPCRouter({
  report: gatewayQuery("analytics", "read"),
  export: gatewayMutation("analytics", "manage"),
});

export const platformAdminRouter = createTRPCRouter({
  view: gatewayQuery("platformAdmin", "read"),
  act: gatewayMutation("platformAdmin", "manage"),
});
