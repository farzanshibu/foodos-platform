/**
 * SOT: catalog-schema, restaurant-table, branch-table, menu-tables, combo-tables
 * WHAT   Every table the catalog service owns: the restaurant, its branches and hours, the
 *        menu tree, and combos with their pick-groups.
 * WHY    Service isolation is a data boundary before it is a code boundary. No other service
 *        may read or migrate these, and there is no shared schema package to import, so a
 *        cross-service query cannot be written even by accident.
 * NOTE   organization_id is a plain column, not a foreign key: the organisation lives in the
 *        identity service's schema. Integrity across services is enforced by events.
 * NOTE   Money is stored as an integer number of paise, never as a float and never as a
 *        decimal that something downstream might parse into one. Every such column ends in
 *        `_paise` so a column that is money is unmistakable at a glance.
 * WHERE  services/catalog/src/*.service.ts
 */
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });

/* ── Tax ─────────────────────────────────────────────────────────────────── */

export const taxRate = pgTable(
  "cat_tax_rate",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_tax_org_idx").on(table.organizationId)],
);

/* ── Restaurant and branches ─────────────────────────────────────────────── */

export const restaurant = pgTable(
  "cat_restaurant",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    /** Not a public URL any more - the QR service prints it into a code's display context. */
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    serviceModes: text("service_modes").array().default(["dine_in"]).notNull(),
    /**
     * Live for service, not listed anywhere. The columns a public directory needed - cover
     * photo, cuisine tags, facilities, price bracket, the denormalised rating a consumer that
     * never existed was meant to fill - went with the directory rather than sitting here
     * unread. Reviews live in the crm service and are read from there.
     */
    isLive: boolean("is_live").default(false).notNull(),
    wentLiveAt: timestamp("went_live_at"),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cat_restaurant_org_slug_idx").on(table.organizationId, table.slug),
    index("cat_restaurant_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const branch = pgTable(
  "cat_branch",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    country: text("country").default("IN").notNull(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    timezone: text("timezone").default("Asia/Kolkata").notNull(),
    serviceModes: text("service_modes").array().default(["dine_in"]).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /** Serving today. `is_active` is whether the branch exists at all. */
    isLive: boolean("is_live").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cat_branch_org_idx").on(table.organizationId, table.restaurantId),
    index("cat_branch_geo_idx").on(table.latitude, table.longitude),
    index("cat_branch_city_idx").on(table.city),
  ],
);

export const branchHours = pgTable(
  "cat_branch_hours",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branch.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    opensAt: time("opens_at").notNull(),
    /** Earlier than opensAt means the branch trades past midnight. */
    closesAt: time("closes_at").notNull(),
    isClosed: boolean("is_closed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("cat_hours_branch_day_idx").on(table.branchId, table.dayOfWeek)],
);

/* ── Menu ────────────────────────────────────────────────────────────────── */

export const menu = pgTable(
  "cat_menu",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    /** Null means the master menu, which every branch inherits until it overrides it. */
    branchId: text("branch_id").references(() => branch.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_menu_org_idx").on(table.organizationId, table.restaurantId)],
);

export const menuCategory = pgTable(
  "cat_menu_category",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cat_category_menu_idx").on(table.organizationId, table.menuId, table.sortOrder),
  ],
);

export const menuItem = pgTable(
  "cat_menu_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => menuCategory.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    pricePaise: money("price_paise").notNull(),
    discountPricePaise: money("discount_price_paise"),
    sku: text("sku"),
    prepTimeMinutes: smallint("prep_time_minutes"),
    calories: integer("calories"),
    ingredients: text("ingredients"),
    allergens: text("allergens").array().default([]).notNull(),
    spiceLevel: smallint("spice_level"),
    dietaryLabels: text("dietary_labels").array().default([]).notNull(),
    isAvailable: boolean("is_available").default(true).notNull(),
    availableFrom: time("available_from"),
    availableTo: time("available_to"),
    taxRateId: text("tax_rate_id").references(() => taxRate.id),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cat_item_menu_idx").on(table.organizationId, table.menuId, table.sortOrder),
    index("cat_item_category_idx").on(table.categoryId, table.sortOrder),
  ],
);

export const menuItemVariant = pgTable(
  "cat_menu_item_variant",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => menuItem.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** An absolute price, not a delta: "Large" costs what it costs. */
    pricePaise: money("price_paise").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_variant_item_idx").on(table.itemId, table.sortOrder)],
);

export const menuModifier = pgTable(
  "cat_menu_modifier",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => menuItem.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isRequired: boolean("is_required").default(false).notNull(),
    minSelections: smallint("min_selections").default(0).notNull(),
    maxSelections: smallint("max_selections"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_modifier_item_idx").on(table.itemId, table.sortOrder)],
);

export const menuModifierOption = pgTable(
  "cat_menu_modifier_option",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    modifierId: text("modifier_id")
      .notNull()
      .references(() => menuModifier.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A delta, and it may be negative: "no cheese, minus ten rupees" is a real option. */
    priceDeltaPaise: money("price_delta_paise").default(0).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isAvailable: boolean("is_available").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_option_modifier_idx").on(table.modifierId, table.sortOrder)],
);

/* ── Combos ──────────────────────────────────────────────────────────────── */

export const combo = pgTable(
  "cat_combo",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    branchId: text("branch_id").references(() => branch.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    /** flat_rate or flat_percentage. Exactly one of the two price columns is ever set. */
    pricingMode: text("pricing_mode").notNull(),
    flatRatePaise: money("flat_rate_paise"),
    flatPercentage: numeric("flat_percentage", { precision: 5, scale: 2 }),
    taxRateId: text("tax_rate_id").references(() => taxRate.id),
    isAvailable: boolean("is_available").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cat_combo_org_idx").on(table.organizationId, table.restaurantId, table.sortOrder),
  ],
);

export const comboGroup = pgTable(
  "cat_combo_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    comboId: text("combo_id")
      .notNull()
      .references(() => combo.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minSelections: smallint("min_selections").default(1).notNull(),
    /** Null means no upper bound: "pick as many sides as you like". */
    maxSelections: smallint("max_selections"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cat_combo_group_idx").on(table.comboId, table.sortOrder)],
);

export const comboGroupItem = pgTable(
  "cat_combo_group_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => comboGroup.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => menuItem.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => menuItemVariant.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("cat_combo_group_item_idx").on(table.groupId, table.sortOrder)],
);

export type RestaurantRow = typeof restaurant.$inferSelect;
export type BranchRow = typeof branch.$inferSelect;
export type BranchHoursRow = typeof branchHours.$inferSelect;
export type MenuRow = typeof menu.$inferSelect;
export type MenuCategoryRow = typeof menuCategory.$inferSelect;
export type MenuItemRow = typeof menuItem.$inferSelect;
export type MenuItemVariantRow = typeof menuItemVariant.$inferSelect;
export type MenuModifierRow = typeof menuModifier.$inferSelect;
export type MenuModifierOptionRow = typeof menuModifierOption.$inferSelect;
export type ComboRow = typeof combo.$inferSelect;
export type ComboGroupRow = typeof comboGroup.$inferSelect;
export type ComboGroupItemRow = typeof comboGroupItem.$inferSelect;
export type TaxRateRow = typeof taxRate.$inferSelect;
