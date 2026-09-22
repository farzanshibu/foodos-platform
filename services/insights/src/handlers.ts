/**
 * SOT: insights-handlers-list
 * WHAT   Every handler the insights service serves, in one flat list.
 * WHERE  services/insights/src/index.ts
 */
import "server-only";

import {
  analyticsEventHandlers,
  analyticsHandlers,
  platformAdminHandlers,
} from "./insights.handlers";

export const handlers = [...analyticsEventHandlers, ...analyticsHandlers, ...platformAdminHandlers];
