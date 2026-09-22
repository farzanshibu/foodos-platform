/**
 * SOT: requests-schema, request-type-table, service-request-table, request-event-table
 * WHAT   Every table the requests service owns: the types staff configure, the requests
 *        guests submit against them, and the audit trail of every transition.
 * WHY    A request type's form is DATA. That is the whole feature: adding "request a charger"
 *        is a row, so it reaches every phone in the room without anybody shipping a client.
 * NOTE   organization_id is a plain column, not a foreign key.
 * WHERE  services/requests/src/*.service.ts
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const requestType = pgTable(
  "req_type",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id"),
    /** Null means every branch. A branch id narrows the type to one of them. */
    branchId: text("branch_id"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon").default("bell").notNull(),
    color: text("color").default("brand").notNull(),
    /** { version, fields[] }. The customer app renders this and knows nothing else. */
    formSchema: jsonb("form_schema").notNull(),
    destination: text("destination").default("waiter").notNull(),
    slaMinutes: smallint("sla_minutes").default(5).notNull(),
    requiresPlace: boolean("requires_table").default(true).notNull(),
    allowedOnlyDuringActiveOrder: boolean("allowed_only_during_active_order")
      .default(false)
      .notNull(),
    successMessage: text("success_message"),
    cardDesignId: text("card_design_id"),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("req_type_org_key_idx").on(table.organizationId, table.key),
    index("req_type_active_idx").on(table.organizationId, table.isActive, table.sortOrder),
  ],
);

export const serviceRequest = pgTable(
  "req_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    branchId: text("branch_id").notNull(),
    placeId: text("place_id"),
    placeLabel: text("place_label"),
    requestTypeId: text("request_type_id")
      .notNull()
      .references(() => requestType.id),
    sessionId: text("session_id"),
    orderId: text("order_id"),
    customerId: text("customer_id"),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    status: text("status").default("submitted").notNull(),
    priority: text("priority").default("normal").notNull(),
    /**
     * Whatever the type's form said it should be, validated against that form at submission
     * time - not against whichever version the browser happened to be holding.
     */
    formData: jsonb("form_data").default({}).notNull(),
    assignedStaffId: text("assigned_staff_id"),
    assignedStaffName: text("assigned_staff_name"),
    rejectionReason: text("rejection_reason"),
    /** Snapshotted, so changing the SLA later does not rewrite yesterday's compliance. */
    slaMinutes: smallint("sla_minutes").notNull(),
    escalated: boolean("escalated").default(false).notNull(),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at"),
    inProgressAt: timestamp("in_progress_at"),
    completedAt: timestamp("completed_at"),
    responseSeconds: integer("response_seconds"),
    resolutionSeconds: integer("resolution_seconds"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("req_request_active_idx").on(table.organizationId, table.branchId, table.status),
    index("req_request_place_idx").on(table.placeId, table.submittedAt),
    index("req_request_type_idx").on(table.requestTypeId, table.submittedAt),
    index("req_request_session_idx").on(table.sessionId, table.submittedAt),
  ],
);

/** Every transition, who caused it and when. Nothing here is ever updated or deleted. */
export const requestEvent = pgTable(
  "req_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    serviceRequestId: text("service_request_id")
      .notNull()
      .references(() => serviceRequest.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    actorType: text("actor_type").default("system").notNull(),
    actorUserId: text("actor_user_id"),
    actorName: text("actor_name"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("req_event_request_idx").on(table.serviceRequestId, table.createdAt)],
);

export type RequestTypeRow = typeof requestType.$inferSelect;
export type ServiceRequestRow = typeof serviceRequest.$inferSelect;
export type RequestEventRow = typeof requestEvent.$inferSelect;
