/**
 * SOT: floor-schema, table-table, section-table, parameter-definition-table
 * WHAT   Every table the floor service owns: the plan, its sections, and the custom
 *        parameters a restaurant defines once and assigns per table.
 * WHY    The parameter engine is generic on purpose. "Window seat", "recliner", "aisle" and
 *        "wheelchair accessible" are rows, not columns, so a venue adds one without a
 *        migration and without anybody shipping code - and a cinema needs no new tables at
 *        all, because a seat is a place exactly as a table is.
 * NOTE   organization_id is a plain column, not a foreign key: the organisation lives in the
 *        identity service's schema. branch_id likewise names a branch owned by the catalog
 *        service - integrity across services is enforced by events, not by the database.
 * WHERE  services/floor/src/*.service.ts
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const section = pgTable(
  "flr_section",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    name: text("name").notNull(),
    floor: smallint("floor").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("flr_section_branch_name_idx").on(table.branchId, table.name, table.floor),
    index("flr_section_org_idx").on(table.organizationId, table.branchId),
  ],
);

export const place = pgTable(
  "flr_place",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    sectionId: text("section_id").references(() => section.id, { onDelete: "set null" }),
    /** table | seat. A restaurant floor and a cinema screen are the same shape of thing. */
    kind: text("kind").default("table").notNull(),
    label: text("label").notNull(),
    /** Seats is a system parameter: every table has one and it cannot be deleted away. */
    /** How many people it seats. A system parameter: it cannot be deleted away. */
    capacity: integer("capacity").default(2).notNull(),
    status: text("status").default("available").notNull(),
    shape: text("shape").default("rect").notNull(),
    /**
     * The seating grid coordinate: row "H", number 14. Nullable because a restaurant table on
     * a free-form plan has neither, and because a seat that has been created but not yet
     * placed is a real state a manager has to be able to see and fix.
     *
     * Separate from position_x/position_y on purpose. Those are where the drawing sits on a
     * plan a waiter drags things around; these are what is printed on the seat. Folding one
     * into the other would rename H14 the moment somebody nudged it.
     */
    rowLabel: text("row_label"),
    columnNumber: smallint("column_number"),
    positionX: numeric("position_x", { precision: 8, scale: 2 }),
    positionY: numeric("position_y", { precision: 8, scale: 2 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("flr_place_branch_label_idx").on(table.branchId, table.label),
    index("flr_place_org_status_idx").on(table.organizationId, table.branchId, table.status),
    /**
     * Reading a screen means reading it in row order. Not unique: a branch with three screens
     * has three row Hs, and the coordinate is only unique within a section - which is nullable,
     * and a nullable column in a unique index constrains nothing. The label is what carries
     * uniqueness in this table, exactly as it did before.
     */
    index("flr_place_grid_idx").on(table.branchId, table.rowLabel, table.columnNumber),
  ],
);

export const parameterDefinition = pgTable(
  "flr_parameter_definition",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    dataType: text("data_type").notNull(),
    /** Only the two select types carry these; the contract refuses the other combinations. */
    options: text("options").array().default([]).notNull(),
    category: text("category").default("custom").notNull(),
    isCustomerVisible: boolean("is_customer_visible").default(false).notNull(),
    isFilterable: boolean("is_filterable").default(false).notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    /**
     * Deleting is soft. Occupancy and revenue reports still read last quarter's values, and
     * a definition removed outright would take their labels with it.
     */
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("flr_param_org_key_idx").on(table.organizationId, table.key)],
);

export const placeParameterValue = pgTable(
  "flr_place_parameter_value",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    definitionId: text("definition_id")
      .notNull()
      .references(() => parameterDefinition.id, { onDelete: "cascade" }),
    /** JSONB because one column has to hold a string, a number, a boolean or a list. */
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("flr_value_place_definition_idx").on(table.placeId, table.definitionId),
    index("flr_value_org_idx").on(table.organizationId, table.placeId),
  ],
);

export type SectionRow = typeof section.$inferSelect;
export type PlaceRow = typeof place.$inferSelect;
export type ParameterDefinitionRow = typeof parameterDefinition.$inferSelect;
export type PlaceParameterValueRow = typeof placeParameterValue.$inferSelect;
