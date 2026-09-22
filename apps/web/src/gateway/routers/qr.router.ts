/**
 * SOT: qr-gateway-router, qr-code-routes, qr-session-routes, card-design-routes
 * WHAT   The whole gateway surface of QR codes, scan sessions and printable card designs.
 * WHY    A route is a routing decision. Business logic lives in services/qr.
 * NOTE   The first call of a scan does not appear here. It has no identity to be identified
 *        by, so the scan page resolves the token server-side and mints the guest ticket -
 *        see apps/web/src/gateway/public-call.ts. Everything after that is an ordinary
 *        guest request through the block, including the routes below.
 * WHERE  packages/core/src/gateway.ts, services/qr
 */
import { createTRPCRouter } from "../init";
import { gatewayMutation, gatewayQuery } from "../procedures";

export const qrCodeRouter = createTRPCRouter({
  list: gatewayQuery("qrCode", "read"),
  create: gatewayMutation("qrCode", "create"),
  update: gatewayMutation("qrCode", "update"),
  remove: gatewayMutation("qrCode", "delete"),
  codeAction: gatewayMutation("qrCode", "manage"),
});

export const qrSessionRouter = createTRPCRouter({
  current: gatewayQuery("qrSession", "read"),
  open: gatewayMutation("qrSession", "create"),
  sessionAction: gatewayMutation("qrSession", "manage"),
});

export const cardDesignRouter = createTRPCRouter({
  list: gatewayQuery("cardDesign", "read"),
  create: gatewayMutation("cardDesign", "create"),
  update: gatewayMutation("cardDesign", "update"),
  remove: gatewayMutation("cardDesign", "delete"),
  render: gatewayMutation("cardDesign", "manage"),
});
