/**
 * SOT: qr-contract, qr-code-contract, qr-session-contract, card-design-contract
 * WHAT   Input and output schemas for QR codes, the sessions a scan opens, and the printable
 *        cards those codes end up on.
 * WHY    The QR is the product's front door, and the rule that makes it safe is that the
 *        code carries a public token and nothing else. No menu, no table parameters, no
 *        internal id: the server resolves the token and is the only thing that knows what
 *        it means. These schemas are what keep that true on the wire.
 * HOW    `qrSession.create` takes a token and returns the resolved context - but never an
 *        organisation id, which the service adds server-side when it mints the guest ticket.
 *        See packages/contracts/src/ticket.ts for the ticket that context becomes.
 * WHERE  packages/contracts/src/contracts.ts, services/qr, apps/web/src/app/q
 */
import { z } from "zod";

import { wireDate } from "../wire";

export const QR_TYPES = [
  "restaurant",
  "branch",
  "table",
  "menu",
  "ordering",
  "request",
  "feedback",
  "promo",
] as const;
export const QR_STATUSES = ["active", "disabled", "revoked"] as const;
export const CARD_TEMPLATES = ["table_tent", "sticker", "poster", "counter_card"] as const;
export const CARD_SLOTS = [
  "logo",
  "headline",
  "subheadline",
  "icon",
  "qr",
  "placeLabel",
  "footer",
] as const;
export const RENDER_FORMATS = ["svg", "png", "pdf"] as const;

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── QR codes ────────────────────────────────────────────────────────────── */

export const qrCodeDto = z.object({
  id: z.string(),
  restaurantId: z.string(),
  branchId: z.string().nullable(),
  placeId: z.string().nullable(),
  requestTypeId: z.string().nullable(),
  type: z.enum(QR_TYPES),
  /** The public token. Ten crypto-random characters, no internal id inside it. */
  token: z.string(),
  label: z.string().nullable(),
  status: z.enum(QR_STATUSES),
  scanCount: z.number().int(),
  uniqueScanCount: z.number().int(),
  orderCount: z.number().int(),
  revenuePaise: z.number().int(),
  expiresAt: wireDate.nullable(),
  revokedAt: wireDate.nullable(),
  lastScannedAt: wireDate.nullable(),
  createdAt: wireDate,
});

/**
 * A QR type names what it resolves to, so the thing it resolves to has to be there. A table
 * code with no table is a code that opens an error page, and finding that out at print time
 * is finding it out too late.
 */
function refineQrTarget(
  value: {
    type?: (typeof QR_TYPES)[number] | undefined;
    branchId?: string | null | undefined;
    placeId?: string | null | undefined;
    requestTypeId?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === "table" && value.placeId == null) {
    ctx.addIssue({ code: "custom", path: ["placeId"], message: "A table code needs a table." });
  }
  if (value.type === "branch" && value.branchId == null) {
    ctx.addIssue({ code: "custom", path: ["branchId"], message: "A branch code needs a branch." });
  }
  if (value.type === "request" && value.requestTypeId == null) {
    ctx.addIssue({
      code: "custom",
      path: ["requestTypeId"],
      message: "A request code needs a request type.",
    });
  }
}

export const qrCodeContract = {
  read: {
    input: z.object({
      ...cursorPage,
      restaurantId: z.string().optional(),
      branchId: z.string().optional(),
      placeId: z.string().optional(),
      type: z.enum(QR_TYPES).optional(),
      status: z.enum(QR_STATUSES).optional(),
      id: z.string().optional(),
    }),
    output: pageOf(qrCodeDto),
  },
  create: {
    input: z
      .object({
        restaurantId: z.string(),
        branchId: z.string().nullable().optional(),
        placeId: z.string().nullable().optional(),
        requestTypeId: z.string().nullable().optional(),
        type: z.enum(QR_TYPES),
        label: z.string().max(80).nullable().optional(),
        expiresAt: wireDate.nullable().optional(),
      })
      .superRefine(refineQrTarget),
    output: qrCodeDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      label: z.string().max(80).nullable().optional(),
      expiresAt: wireDate.nullable().optional(),
    }),
    output: qrCodeDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * Rotating a token invalidates every card already printed with it, which is why it is an
   * audited action with its own name rather than a field somebody could change by accident.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("rotate"), id: z.string() }),
      z.object({ action: z.literal("revoke"), id: z.string() }),
      z.object({ action: z.literal("enable"), id: z.string() }),
      z.object({ action: z.literal("disable"), id: z.string() }),
      z.object({
        action: z.literal("render"),
        id: z.string(),
        format: z.enum(RENDER_FORMATS),
        sizeMm: z.number().int().min(20).max(400).default(40),
      }),
      z.object({
        action: z.literal("bulk_places"),
        branchId: z.string(),
        placeIds: z.array(z.string()).min(1).max(500),
      }),
    ]),
    output: z.object({
      codes: z.array(qrCodeDto),
      /** An inline SVG document, or a signed short-lived URL for a raster format. */
      render: z.string().nullable(),
    }),
  },
} as const;

/* ── QR sessions ─────────────────────────────────────────────────────────── */

/** What a guest is shown about where they are sitting, resolved server-side from the token. */
export const qrSessionContextDto = z.object({
  restaurantId: z.string(),
  restaurantName: z.string(),
  restaurantSlug: z.string(),
  logoUrl: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  placeId: z.string().nullable(),
  /** "table" or "seat" - the only thing that changes the words a guest reads. */
  placeKind: z.enum(["table", "seat"]).nullable(),
  placeLabel: z.string().nullable(),
  placeCapacity: z.number().int().nullable(),
  /** Customer-visible table parameters only. The internal ones never leave the service. */
  placeParameters: z.array(z.object({ label: z.string(), value: z.string() })),
  qrCodeId: z.string(),
  qrType: z.enum(QR_TYPES),
  requestTypeId: z.string().nullable(),
  menuId: z.string().nullable(),
  orderingEnabled: z.boolean(),
  requestsEnabled: z.boolean(),
  currency: z.string(),
});

export const qrSessionDto = z.object({
  sessionId: z.string(),
  /**
   * The opaque, server-signed session token for this scan - see packages/contracts/ticket.ts.
   * It is what the scan page puts in an HttpOnly cookie, and it is how the gateway identifies
   * a guest on every later request without a lookup.
   *
   * The organisation is inside it because the server put it there and verifies the signature
   * before reading it back. That is the opposite of an org id in a contract: nothing here is
   * a field a caller could set, and an unsigned or edited token identifies nobody at all.
   */
  ticket: z.string(),
  context: qrSessionContextDto,
  guestName: z.string().nullable(),
  guestPhone: z.string().nullable(),
  /**
   * How often a client without a live channel should ask again, decided by the server so
   * staff can change it without anybody shipping a client.
   */
  pollIntervalSeconds: z.number().int().min(5).max(60),
  isActive: z.boolean(),
  startedAt: wireDate,
  lastSeenAt: wireDate,
});

export const qrSessionContract = {
  read: {
    input: z.object({}),
    output: qrSessionDto,
  },
  /**
   * The bootstrap. It takes the public token and nothing else, and it is the one operation
   * that legitimately runs before anybody knows which organisation is involved - see
   * PLATFORM_ORG_ID in the registry. Its output is what the scan page signs into a ticket.
   */
  create: {
    input: z.object({
      token: z.string().min(4).max(64),
      anonymousId: z.string().max(64).optional(),
    }),
    output: qrSessionDto,
  },
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("heartbeat") }),
      z.object({
        action: z.literal("identify"),
        guestName: z.string().min(1).max(80),
        guestPhone: z
          .string()
          .regex(/^\+?[0-9]{7,15}$/, "Not a phone number.")
          .optional(),
        guestEmail: z.string().email().optional(),
      }),
      z.object({ action: z.literal("end") }),
    ]),
    output: qrSessionDto,
  },
} as const;

/* ── Card designs ────────────────────────────────────────────────────────── */

export const cardThemeDto = z.object({
  bg: z.string(),
  accent: z.string(),
  text: z.string(),
  headline: z.string(),
  subheadline: z.string().nullable(),
  footer: z.string().nullable(),
  icon: z.string().nullable(),
  logoUrl: z.string().nullable(),
  showPlaceLabel: z.boolean(),
  qr: z.object({
    sizeMm: z.number().int().min(20).max(200),
    position: z.enum(["top", "center", "bottom"]),
  }),
});

const slotPosition = z.object({ x: z.number(), y: z.number() });

/**
 * Keyed by the seven named slots rather than an open record: a slot the renderer does not
 * know about is a slot that silently does not print.
 */
export const cardSlotsDto = z.object({
  logo: slotPosition,
  headline: slotPosition,
  subheadline: slotPosition,
  icon: slotPosition,
  qr: slotPosition,
  placeLabel: slotPosition,
  footer: slotPosition,
});

export const cardDesignDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  template: z.enum(CARD_TEMPLATES),
  theme: cardThemeDto,
  slots: cardSlotsDto,
  requestTypeId: z.string().nullable(),
  qrCodeId: z.string().nullable(),
  qrToken: z.string().nullable(),
  /** The hosted page for this design - staff-only, see apps/web/src/app/c/[slug]/page.tsx. */
  hostedPath: z.string(),
  /**
   * The artwork the render command produced, or null until it has run.
   *
   * On the DTO rather than behind an operation of its own because the render contract below
   * promises exactly this: the caller gets an acceptance and "collects the file from the
   * design once it is ready". Without it there was nowhere to collect it from. Nullable and
   * not optional, because "not rendered yet" is a state the hosted page shows rather than an
   * error - and an edit clears it, so a design changed since its last render is here too.
   */
  renderedSvg: z.string().nullable(),
  linkedRequestTypeNames: z.array(z.string()),
  createdAt: wireDate,
  updatedAt: wireDate,
});

const cardThemeInput = z.object({
  bg: z.string().max(40),
  accent: z.string().max(40),
  text: z.string().max(40),
  headline: z.string().min(2).max(40),
  subheadline: z.string().max(80).nullable().optional(),
  footer: z.string().max(60).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  showPlaceLabel: z.boolean().default(true),
  qr: z.object({
    sizeMm: z.number().int().min(20).max(200),
    position: z.enum(["top", "center", "bottom"]).default("center"),
  }),
});

export const cardDesignContract = {
  read: {
    input: z.object({ ...cursorPage, id: z.string().optional(), slug: z.string().optional() }),
    output: pageOf(cardDesignDto),
  },
  create: {
    input: z.object({
      name: z.string().min(1).max(60),
      template: z.enum(CARD_TEMPLATES),
      theme: cardThemeInput,
      slots: cardSlotsDto.partial().optional(),
      requestTypeId: z.string().nullable().optional(),
    }),
    output: cardDesignDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(60).optional(),
      template: z.enum(CARD_TEMPLATES).optional(),
      theme: cardThemeInput.optional(),
      slots: cardSlotsDto.partial().optional(),
      requestTypeId: z.string().nullable().optional(),
    }),
    output: cardDesignDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * Rendering is a command: rasterising an A4 poster at 300 DPI is not a request-path job.
   * The caller gets an acceptance and collects the file from the design once it is ready.
   */
  manage: {
    input: z.object({ id: z.string(), format: z.enum(RENDER_FORMATS) }),
    output: z.object({ accepted: z.literal(true), requestId: z.string() }),
  },
} as const;
