/**
 * SOT: crm-handlers-list
 * WHAT   Every handler the crm service serves, in one flat list.
 * WHERE  services/crm/src/index.ts
 */
import "server-only";

import { customerHandlers, favoriteHandlers, reviewHandlers } from "./crm.handlers";
import { couponHandlers, loyaltyHandlers, promotionHandlers } from "./marketing.handlers";

export const handlers = [
  ...customerHandlers,
  ...reviewHandlers,
  ...favoriteHandlers,
  ...promotionHandlers,
  ...couponHandlers,
  ...loyaltyHandlers,
];
