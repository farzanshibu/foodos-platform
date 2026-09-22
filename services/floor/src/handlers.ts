/**
 * SOT: floor-handlers-list
 * WHAT   Every handler the floor service serves, in one flat list.
 * WHY    defineService asserts at boot that this covers exactly what the registry says this
 *        service owns.
 * WHERE  services/floor/src/index.ts
 */
import "server-only";

import { parameterHandlers, placeHandlers, sectionHandlers } from "./floor.handlers";

export const handlers = [...placeHandlers, ...sectionHandlers, ...parameterHandlers];
