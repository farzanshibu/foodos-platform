/**
 * SOT: qr-schema, qr-code-table, qr-session-table, card-design-table, scan-table
 * WHAT   Every table the qr service owns: codes, the sessions a scan opens, the scans
 *        themselves, and printable card designs.
 * WHY    The code carries a public token and nothing else - no menu, no table parameters, no
 *        internal id. What the token means lives here, and only the server can resolve it.
 * NOTE   organization_id is a plain column, not a foreign key. restaurant_id, branch_id and
 *        table_id name rows owned by other services; integrity is enforced by events.
 * WHERE  services/qr/src/*.service.ts
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const qrCode = pgTable(
  "qr_code",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    branchId: text("branch_id"),
    placeId: text("place_id"),
    requestTypeId: text("request_type_id"),
    type: text("type").notNull(),
    /** Public, unguessable, and unique across every tenant - it is resolved before an org. */
    token: text("token").notNull(),
    label: text("label"),
    status: text("status").default("active").notNull(),
    scanCount: integer("scan_count").default(0).notNull(),
    uniqueScanCount: integer("unique_scan_count").default(0).notNull(),
    orderCount: integer("order_count").default(0).notNull(),
    revenuePaise: integer("revenue_paise").default(0).notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    lastScannedAt: timestamp("last_scanned_at"),
    /**
     * Display context, denormalised at creation time and refreshed by evt consumers.
     *
     * The scan page resolves a token BEFORE anyone knows which organisation is involved, so
     * it cannot ask the catalogue or the floor for a name - a downstream call inherits the
     * caller's org, and at that moment the caller has none. Reading it off this row also
     * makes the scan one query, which is most of what the sub-1.5-second budget buys.
     */
    restaurantName: text("restaurant_name").default("").notNull(),
    restaurantSlug: text("restaurant_slug").default("").notNull(),
    logoUrl: text("logo_url"),
    branchName: text("branch_name"),
    placeKind: text("place_kind"),
    placeLabel: text("place_label"),
    placeCapacity: integer("place_capacity"),
    /** Customer-visible parameters only. The internal ones never reach this table. */
    placeParameters: jsonb("table_parameters").default([]).notNull(),
    menuId: text("menu_id"),
    orderingEnabled: boolean("ordering_enabled").default(true).notNull(),
    requestsEnabled: boolean("requests_enabled").default(true).notNull(),
    currency: text("currency").default("INR").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("qr_code_token_idx").on(table.token),
    index("qr_code_org_idx").on(table.organizationId, table.type, table.status),
    index("qr_code_branch_idx").on(table.branchId),
    index("qr_code_place_idx").on(table.placeId),
  ],
);

export const qrSession = pgTable(
  "qr_session",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id").notNull(),
    branchId: text("branch_id"),
    placeId: text("place_id"),
    customerId: text("customer_id"),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    guestEmail: text("guest_email"),
    anonymousId: text("anonymous_id"),
    /**
     * How often a client without a live channel should ask again. Server-owned so staff can
     * change it without anybody shipping a client release.
     */
    pollIntervalSeconds: integer("poll_interval_seconds").default(10).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("qr_session_org_idx").on(table.organizationId, table.branchId),
    index("qr_session_code_idx").on(table.qrCodeId),
  ],
);

/**
 * One row per scan. Kept separate from the counters on the code so "unique visitors" can be
 * recomputed rather than trusted: a counter that only ever goes up is a counter nobody can
 * audit when the number looks wrong.
 */
export const qrScan = pgTable(
  "qr_scan",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    anonymousId: text("anonymous_id"),
    sessionId: text("session_id"),
    scannedAt: timestamp("scanned_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("qr_scan_code_idx").on(table.qrCodeId, table.scannedAt),
    index("qr_scan_anon_idx").on(table.qrCodeId, table.anonymousId),
  ],
);

export const cardDesign = pgTable(
  "qr_card_design",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    template: text("template").notNull(),
    /** The whole theme as one document: it is edited as one, previewed as one, printed as one. */
    theme: jsonb("theme").notNull(),
    slots: jsonb("slots").notNull(),
    requestTypeId: text("request_type_id"),
    qrCodeId: text("qr_code_id").references(() => qrCode.id, { onDelete: "set null" }),
    /** Populated by the render command; null until a format has been produced. */
    renderedSvg: text("rendered_svg"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("qr_card_org_slug_idx").on(table.organizationId, table.slug)],
);

export type QrCodeRow = typeof qrCode.$inferSelect;
export type QrSessionRow = typeof qrSession.$inferSelect;
export type QrScanRow = typeof qrScan.$inferSelect;
export type CardDesignRow = typeof cardDesign.$inferSelect;
