/**
 * SOT: requests-handlers-list
 * WHAT   Every handler the requests service serves, in one flat list.
 * WHERE  services/requests/src/index.ts
 */
import "server-only";

import { requestTypeHandlers, serviceRequestHandlers } from "./request.handlers";

export const handlers = [...requestTypeHandlers, ...serviceRequestHandlers];
