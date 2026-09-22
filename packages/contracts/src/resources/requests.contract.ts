/**
 * SOT: requests-contract, request-type-contract, service-request-contract, form-schema
 * WHAT   Input and output schemas for staff-configured request types and the requests guests
 *        submit against them.
 * WHY    "Request a charger" is configuration, not code. A restaurant declares a request
 *        type with a form; the customer app fetches it and renders the fields generically.
 *        Nothing on the client - and nothing in this file - knows what a charger is.
 * HOW    `formSchema` is the server-driven UI contract. It is a closed discriminated union
 *        so a field type the renderer cannot draw cannot be stored, while `formData` on the
 *        way back is deliberately loose on the wire and validated in the service against the
 *        schema as it is right now, not as it was when the browser rendered it.
 * WHERE  packages/contracts/src/contracts.ts, services/requests
 */
import { z } from "zod";

import { wireDate } from "../wire";

export const REQUEST_DESTINATIONS = ["waiter", "kitchen", "manager", "counter"] as const;
export const REQUEST_STATUSES = [
  "submitted",
  "acknowledged",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
] as const;
export const REQUEST_PRIORITIES = ["normal", "high"] as const;

/** The approved icon set. Drives the config UI and the customer card from one list. */
export const REQUEST_ICONS = [
  "bell",
  "battery-charging",
  "volume-2",
  "droplet",
  "sparkles",
  "credit-card",
  "utensils",
  "wifi",
  "plug-zap",
  "hand",
  "thermometer",
  "baby",
] as const;

/** Theme tokens, never colours. A hex code here is a colour that ignores dark mode. */
export const REQUEST_COLORS = ["brand", "success", "warning", "danger", "neutral"] as const;

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── The server-driven form ──────────────────────────────────────────────── */

const fieldBase = {
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-zA-Z0-9_]*$/, "Lowercase first letter, then letters, digits or underscores."),
  label: z.string().min(1).max(80),
  help: z.string().max(160).optional(),
  required: z.boolean().default(false),
};

/**
 * One member per renderable control, each carrying only the validation keys that make sense
 * for it. A single loose field object would let a `scale` land on a textarea and a
 * `maxLength` on a toggle, and the renderer would have to guess which to ignore.
 */
export const requestFormField = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(500).optional(),
    pattern: z.string().max(200).optional(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("textarea"),
    maxLength: z.number().int().min(1).max(2000).optional(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("select"),
    options: z.array(z.string().min(1).max(80)).min(1).max(30),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("multi_select"),
    options: z.array(z.string().min(1).max(80)).min(1).max(30),
    minSelections: z.number().int().min(0).max(30).optional(),
    maxSelections: z.number().int().min(1).max(30).optional(),
  }),
  z.object({ ...fieldBase, type: z.literal("toggle") }),
  z.object({ ...fieldBase, type: z.literal("rating"), scale: z.number().int().min(2).max(10) }),
  z.object({ ...fieldBase, type: z.literal("phone") }),
]);
export type RequestFormField = z.infer<typeof requestFormField>;

export const requestFormSchema = z.object({
  version: z.literal(1),
  fields: z.array(requestFormField).max(12),
});
export type RequestFormSchema = z.infer<typeof requestFormSchema>;

/* ── Request types ───────────────────────────────────────────────────────── */

export const requestTypeDto = z.object({
  id: z.string(),
  restaurantId: z.string().nullable(),
  branchId: z.string().nullable(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.enum(REQUEST_ICONS),
  color: z.enum(REQUEST_COLORS),
  formSchema: requestFormSchema,
  destination: z.enum(REQUEST_DESTINATIONS),
  slaMinutes: z.number().int().min(1).max(120),
  requiresPlace: z.boolean(),
  allowedOnlyDuringActiveOrder: z.boolean(),
  successMessage: z.string().nullable(),
  cardDesignId: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: wireDate,
});

const requestTypeFields = {
  name: z.string().min(1).max(60),
  description: z.string().max(200).nullable().optional(),
  icon: z.enum(REQUEST_ICONS),
  color: z.enum(REQUEST_COLORS).default("brand"),
  formSchema: requestFormSchema,
  destination: z.enum(REQUEST_DESTINATIONS),
  slaMinutes: z.number().int().min(1).max(120).default(5),
  requiresPlace: z.boolean().default(true),
  allowedOnlyDuringActiveOrder: z.boolean().default(false),
  successMessage: z.string().max(120).nullable().optional(),
  cardDesignId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
};

export const requestTypeContract = {
  read: {
    input: z.object({
      ...cursorPage,
      branchId: z.string().optional(),
      activeOnly: z.boolean().default(false),
      id: z.string().optional(),
    }),
    output: pageOf(requestTypeDto),
  },
  create: {
    input: z.object({
      restaurantId: z.string(),
      key: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,39}$/, "Lowercase, digits and underscores, 2 to 40 characters."),
      ...requestTypeFields,
    }),
    output: requestTypeDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      ...requestTypeFields,
      name: z.string().min(1).max(60).optional(),
      icon: z.enum(REQUEST_ICONS).optional(),
      formSchema: requestFormSchema.optional(),
      destination: z.enum(REQUEST_DESTINATIONS).optional(),
      isActive: z.boolean().optional(),
    }),
    output: requestTypeDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Service requests ────────────────────────────────────────────────────── */

export const requestEventDto = z.object({
  id: z.string(),
  event: z.enum([
    "created",
    "acknowledged",
    "in_progress",
    "completed",
    "rejected",
    "cancelled",
    "escalated",
    "assigned",
  ]),
  actorType: z.enum(["customer", "staff", "system"]),
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: wireDate,
});

export const serviceRequestDto = z.object({
  id: z.string(),
  branchId: z.string(),
  placeId: z.string().nullable(),
  placeLabel: z.string().nullable(),
  requestTypeId: z.string(),
  requestTypeKey: z.string(),
  requestTypeName: z.string(),
  icon: z.enum(REQUEST_ICONS),
  color: z.enum(REQUEST_COLORS),
  destination: z.enum(REQUEST_DESTINATIONS),
  orderId: z.string().nullable(),
  customerId: z.string().nullable(),
  guestName: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  priority: z.enum(REQUEST_PRIORITIES),
  /**
   * Loose here on purpose. The shape is whatever the request type's form says it is, and
   * that is checked in the service against the current schema - not against whichever
   * version the browser happened to render.
   */
  formData: z.record(z.string(), z.unknown()),
  /** The same data rendered as label/value pairs, so a console does not re-derive labels. */
  formSummary: z.array(z.object({ label: z.string(), value: z.string() })),
  assignedStaffId: z.string().nullable(),
  assignedStaffName: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  slaMinutes: z.number().int(),
  slaBreached: z.boolean(),
  escalated: z.boolean(),
  submittedAt: wireDate,
  acknowledgedAt: wireDate.nullable(),
  inProgressAt: wireDate.nullable(),
  completedAt: wireDate.nullable(),
  responseSeconds: z.number().int().nullable(),
  resolutionSeconds: z.number().int().nullable(),
  successMessage: z.string().nullable(),
  events: z.array(requestEventDto),
});

export const serviceRequestContract = {
  read: {
    input: z.object({
      ...cursorPage,
      id: z.string().optional(),
      branchId: z.string().optional(),
      placeId: z.string().optional(),
      requestTypeId: z.string().optional(),
      destination: z.enum(REQUEST_DESTINATIONS).optional(),
      bucket: z.enum(["active", "mine", "completed_today", "all"]).default("active"),
      /** A guest polling their own requests; the service scopes it to their session. */
      mineOnly: z.boolean().default(false),
    }),
    output: pageOf(serviceRequestDto),
  },
  create: {
    input: z.object({
      requestTypeKey: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,39}$/, "Lowercase, digits and underscores."),
      formData: z.record(z.string(), z.unknown()).default({}),
      orderId: z.string().optional(),
    }),
    output: serviceRequestDto,
  },
  /** The customer's own action, and the only one they have: withdraw it. */
  update: {
    input: z.object({ id: z.string(), action: z.literal("cancel") }),
    output: serviceRequestDto,
  },
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("acknowledge"), id: z.string() }),
      z.object({ action: z.literal("start"), id: z.string() }),
      z.object({
        action: z.literal("complete"),
        id: z.string(),
        note: z.string().max(300).optional(),
      }),
      z.object({
        action: z.literal("reject"),
        id: z.string(),
        reason: z.string().min(3).max(300),
      }),
      z.object({ action: z.literal("assign"), id: z.string(), staffId: z.string() }),
      z.object({
        action: z.literal("set_priority"),
        id: z.string(),
        priority: z.enum(REQUEST_PRIORITIES),
      }),
    ]),
    output: serviceRequestDto,
  },
} as const;
