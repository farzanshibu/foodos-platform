/**
 * SOT: request-handlers, request-submit, request-console, request-sla
 * WHAT   Business rules for configuring request types and working the requests they produce.
 * WHY    The feature only holds together if two things are true: a guest's submission is
 *        validated against the form as it is RIGHT NOW, and nobody can turn the request cards
 *        into a doorbell. Both live here.
 * HOW    Every transition is checked against the state machine and written to the event trail,
 *        so "who acknowledged this and when" is answerable a month later.
 * WHERE  services/requests/src/form.ts, services/requests/src/constants.ts
 */
import "server-only";

import { type InputOf, ServiceError } from "@foodos/contracts";
import { handlerFor, type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import {
  ACTIVE_REQUEST_STATUSES,
  DUPLICATE_WINDOW_SECONDS,
  isRequestStatus,
  MAX_OPEN_REQUESTS_PER_TABLE,
  REQUEST_TRANSITIONS,
  type RequestStatus,
} from "./constants";
import { readFormSchema, validateSubmission } from "./form";
import { requestService, typeService } from "./request.service";
import type { RequestEventRow, RequestTypeRow, ServiceRequestRow } from "./schema";

type ManageInput = InputOf<"serviceRequest", "manage">;

const ICONS = [
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
const COLORS = ["brand", "success", "warning", "danger", "neutral"] as const;
const DESTINATIONS = ["waiter", "kitchen", "manager", "counter"] as const;
const EVENTS = [
  "created",
  "acknowledged",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
  "escalated",
  "assigned",
] as const;
const ACTOR_TYPES = ["customer", "staff", "system"] as const;

type Icon = (typeof ICONS)[number];
type Color = (typeof COLORS)[number];
type Destination = (typeof DESTINATIONS)[number];
type EventName = (typeof EVENTS)[number];
type ActorType = (typeof ACTOR_TYPES)[number];

const asIcon = (value: string): Icon => ICONS.find((c) => c === value) ?? "bell";
const asColor = (value: string): Color => COLORS.find((c) => c === value) ?? "brand";
const asDestination = (value: string): Destination =>
  DESTINATIONS.find((c) => c === value) ?? "waiter";
const asEvent = (value: string): EventName => EVENTS.find((c) => c === value) ?? "created";
const asActorType = (value: string): ActorType => ACTOR_TYPES.find((c) => c === value) ?? "system";
const asStatus = (value: string): RequestStatus => (isRequestStatus(value) ? value : "submitted");

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const toTypeDto = (row: RequestTypeRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  branchId: row.branchId,
  key: row.key,
  name: row.name,
  description: row.description,
  icon: asIcon(row.icon),
  color: asColor(row.color),
  formSchema: readFormSchema(row.formSchema),
  destination: asDestination(row.destination),
  slaMinutes: row.slaMinutes,
  requiresPlace: row.requiresPlace,
  allowedOnlyDuringActiveOrder: row.allowedOnlyDuringActiveOrder,
  successMessage: row.successMessage,
  cardDesignId: row.cardDesignId,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt,
});

/** JSONB comes back unknown; the summary is rebuilt from the stored data and its form. */
function summarise(type: RequestTypeRow, formData: unknown) {
  try {
    return validateSubmission(readFormSchema(type.formSchema), formData).summary;
  } catch {
    /** A form that has since changed shape must not make an old request unreadable. */
    return [];
  }
}

function toRequestDto(args: {
  row: ServiceRequestRow;
  type: RequestTypeRow;
  events: readonly RequestEventRow[];
  now: number;
}) {
  const breachAt = args.row.submittedAt.getTime() + args.row.slaMinutes * 60_000;
  const open = ACTIVE_REQUEST_STATUSES.some((status) => status === args.row.status);
  const fields =
    typeof args.row.formData === "object" && args.row.formData !== null ? args.row.formData : {};

  return {
    id: args.row.id,
    branchId: args.row.branchId,
    placeId: args.row.placeId,
    placeLabel: args.row.placeLabel,
    requestTypeId: args.type.id,
    requestTypeKey: args.type.key,
    requestTypeName: args.type.name,
    icon: asIcon(args.type.icon),
    color: asColor(args.type.color),
    destination: asDestination(args.type.destination),
    orderId: args.row.orderId,
    customerId: args.row.customerId,
    guestName: args.row.guestName,
    status: asStatus(args.row.status),
    priority: args.row.priority === "high" ? ("high" as const) : ("normal" as const),
    formData: Object.fromEntries(Object.entries(fields)),
    formSummary: summarise(args.type, args.row.formData),
    assignedStaffId: args.row.assignedStaffId,
    assignedStaffName: args.row.assignedStaffName,
    rejectionReason: args.row.rejectionReason,
    slaMinutes: args.row.slaMinutes,
    /** Computed here, not on the device: a tablet with a wrong clock must not decide this. */
    slaBreached: open && args.now > breachAt,
    escalated: args.row.escalated,
    submittedAt: args.row.submittedAt,
    acknowledgedAt: args.row.acknowledgedAt,
    inProgressAt: args.row.inProgressAt,
    completedAt: args.row.completedAt,
    responseSeconds: args.row.responseSeconds,
    resolutionSeconds: args.row.resolutionSeconds,
    successMessage: args.type.successMessage,
    events: args.events
      .filter((event) => event.serviceRequestId === args.row.id)
      .map((event) => ({
        id: event.id,
        event: asEvent(event.event),
        actorType: asActorType(event.actorType),
        actorName: event.actorName,
        note: event.note,
        createdAt: event.createdAt,
      })),
  };
}

async function decorate(organizationId: string, rows: readonly ServiceRequestRow[]) {
  if (rows.length === 0) return [];
  const [types, events] = await Promise.all([
    typeService.byIds({
      organizationId,
      ids: [...new Set(rows.map((row) => row.requestTypeId))],
    }),
    requestService.eventsFor({ organizationId, requestIds: rows.map((row) => row.id) }),
  ]);
  const now = Date.now();
  return rows.flatMap((row) => {
    const type = types.find((candidate) => candidate.id === row.requestTypeId);
    return type === undefined ? [] : [toRequestDto({ row, type, events, now })];
  });
}

async function loadRequest(organizationId: string, id: string) {
  const row = await requestService.byId({ organizationId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Request not found.");
  const [decorated] = await decorate(organizationId, [row]);
  if (decorated === undefined) {
    throw new ServiceError("INTERNAL", "This request's type could not be read.");
  }
  return decorated;
}

export const requestTypeHandlers = [
  handlerFor("requestType", "read", async ({ ctx, input }) => {
    const page = await typeService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      /** A guest is only ever shown types that are switched on. */
      activeOnly: ctx.role === "guest" || input.activeOnly,
      ...set(input.branchId, "branchId"),
      ...set(input.id, "id"),
    });
    return { items: page.items.map(toTypeDto), nextCursor: page.nextCursor };
  }),

  handlerFor("requestType", "create", async ({ ctx, input }) => {
    const clash = await typeService.byKey({ organizationId: ctx.orgId, key: input.key });
    if (clash !== null) {
      throw new ServiceError("CONFLICT", `A request type called "${input.key}" already exists.`);
    }
    const created = await typeService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon,
      color: input.color,
      formSchema: input.formSchema,
      destination: input.destination,
      slaMinutes: input.slaMinutes,
      requiresPlace: input.requiresPlace,
      allowedOnlyDuringActiveOrder: input.allowedOnlyDuringActiveOrder,
      successMessage: input.successMessage ?? null,
      cardDesignId: input.cardDesignId ?? null,
      sortOrder: input.sortOrder,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The request type was not created.");
    return toTypeDto(created);
  }),

  handlerFor("requestType", "update", async ({ ctx, input }) => {
    const updated = await typeService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.description, "description"),
        ...set(input.icon, "icon"),
        ...set(input.color, "color"),
        ...set(input.formSchema, "formSchema"),
        ...set(input.destination, "destination"),
        ...set(input.slaMinutes, "slaMinutes"),
        ...set(input.requiresPlace, "requiresPlace"),
        ...set(input.allowedOnlyDuringActiveOrder, "allowedOnlyDuringActiveOrder"),
        ...set(input.successMessage, "successMessage"),
        ...set(input.cardDesignId, "cardDesignId"),
        ...set(input.branchId, "branchId"),
        ...set(input.sortOrder, "sortOrder"),
        ...set(input.isActive, "isActive"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Request type not found.");
    return toTypeDto(updated);
  }),

  handlerFor("requestType", "delete", async ({ ctx, input }) => {
    const removed = await typeService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Request type not found.");
    return removed;
  }),
];

/**
 * Where the person submitting this actually is. A guest never sends a table id - they could
 * name any table in the building - so it is read back from the QR session the server opened
 * for them. Staff submitting on somebody's behalf get no table, which is correct: they are
 * standing there.
 */
async function whereFrom(ctx: ServiceContext): Promise<{
  branchId: string;
  placeId: string | null;
  placeLabel: string | null;
  guestName: string | null;
  guestPhone: string | null;
}> {
  if (ctx.role !== "guest") {
    return { branchId: "", placeId: null, placeLabel: null, guestName: null, guestPhone: null };
  }
  const session = await serviceCall({
    ctx,
    resource: "qrSession",
    operation: "read",
    input: {},
    secret: env.envelopeSecret(),
  });
  return {
    branchId: session.context.branchId ?? "",
    placeId: session.context.placeId,
    placeLabel: session.context.placeLabel,
    guestName: session.guestName,
    guestPhone: session.guestPhone,
  };
}

/** Two guards so the request cards stay a service and do not become a doorbell. */
async function assertNotSpam(args: {
  organizationId: string;
  placeId: string | null;
  requestTypeId: string;
}) {
  if (args.placeId === null) return;
  const open = await requestService.openForTable({
    organizationId: args.organizationId,
    placeId: args.placeId,
    requestTypeId: args.requestTypeId,
  });

  const sameAgain = open.find(
    (row) => Date.now() - row.submittedAt.getTime() < DUPLICATE_WINDOW_SECONDS * 1000,
  );
  if (sameAgain !== undefined) {
    throw new ServiceError("CONFLICT", "We already have that request. Somebody is on their way.");
  }
  if (open.length >= MAX_OPEN_REQUESTS_PER_TABLE) {
    throw new ServiceError("CONFLICT", "There are already several requests open for this table.");
  }
}

export const serviceRequestHandlers = [
  handlerFor("serviceRequest", "read", async ({ ctx, input }) => {
    const bucket = input.bucket;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    const page = await requestService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.id, "id"),
      ...set(input.branchId, "branchId"),
      ...set(input.placeId, "placeId"),
      ...set(input.requestTypeId, "requestTypeId"),
      ...(bucket === "active" ? { statuses: ACTIVE_REQUEST_STATUSES } : {}),
      ...(bucket === "completed_today" ? { statuses: ["completed"], since: midnight } : {}),
      /** A guest sees their own session's requests and nothing else, whatever they asked for. */
      ...(ctx.role === "guest" || input.mineOnly ? { sessionId: ctx.userId } : {}),
    });

    const decorated = await decorate(ctx.orgId, page.items);
    return {
      items:
        input.destination === undefined
          ? decorated
          : decorated.filter((row) => row.destination === input.destination),
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("serviceRequest", "create", async ({ ctx, input }) => {
    const type = await typeService.byKey({ organizationId: ctx.orgId, key: input.requestTypeKey });
    if (type === null || !type.isActive) {
      throw new ServiceError("NOT_FOUND", "That request is not available here.");
    }

    /**
     * Re-validated against the CURRENT form, not the one the browser rendered. Staff may have
     * changed the fields while somebody had the sheet open, and this is the moment that matters.
     */
    const { data } = validateSubmission(readFormSchema(type.formSchema), input.formData);

    const origin = await whereFrom(ctx);
    if (type.requiresPlace && origin.placeId === null) {
      throw new ServiceError("CONFLICT", "Scan the code on your table to make this request.");
    }

    await assertNotSpam({
      organizationId: ctx.orgId,
      placeId: origin.placeId,
      requestTypeId: type.id,
    });

    const id = crypto.randomUUID();
    const created = await requestService.create({
      id,
      organizationId: ctx.orgId,
      branchId: origin.branchId === "" ? (type.branchId ?? "") : origin.branchId,
      placeId: origin.placeId,
      placeLabel: origin.placeLabel,
      requestTypeId: type.id,
      sessionId: ctx.role === "guest" ? ctx.userId : null,
      guestName: origin.guestName,
      guestPhone: origin.guestPhone,
      orderId: input.orderId ?? null,
      formData: data,
      slaMinutes: type.slaMinutes,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The request was not submitted.");

    await requestService.addEvent({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      serviceRequestId: id,
      event: "created",
      actorType: ctx.role === "guest" ? "customer" : "staff",
      actorUserId: ctx.role === "guest" ? null : ctx.userId,
    });

    return loadRequest(ctx.orgId, id);
  }),

  /** The customer's only action: withdraw it, and only while nobody has picked it up. */
  handlerFor("serviceRequest", "update", async ({ ctx, input }) => {
    const existing = await requestService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Request not found.");
    if (ctx.role === "guest" && existing.sessionId !== ctx.userId) {
      throw new ServiceError("NOT_FOUND", "Request not found.");
    }

    const from = asStatus(existing.status);
    if (!REQUEST_TRANSITIONS[from].some((candidate) => candidate === "cancelled")) {
      throw new ServiceError("CONFLICT", "Somebody is already dealing with this request.");
    }

    await requestService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { status: "cancelled" },
    });
    await requestService.addEvent({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      serviceRequestId: input.id,
      event: "cancelled",
      actorType: "customer",
    });
    return loadRequest(ctx.orgId, input.id);
  }),

  handlerFor("serviceRequest", "manage", async ({ ctx, input }) => {
    const existing = await requestService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Request not found.");
    await applyStaffAction({ organizationId: ctx.orgId, actorUserId: ctx.userId, existing, input });
    return loadRequest(ctx.orgId, input.id);
  }),
];

function nextStatus(action: ManageInput["action"]): RequestStatus | null {
  switch (action) {
    case "acknowledge":
      return "acknowledged";
    case "start":
      return "in_progress";
    case "complete":
      return "completed";
    case "reject":
      return "rejected";
    default:
      return null;
  }
}

async function applyStaffAction(args: {
  organizationId: string;
  actorUserId: string;
  existing: ServiceRequestRow;
  input: ManageInput;
}) {
  const { organizationId, existing, input } = args;

  if (input.action === "assign" || input.action === "set_priority") {
    await requestService.update({
      organizationId,
      id: input.id,
      patch:
        input.action === "assign"
          ? { assignedStaffId: input.staffId }
          : { priority: input.priority },
    });
    await requestService.addEvent({
      id: crypto.randomUUID(),
      organizationId,
      serviceRequestId: input.id,
      event: input.action === "assign" ? "assigned" : "escalated",
      actorType: "staff",
      actorUserId: args.actorUserId,
    });
    return;
  }

  const to = nextStatus(input.action);
  if (to === null) throw new ServiceError("INVALID_INPUT", "Unknown request action.");

  const from = asStatus(existing.status);
  if (from === to) throw new ServiceError("CONFLICT", `This request is already ${to}.`);
  if (!REQUEST_TRANSITIONS[from].some((candidate) => candidate === to)) {
    throw new ServiceError("CONFLICT", `A ${from} request cannot become ${to}.`);
  }

  const now = new Date();
  const seconds = (from: Date) => Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));

  await requestService.update({
    organizationId,
    id: input.id,
    patch: {
      status: to,
      ...(to === "acknowledged"
        ? { acknowledgedAt: now, responseSeconds: seconds(existing.submittedAt) }
        : {}),
      ...(to === "in_progress" ? { inProgressAt: now } : {}),
      ...(to === "completed"
        ? { completedAt: now, resolutionSeconds: seconds(existing.submittedAt) }
        : {}),
      ...(input.action === "reject" ? { rejectionReason: input.reason } : {}),
    },
  });

  await requestService.addEvent({
    id: crypto.randomUUID(),
    organizationId,
    serviceRequestId: input.id,
    event: to === "in_progress" ? "in_progress" : to,
    actorType: "staff",
    actorUserId: args.actorUserId,
    note:
      input.action === "reject"
        ? input.reason
        : input.action === "complete"
          ? (input.note ?? null)
          : null,
  });
}
