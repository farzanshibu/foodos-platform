/**
 * SOT: qr-handlers-list
 * WHAT   Every handler the qr service serves, in one flat list.
 * WHERE  services/qr/src/index.ts
 */
import "server-only";

import { cardDesignHandlers } from "./card.handlers";
import { qrCodeHandlers, qrSessionHandlers } from "./qr.handlers";

export const handlers = [...qrCodeHandlers, ...qrSessionHandlers, ...cardDesignHandlers];
