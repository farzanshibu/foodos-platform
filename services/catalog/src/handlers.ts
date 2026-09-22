/**
 * SOT: catalog-handlers, catalog-handler-list
 * WHAT   Every handler the catalog service serves, in one flat list.
 * WHY    defineService asserts at boot that this list covers exactly the resources the
 *        registry says this service owns - no more and no fewer. A missing handler is a
 *        crash on `make dev`, not a subject that hangs at three in the morning.
 * WHERE  services/catalog/src/index.ts
 */
import "server-only";

import { comboHandlers } from "./combo.handlers";
import { itemHandlers, modifierHandlers } from "./item.handlers";
import { categoryHandlers, menuHandlers } from "./menu.handlers";
import { quoteHandlers } from "./quote.handlers";
import { branchHandlers, restaurantHandlers } from "./restaurant.handlers";

export const handlers = [
  ...restaurantHandlers,
  ...branchHandlers,
  ...menuHandlers,
  ...categoryHandlers,
  ...itemHandlers,
  ...modifierHandlers,
  ...comboHandlers,
  ...quoteHandlers,
];
