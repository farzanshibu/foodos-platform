/**
 * SOT: app-router, gateway-routers, api-surface
 * WHAT   The entire public API in one screen.
 * WHY    If a router is not here it does not exist. Auditing the API surface is reading
 *        this file, and every line in it is provably guarded.
 */
import { createCallerFactory, createTRPCRouter } from "../init";
import { auditRouter, billingRouter } from "./billing.router";
import {
  branchRouter,
  comboRouter,
  menuCategoryRouter,
  menuItemRouter,
  menuModifierRouter,
  menuRouter,
  quoteRouter,
  restaurantRouter,
} from "./catalog.router";
import {
  couponRouter,
  customerRouter,
  favoriteRouter,
  loyaltyRouter,
  promotionRouter,
  reviewRouter,
} from "./crm.router";
import { parameterDefinitionRouter, placeRouter, sectionRouter } from "./floor.router";
import { invitationRouter, memberRouter, organizationRouter } from "./identity.router";
import { analyticsEventRouter, analyticsRouter, platformAdminRouter } from "./insights.router";
import { cartRouter, kitchenTicketRouter, orderRouter, paymentRouter } from "./orders.router";
import { projectRouter } from "./project.router";
import { cardDesignRouter, qrCodeRouter, qrSessionRouter } from "./qr.router";
import { requestTypeRouter, serviceRequestRouter } from "./requests.router";

export const appRouter = createTRPCRouter({
  organization: organizationRouter,
  project: projectRouter,
  member: memberRouter,
  invitation: invitationRouter,
  billing: billingRouter,
  audit: auditRouter,

  restaurant: restaurantRouter,
  branch: branchRouter,
  menu: menuRouter,
  menuCategory: menuCategoryRouter,
  menuItem: menuItemRouter,
  menuModifier: menuModifierRouter,
  combo: comboRouter,
  quote: quoteRouter,

  place: placeRouter,
  section: sectionRouter,
  parameterDefinition: parameterDefinitionRouter,

  qrCode: qrCodeRouter,
  qrSession: qrSessionRouter,
  cardDesign: cardDesignRouter,

  cart: cartRouter,
  order: orderRouter,
  kitchenTicket: kitchenTicketRouter,
  payment: paymentRouter,

  requestType: requestTypeRouter,
  serviceRequest: serviceRequestRouter,

  customer: customerRouter,
  review: reviewRouter,
  favorite: favoriteRouter,
  promotion: promotionRouter,
  coupon: couponRouter,
  loyalty: loyaltyRouter,

  analyticsEvent: analyticsEventRouter,
  analytics: analyticsRouter,
  platformAdmin: platformAdminRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
