/**
 * SOT: catalog-contract, restaurant-contract, branch-contract, menu-contract, item-contract,
 *      modifier-contract, combo-contract, catalog-schemas, menu-csv-columns,
 *      menu-import-contract
 * WHAT   Input and output schemas for everything the catalog service answers for: the
 *        restaurant, its branches and hours, and the menu tree down to modifiers and combos.
 * WHY    Gateway and service parse the same schema, so neither can drift and neither needs
 *        documentation to know the shape. A guest reading a menu and an admin editing it
 *        share these definitions, which is what stops the two views of a dish diverging.
 * HOW    No organisation id appears in any input or output here. The caller is already
 *        scoped to one organisation by the signed envelope; restaurantId and branchId are
 *        ordinary foreign keys naming which restaurant a row belongs to, not tenant scope.
 * WHERE  packages/contracts/src/contracts.ts, services/catalog
 */
import { z } from "zod";

import { wireDate } from "../wire";

/* ── Shared vocabulary ───────────────────────────────────────────────────── */

export const SERVICE_MODES = ["dine_in", "takeaway", "pickup", "delivery"] as const;
export const DIETARY_LABELS = [
  "vegetarian",
  "vegan",
  "halal",
  "jain",
  "gluten_free",
  "egg_free",
  "contains_alcohol",
] as const;

/** Money crosses the wire as an integer number of paise. There is no float on this bus. */
const paise = z.number().int();
const nonNegativePaise = paise.min(0);

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── Restaurant ──────────────────────────────────────────────────────────── */

/**
 * The restaurant as an in-house operation, not as a listing. Everything a public directory
 * needed to draw a card - a cover photo, cuisine tags, facilities, a price bracket, an
 * aggregate rating - went with the directory. What is left is what somebody standing in the
 * building uses: who this is, the logo that prints on the table cards, how it serves, and
 * whether it is live.
 */
export const restaurantDto = z.object({
  id: z.string(),
  name: z.string(),
  /** Stable, human-readable, and printed into every QR code's display context. */
  slug: z.string(),
  logoUrl: z.string().nullable(),
  serviceModes: z.array(z.enum(SERVICE_MODES)),
  /** Live means the floor is taking scans and orders. It is not a listing anywhere. */
  isLive: z.boolean(),
  wentLiveAt: wireDate.nullable(),
  branchCount: z.number().int(),
  createdAt: wireDate,
});

const restaurantFields = {
  name: z.string().min(2).max(120),
  logoUrl: z.string().url().nullable().optional(),
  serviceModes: z.array(z.enum(SERVICE_MODES)).min(1).optional(),
};

export const restaurantContract = {
  read: {
    input: z.object({ ...cursorPage, id: z.string().optional(), slug: z.string().optional() }),
    output: pageOf(restaurantDto),
  },
  create: {
    input: z.object({
      ...restaurantFields,
      slug: z
        .string()
        .min(2)
        .max(60)
        .regex(/^[a-z0-9-]+$/, "Lowercase, numbers and hyphens only."),
    }),
    output: restaurantDto,
  },
  update: {
    input: z.object({ id: z.string(), ...restaurantFields }),
    output: restaurantDto,
  },
  delete: {
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string() }),
  },
  /**
   * Going live is the moment a restaurant starts serving: scans resolve, orders are taken,
   * staff screens light up. It is its own audited action rather than a boolean somewhere in
   * `update` because it is the switch somebody will one day have to explain flipping.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("go_live"), id: z.string() }),
      z.object({ action: z.literal("take_offline"), id: z.string() }),
    ]),
    output: restaurantDto,
  },
} as const;

/* ── Branch ──────────────────────────────────────────────────────────────── */

export const openingHoursDto = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  opensAt: z.string(),
  closesAt: z.string(),
  isClosed: z.boolean(),
});

export const branchDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
  /** Live means this branch is serving today. `isActive` is whether it exists at all. */
  isLive: z.boolean(),
  serviceModes: z.array(z.enum(SERVICE_MODES)),
  hours: z.array(openingHoursDto),
  /** Computed against the branch's own timezone, so a client never has to guess. */
  isOpenNow: z.boolean(),
  createdAt: wireDate,
});

const branchFields = {
  name: z.string().min(1).max(120),
  phone: z.string().max(24).nullable().optional(),
  email: z.string().email().nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(80).nullable().optional(),
  pincode: z.string().max(16).nullable().optional(),
  country: z.string().length(2).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().max(64).optional(),
  serviceModes: z.array(z.enum(SERVICE_MODES)).min(1).optional(),
  isActive: z.boolean().optional(),
};

export const branchContract = {
  read: {
    input: z.object({
      ...cursorPage,
      restaurantId: z.string().optional(),
      id: z.string().optional(),
    }),
    output: pageOf(branchDto),
  },
  create: {
    input: z.object({ restaurantId: z.string(), ...branchFields }),
    output: branchDto,
  },
  update: {
    input: z.object({ id: z.string(), ...branchFields }),
    output: branchDto,
  },
  delete: {
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string() }),
  },
  /**
   * Hours are replaced as one whole week rather than edited a day at a time: a partial
   * update is how a branch ends up open on a day nobody meant to open it.
   */
  manage: {
    input: z.object({
      id: z.string(),
      hours: z
        .array(
          z.object({
            dayOfWeek: z.number().int().min(0).max(6),
            opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
            closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
            isClosed: z.boolean().default(false),
          }),
        )
        .length(7),
      isLive: z.boolean().optional(),
    }),
    output: branchDto,
  },
} as const;

/* ── Menu and categories ─────────────────────────────────────────────────── */

export const menuDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  branchId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: wireDate,
});

export const menuContract = {
  read: {
    input: z.object({
      ...cursorPage,
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      id: z.string().optional(),
    }),
    output: pageOf(menuDto),
  },
  create: {
    input: z.object({
      restaurantId: z.string(),
      branchId: z.string().nullable().optional(),
      name: z.string().min(1).max(80),
      description: z.string().max(500).nullable().optional(),
      isDefault: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    output: menuDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(500).nullable().optional(),
      isDefault: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    output: menuDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

export const menuCategoryDto = z.object({
  id: z.string(),
  menuId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  itemCount: z.number().int(),
  createdAt: wireDate,
});

export const menuCategoryContract = {
  read: {
    input: z.object({ ...cursorPage, menuId: z.string().optional(), id: z.string().optional() }),
    output: pageOf(menuCategoryDto),
  },
  create: {
    input: z.object({
      menuId: z.string(),
      name: z.string().min(1).max(80),
      description: z.string().max(500).nullable().optional(),
      imageUrl: z.string().url().nullable().optional(),
      sortOrder: z.number().int().optional(),
    }),
    output: menuCategoryDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(500).nullable().optional(),
      imageUrl: z.string().url().nullable().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    output: menuCategoryDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Items, variants and modifiers ───────────────────────────────────────── */

export const menuItemVariantDto = z.object({
  id: z.string(),
  name: z.string(),
  pricePaise: nonNegativePaise,
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
});

export const menuModifierOptionDto = z.object({
  id: z.string(),
  name: z.string(),
  priceDeltaPaise: paise,
  isDefault: z.boolean(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});

export const menuModifierDto = z.object({
  id: z.string(),
  itemId: z.string(),
  name: z.string(),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0),
  maxSelections: z.number().int().min(1).nullable(),
  sortOrder: z.number().int(),
  options: z.array(menuModifierOptionDto),
});

export const menuItemDto = z.object({
  id: z.string(),
  menuId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  pricePaise: nonNegativePaise,
  discountPricePaise: nonNegativePaise.nullable(),
  sku: z.string().nullable(),
  prepTimeMinutes: z.number().int().nullable(),
  calories: z.number().int().nullable(),
  ingredients: z.string().nullable(),
  allergens: z.array(z.string()),
  spiceLevel: z.number().int().min(0).max(3).nullable(),
  dietaryLabels: z.array(z.enum(DIETARY_LABELS)),
  isAvailable: z.boolean(),
  availableFrom: z.string().nullable(),
  availableTo: z.string().nullable(),
  taxRateId: z.string().nullable(),
  taxPercent: z.number().nullable(),
  sortOrder: z.number().int(),
  variants: z.array(menuItemVariantDto),
  modifiers: z.array(menuModifierDto),
  createdAt: wireDate,
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

const menuItemFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  pricePaise: nonNegativePaise.optional(),
  discountPricePaise: nonNegativePaise.nullable().optional(),
  sku: z.string().max(48).nullable().optional(),
  prepTimeMinutes: z.number().int().min(0).max(600).nullable().optional(),
  calories: z.number().int().min(0).nullable().optional(),
  ingredients: z.string().max(1000).nullable().optional(),
  allergens: z.array(z.string().min(1).max(40)).max(24).optional(),
  spiceLevel: z.number().int().min(0).max(3).nullable().optional(),
  dietaryLabels: z.array(z.enum(DIETARY_LABELS)).max(8).optional(),
  isAvailable: z.boolean().optional(),
  availableFrom: timeOfDay.nullable().optional(),
  availableTo: timeOfDay.nullable().optional(),
  taxRateId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(60),
        pricePaise: nonNegativePaise,
        isDefault: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
      }),
    )
    .max(20)
    .optional(),
};

/* ── Menu transfer: the CSV format export writes and import reads ────────── */

/**
 * The columns of the menu CSV, in order, written down once. `export` emits exactly these and
 * the browser's parser reads exactly these, which is the whole of what "round trip" means
 * here: export a menu, import the same file, nothing changes.
 *
 * `price_rupees` says rupees in its own name deliberately. A restaurant's spreadsheet has
 * "220" in it meaning two hundred and twenty rupees, and a column called `price` that quietly
 * meant paise would reprice the entire menu at two rupees twenty. The browser multiplies by a
 * hundred once, at the edge, and everything past that point is integer paise like the rest of
 * this bus. Variants and modifiers are not in the format - they are a tree and this is a
 * spreadsheet - so an import leaves the ones an item already has alone.
 */
export const MENU_CSV_COLUMNS = [
  "id",
  "category",
  "name",
  "description",
  "price_rupees",
  "discount_price_rupees",
  "sku",
  "prep_time_minutes",
  "calories",
  "spice_level",
  "dietary_labels",
  "allergens",
  "available",
] as const;

/**
 * A thousand dishes is a very large menu, and the whole file crosses NATS as one message -
 * the default limit there is a megabyte, and an import that fails as a transport error
 * rather than as a sentence is exactly the experience this flow exists to avoid. Row numbers
 * get more headroom than rows because blank lines in a spreadsheet count as neither.
 */
export const MENU_IMPORT_MAX_ROWS = 1000;

/** Row numbers are the spreadsheet's own: line 1 is the header, so data starts at 2. */
const csvRowNumber = z.number().int().min(2).max(5000);

/** One line the browser understood, already in the shape an item is created from. */
const menuImportRow = z.object({
  rowNumber: csvRowNumber,
  /** The `id` column. Null when it was blank, which is how a row asks to create an item. */
  itemId: z.string().max(64).nullable(),
  category: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable(),
  pricePaise: nonNegativePaise,
  discountPricePaise: nonNegativePaise.nullable(),
  sku: z.string().max(48).nullable(),
  prepTimeMinutes: z.number().int().min(0).max(600).nullable(),
  calories: z.number().int().min(0).nullable(),
  spiceLevel: z.number().int().min(0).max(3).nullable(),
  dietaryLabels: z.array(z.enum(DIETARY_LABELS)).max(8),
  allergens: z.array(z.string().min(1).max(40)).max(24),
  isAvailable: z.boolean(),
});

/**
 * A line the browser could not turn into a row at all - no name, a price that is not a
 * number. It is sent anyway rather than dropped, because a report that omits the lines that
 * failed is exactly the importer this refused to be. The service never writes these; it
 * counts them, prints them in the report, and refuses to commit while any exist.
 */
const menuImportRejection = z.object({
  rowNumber: csvRowNumber,
  /** Whatever was in the name column, so the manager can find the line in their spreadsheet. */
  name: z.string().max(200),
  reason: z.string().min(1).max(200),
});

export const MENU_IMPORT_OUTCOMES = ["create", "update", "reject"] as const;

export const menuImportRowReportDto = z.object({
  rowNumber: z.number().int(),
  name: z.string(),
  category: z.string(),
  outcome: z.enum(MENU_IMPORT_OUTCOMES),
  /** The item this row would change; null for a row that would create one or was rejected. */
  itemId: z.string().nullable(),
  /** What the row would end up costing, so the report can show it back before anything moves. */
  pricePaise: nonNegativePaise.nullable(),
  /** Empty unless rejected. One sentence per problem, addressed to a manager. */
  reasons: z.array(z.string()),
});

export const menuImportReportDto = z.object({
  dryRun: z.boolean(),
  /** Every line of the file, accepted or not, in file order. */
  rows: z.array(menuImportRowReportDto),
  createCount: z.number().int(),
  updateCount: z.number().int(),
  rejectCount: z.number().int(),
});

export const menuItemContract = {
  read: {
    input: z.object({
      ...cursorPage,
      menuId: z.string().optional(),
      categoryId: z.string().optional(),
      id: z.string().optional(),
      search: z.string().max(120).optional(),
      availableOnly: z.boolean().default(false),
    }),
    output: pageOf(menuItemDto),
  },
  create: {
    input: z.object({
      menuId: z.string(),
      categoryId: z.string(),
      ...menuItemFields,
      pricePaise: nonNegativePaise,
    }),
    output: menuItemDto,
  },
  update: {
    input: z.object({ id: z.string(), categoryId: z.string().optional(), ...menuItemFields }),
    output: menuItemDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * The bulk verbs. They are one operation rather than five endpoints because they are all
   * "change many items at once", and the registry gives a resource five verbs, not fifty.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("set_availability"),
        ids: z.array(z.string()).min(1).max(500),
        isAvailable: z.boolean(),
      }),
      z.object({
        action: z.literal("set_category"),
        ids: z.array(z.string()).min(1).max(500),
        categoryId: z.string(),
      }),
      z.object({
        action: z.literal("adjust_price"),
        ids: z.array(z.string()).min(1).max(500),
        /** Exactly one of the two, checked in the service: a flat delta or a percentage. */
        deltaPaise: paise.optional(),
        percent: z.number().min(-90).max(500).optional(),
      }),
      z.object({ action: z.literal("duplicate"), id: z.string() }),
      z.object({ action: z.literal("reorder"), ids: z.array(z.string()).min(1).max(500) }),
      z.object({ action: z.literal("export"), menuId: z.string() }),
      /**
       * Import arrives as rows, never as a document: the browser reads the CSV, so the
       * service is given something already shaped instead of a blob to guess at, and a
       * malformed line is named on the screen the person is looking at.
       *
       * `totalRows` is the file's own line count and the service checks that `rows` and
       * `rejected` add up to it. A client that quietly skipped a line it disliked fails that
       * arithmetic, which is the one thing an importer must never be able to do silently.
       */
      z.object({
        action: z.literal("import"),
        menuId: z.string(),
        /** True validates everything and reports; nothing is written. False commits. */
        dryRun: z.boolean(),
        totalRows: z.number().int().min(1).max(MENU_IMPORT_MAX_ROWS),
        rows: z.array(menuImportRow).max(MENU_IMPORT_MAX_ROWS),
        rejected: z.array(menuImportRejection).max(MENU_IMPORT_MAX_ROWS),
      }),
    ]),
    output: z.object({
      changed: z.number().int(),
      /** Populated by `export`; null for every other action. */
      document: z.string().nullable(),
      /** Populated by `import`, dry run or not; null for every other action. */
      report: menuImportReportDto.nullable(),
    }),
  },
} as const;

export const menuModifierContract = {
  read: {
    input: z.object({ ...cursorPage, itemId: z.string().optional(), id: z.string().optional() }),
    output: pageOf(menuModifierDto),
  },
  create: {
    input: z
      .object({
        itemId: z.string(),
        name: z.string().min(1).max(80),
        isRequired: z.boolean().default(false),
        minSelections: z.number().int().min(0).max(20).default(0),
        maxSelections: z.number().int().min(1).max(20).nullable().optional(),
        sortOrder: z.number().int().default(0),
        options: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              priceDeltaPaise: paise.default(0),
              isDefault: z.boolean().default(false),
              isAvailable: z.boolean().default(true),
              sortOrder: z.number().int().default(0),
            }),
          )
          .min(1)
          .max(50),
      })
      .superRefine((value, ctx) => {
        if (value.maxSelections != null && value.maxSelections < value.minSelections) {
          ctx.addIssue({
            code: "custom",
            path: ["maxSelections"],
            message: "maxSelections must be at least minSelections.",
          });
        }
        if (value.minSelections > value.options.length) {
          ctx.addIssue({
            code: "custom",
            path: ["minSelections"],
            message: "minSelections cannot exceed the number of options.",
          });
        }
      }),
    output: menuModifierDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      isRequired: z.boolean().optional(),
      minSelections: z.number().int().min(0).max(20).optional(),
      maxSelections: z.number().int().min(1).max(20).nullable().optional(),
      sortOrder: z.number().int().optional(),
      options: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string().min(1).max(80),
            priceDeltaPaise: paise.default(0),
            isDefault: z.boolean().default(false),
            isAvailable: z.boolean().default(true),
            sortOrder: z.number().int().default(0),
          }),
        )
        .max(50)
        .optional(),
    }),
    output: menuModifierDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Combos ──────────────────────────────────────────────────────────────── */

export const COMBO_PRICING_MODES = ["flat_rate", "flat_percentage"] as const;

export const comboGroupItemDto = z.object({
  itemId: z.string(),
  variantId: z.string().nullable(),
  name: z.string(),
  variantName: z.string().nullable(),
  unitPricePaise: nonNegativePaise,
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});

export const comboGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  minSelections: z.number().int().min(1),
  maxSelections: z.number().int().min(1).nullable(),
  sortOrder: z.number().int(),
  items: z.array(comboGroupItemDto),
});

/**
 * What a menu card shows before anybody has picked anything: the price of the cheapest
 * valid configuration, what those parts would cost separately, and a badge when the two
 * differ. It is a hint, not a quote - `quote.read` is what prices an actual cart.
 */
export const comboDisplayHintDto = z.object({
  displayPricePaise: nonNegativePaise,
  referencePricePaise: nonNegativePaise,
  savingsPaise: nonNegativePaise,
  badge: z.string().nullable(),
});

export const comboDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  branchId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  pricingMode: z.enum(COMBO_PRICING_MODES),
  flatRatePaise: nonNegativePaise.nullable(),
  flatPercentage: z.number().nullable(),
  taxRateId: z.string().nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
  groups: z.array(comboGroupDto),
  hint: comboDisplayHintDto,
  createdAt: wireDate,
});

const comboGroupInput = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1).max(80),
    minSelections: z.number().int().min(1).max(10).default(1),
    maxSelections: z.number().int().min(1).max(10).nullable().optional(),
    sortOrder: z.number().int().default(0),
    items: z
      .array(
        z.object({
          itemId: z.string(),
          variantId: z.string().nullable().optional(),
          sortOrder: z.number().int().default(0),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((group, ctx) => {
    if (group.maxSelections != null && group.maxSelections < group.minSelections) {
      ctx.addIssue({
        code: "custom",
        path: ["maxSelections"],
        message: "maxSelections must be at least minSelections.",
      });
    }
    if (group.minSelections > group.items.length) {
      ctx.addIssue({
        code: "custom",
        path: ["minSelections"],
        message: "minSelections cannot exceed the number of items in the group.",
      });
    }
  });

/**
 * Flat rate carries a rate and no percentage; flat percentage carries a percentage and no
 * rate. Refused here rather than in the service so a combo that could not be priced can
 * never be sent in the first place. 100% is deliberately not allowed: a free item is a
 * promotion, and the registry has a promotion resource for it.
 */
function refineComboPricing(
  value: {
    pricingMode?: (typeof COMBO_PRICING_MODES)[number] | undefined;
    flatRatePaise?: number | null | undefined;
    flatPercentage?: number | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.pricingMode === undefined) return;
  if (value.pricingMode === "flat_rate") {
    if (value.flatRatePaise == null) {
      ctx.addIssue({
        code: "custom",
        path: ["flatRatePaise"],
        message: "A flat-rate combo needs a price.",
      });
    }
    if (value.flatPercentage != null) {
      ctx.addIssue({
        code: "custom",
        path: ["flatPercentage"],
        message: "A flat-rate combo cannot also carry a percentage.",
      });
    }
    return;
  }
  if (value.flatPercentage == null) {
    ctx.addIssue({
      code: "custom",
      path: ["flatPercentage"],
      message: "A percentage combo needs a percentage.",
    });
  }
  if (value.flatRatePaise != null) {
    ctx.addIssue({
      code: "custom",
      path: ["flatRatePaise"],
      message: "A percentage combo cannot also carry a flat rate.",
    });
  }
}

const comboFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  /** One rupee to ten lakh, in paise. */
  flatRatePaise: nonNegativePaise.min(100).max(100_000_000).nullable().optional(),
  flatPercentage: z.number().min(1).max(99).nullable().optional(),
  taxRateId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
};

export const comboContract = {
  read: {
    input: z.object({
      ...cursorPage,
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      id: z.string().optional(),
      availableOnly: z.boolean().default(false),
    }),
    output: pageOf(comboDto),
  },
  create: {
    input: z
      .object({
        restaurantId: z.string(),
        branchId: z.string().nullable().optional(),
        pricingMode: z.enum(COMBO_PRICING_MODES),
        groups: z.array(comboGroupInput).min(1).max(6),
        ...comboFields,
      })
      .superRefine(refineComboPricing),
    output: comboDto,
  },
  update: {
    input: z
      .object({
        id: z.string(),
        pricingMode: z.enum(COMBO_PRICING_MODES).optional(),
        groups: z.array(comboGroupInput).min(1).max(6).optional(),
        ...comboFields,
        name: z.string().min(1).max(120).optional(),
      })
      .superRefine(refineComboPricing),
    output: comboDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * Availability, not deletion: a combo taken off the menu today still has to render on
   * last week's receipts, and order lines keep their own snapshots for exactly that reason.
   */
  manage: {
    input: z.object({ id: z.string(), isAvailable: z.boolean() }),
    output: comboDto,
  },
} as const;
