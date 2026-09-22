/**
 * SOT: qr-handlers, qr-resolve, token-rotation, scan-tracking, session-bootstrap
 * WHAT   Business rules for QR codes and the sessions a scan opens.
 * WHY    Two rules carry this file. A token is resolved server-side and reveals nothing on
 *        its own; and rotating one invalidates every card already printed with it, which is
 *        why it is a named, audited action rather than an editable field.
 * HOW    Creating a code is done by staff, whose request carries a real organisation, so that
 *        is when the display context is fetched from the catalogue and written down. Opening
 *        a session happens before any organisation is known, so it only ever reads.
 * WHERE  services/qr/src/qr.service.ts, apps/web/src/app/q
 */
import "server-only";

import { type InputOf, ServiceError, signTicket } from "@foodos/contracts";
import { handlerFor, type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import { qrService, sessionService } from "./qr.service";
import type { QrCodeRow, QrSessionRow } from "./schema";
import { generateToken, renderQrSvg } from "./token";

type ManageInput = InputOf<"qrCode", "manage">;

const QR_TYPES = [
  "restaurant",
  "branch",
  "table",
  "menu",
  "ordering",
  "request",
  "feedback",
  "promo",
] as const;
const QR_STATUSES = ["active", "disabled", "revoked"] as const;

type QrType = (typeof QR_TYPES)[number];
type QrStatus = (typeof QR_STATUSES)[number];

const asType = (value: string): QrType =>
  QR_TYPES.find((candidate) => candidate === value) ?? "restaurant";
const asStatus = (value: string): QrStatus =>
  QR_STATUSES.find((candidate) => candidate === value) ?? "active";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const toCodeDto = (row: QrCodeRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  branchId: row.branchId,
  placeId: row.placeId,
  requestTypeId: row.requestTypeId,
  type: asType(row.type),
  token: row.token,
  label: row.label,
  status: asStatus(row.status),
  scanCount: row.scanCount,
  uniqueScanCount: row.uniqueScanCount,
  orderCount: row.orderCount,
  revenuePaise: row.revenuePaise,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  lastScannedAt: row.lastScannedAt,
  createdAt: row.createdAt,
});

/** JSONB is unknown until it is narrowed. Done once, here, rather than at every read. */
function readParameters(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    "label" in entry &&
    "value" in entry &&
    typeof entry.label === "string" &&
    typeof entry.value === "string"
      ? [{ label: entry.label, value: entry.value }]
      : [],
  );
}

/** Six hours: long enough for a meal, short enough that a stale phone is not a key. */
const TICKET_TTL_MS = 6 * 60 * 60 * 1000;

const toSessionDto = (session: QrSessionRow, code: QrCodeRow) => ({
  sessionId: session.id,
  /**
   * Minted here rather than by the page that will set it, because this is where the
   * organisation is known - and the point of a signed ticket is that the organisation inside
   * it was never in anybody else's hands.
   */
  ticket: signTicket(
    {
      sessionId: session.id,
      orgId: session.organizationId,
      restaurantId: code.restaurantId,
      branchId: code.branchId,
      placeId: code.placeId,
      qrCodeId: code.id,
      issuedAt: session.startedAt.getTime(),
      expiresAt: session.startedAt.getTime() + TICKET_TTL_MS,
    },
    env.envelopeSecret(),
  ),
  context: {
    restaurantId: code.restaurantId,
    restaurantName: code.restaurantName,
    restaurantSlug: code.restaurantSlug,
    logoUrl: code.logoUrl,
    branchId: code.branchId,
    branchName: code.branchName,
    placeId: code.placeId,
    placeKind: code.placeKind === "seat" ? ("seat" as const) : ("table" as const),
    placeLabel: code.placeLabel,
    placeCapacity: code.placeCapacity,
    placeParameters: readParameters(code.placeParameters),
    qrCodeId: code.id,
    qrType: asType(code.type),
    requestTypeId: code.requestTypeId,
    menuId: code.menuId,
    /** A menu-only or feedback code opens a menu that cannot be ordered from. */
    orderingEnabled:
      code.orderingEnabled && (asType(code.type) === "table" || asType(code.type) === "ordering"),
    requestsEnabled: code.requestsEnabled && code.placeId !== null,
    currency: code.currency,
  },
  guestName: session.guestName,
  guestPhone: session.guestPhone,
  pollIntervalSeconds: session.pollIntervalSeconds,
  isActive: session.isActive,
  startedAt: session.startedAt,
  lastSeenAt: session.lastSeenAt,
});

/**
 * Fetches what a scanned code should say, at the moment staff create it - the one moment the
 * request carries a real organisation. Best-effort per field: a code with no branch name is
 * still a working code, and refusing to create one because the catalogue had a bad second
 * would be the wrong trade for something a restaurant is about to print.
 */
async function displayContext(
  ctx: ServiceContext,
  input: {
    restaurantId: string;
    branchId?: string | null | undefined;
    placeId?: string | null | undefined;
  },
) {
  const secret = env.envelopeSecret();
  const context = {
    restaurantName: "",
    restaurantSlug: "",
    logoUrl: null as string | null,
    branchName: null as string | null,
    placeKind: null as "table" | "seat" | null,
    placeLabel: null as string | null,
    placeCapacity: null as number | null,
    placeParameters: [] as Array<{ label: string; value: string }>,
  };

  try {
    const found = await serviceCall({
      ctx,
      resource: "restaurant",
      operation: "read",
      input: { id: input.restaurantId, limit: 1, cursor: null },
      secret,
    });
    const restaurant = found.items[0];
    if (restaurant !== undefined) {
      context.restaurantName = restaurant.name;
      context.restaurantSlug = restaurant.slug;
      context.logoUrl = restaurant.logoUrl;
    }
  } catch (error) {
    console.warn("[qr] could not read the restaurant while creating a code", error);
  }

  if (input.branchId != null) {
    try {
      const found = await serviceCall({
        ctx,
        resource: "branch",
        operation: "read",
        input: { id: input.branchId, limit: 1, cursor: null },
        secret,
      });
      context.branchName = found.items[0]?.name ?? null;
    } catch (error) {
      console.warn("[qr] could not read the branch while creating a code", error);
    }
  }

  if (input.placeId != null) {
    try {
      const found = await serviceCall({
        ctx,
        resource: "place",
        operation: "read",
        input: {
          id: input.placeId,
          limit: 1,
          cursor: null,
          parameterFilters: [],
          customerVisibleParametersOnly: true,
        },
        secret,
      });
      const table = found.items[0];
      if (table !== undefined) {
        context.placeKind = table.kind;
        context.placeLabel = table.label;
        context.placeCapacity = table.capacity;
        context.placeParameters = table.parameters
          .filter((parameter) => parameter.isCustomerVisible)
          .map((parameter) => ({
            label: parameter.label,
            value: Array.isArray(parameter.value)
              ? parameter.value.join(", ")
              : String(parameter.value),
          }));
      }
    } catch (error) {
      console.warn("[qr] could not read the table while creating a code", error);
    }
  }

  return context;
}

export const qrCodeHandlers = [
  handlerFor("qrCode", "read", async ({ ctx, input }) => {
    const page = await qrService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.branchId, "branchId"),
      ...set(input.placeId, "placeId"),
      ...set(input.type, "type"),
      ...set(input.status, "status"),
      ...set(input.id, "id"),
    });
    return { items: page.items.map(toCodeDto), nextCursor: page.nextCursor };
  }),

  handlerFor("qrCode", "create", async ({ ctx, input }) => {
    const context = await displayContext(ctx, input);
    const created = await qrService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      placeId: input.placeId ?? null,
      requestTypeId: input.requestTypeId ?? null,
      type: input.type,
      token: generateToken(),
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      ...context,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The code was not created.");
    return toCodeDto(created);
  }),

  handlerFor("qrCode", "update", async ({ ctx, input }) => {
    const updated = await qrService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { ...set(input.label, "label"), ...set(input.expiresAt, "expiresAt") },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Code not found.");
    return toCodeDto(updated);
  }),

  handlerFor("qrCode", "delete", async ({ ctx, input }) => {
    const removed = await qrService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Code not found.");
    return removed;
  }),

  handlerFor("qrCode", "manage", ({ ctx, input }) => codeAction(ctx, input)),
];

async function codeAction(ctx: ServiceContext, input: ManageInput) {
  if (input.action === "bulk_places") {
    const codes: QrCodeRow[] = [];
    for (const placeId of input.placeIds) {
      const context = await displayContext(ctx, {
        restaurantId: "",
        branchId: input.branchId,
        placeId,
      });
      const created = await qrService.create({
        id: crypto.randomUUID(),
        organizationId: ctx.orgId,
        restaurantId: "",
        branchId: input.branchId,
        placeId,
        type: "table",
        token: generateToken(),
        label: context.placeLabel === null ? null : `Table ${context.placeLabel}`,
        ...context,
      });
      if (created !== null) codes.push(created);
    }
    return { codes: codes.map(toCodeDto), render: null };
  }

  const existing = await qrService.byId({ organizationId: ctx.orgId, id: input.id });
  if (existing === null) throw new ServiceError("NOT_FOUND", "Code not found.");

  if (input.action === "render") {
    return {
      codes: [toCodeDto(existing)],
      render: renderQrSvg({
        url: `${env.appUrl()}/q/${existing.token}`,
        sizeMm: input.sizeMm,
        label: existing.label,
      }),
    };
  }

  const patch =
    input.action === "rotate"
      ? /** Every printed card carrying the old token stops working. Hence the audit row. */
        { token: generateToken() }
      : input.action === "revoke"
        ? { status: "revoked", revokedAt: new Date() }
        : input.action === "disable"
          ? { status: "disabled" }
          : { status: "active", revokedAt: null };

  const updated = await qrService.update({ organizationId: ctx.orgId, id: input.id, patch });
  if (updated === null) throw new ServiceError("INTERNAL", "The code was not updated.");
  return { codes: [toCodeDto(updated)], render: null };
}

export const qrSessionHandlers = [
  handlerFor("qrSession", "read", async ({ ctx }) => {
    const session = await sessionService.byId({ organizationId: ctx.orgId, id: ctx.userId });
    if (session === null) throw new ServiceError("NOT_FOUND", "This session has ended.");
    const code = await qrService.byId({ organizationId: ctx.orgId, id: session.qrCodeId });
    if (code === null) throw new ServiceError("NOT_FOUND", "This code is no longer active.");
    await sessionService.update({
      organizationId: ctx.orgId,
      id: session.id,
      patch: { lastSeenAt: new Date() },
    });
    return toSessionDto(session, code);
  }),

  /**
   * The bootstrap. It runs before anybody knows which organisation is involved, so it does
   * not scope by ctx.orgId - it discovers the organisation from the token and writes it into
   * the session. Everything the caller can do afterwards is scoped to what it found.
   */
  handlerFor("qrSession", "create", async ({ input }) => {
    const code = await qrService.byToken(input.token);
    if (code === null) {
      throw new ServiceError("NOT_FOUND", "This code isn't active. Please ask our staff.");
    }
    if (code.status !== "active") {
      throw new ServiceError("NOT_FOUND", "This code isn't active. Please ask our staff.");
    }
    if (code.expiresAt !== null && code.expiresAt.getTime() <= Date.now()) {
      throw new ServiceError("NOT_FOUND", "This code has expired. Please ask our staff.");
    }

    const session = await sessionService.create({
      id: crypto.randomUUID(),
      organizationId: code.organizationId,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
      branchId: code.branchId,
      placeId: code.placeId,
      anonymousId: input.anonymousId ?? null,
    });
    if (session === null) throw new ServiceError("INTERNAL", "The session could not be opened.");

    await qrService.recordScan({
      organizationId: code.organizationId,
      qrCodeId: code.id,
      anonymousId: input.anonymousId ?? null,
      sessionId: session.id,
    });

    return toSessionDto(session, code);
  }),

  handlerFor("qrSession", "manage", async ({ ctx, input }) => {
    const session = await sessionService.byId({ organizationId: ctx.orgId, id: ctx.userId });
    if (session === null) throw new ServiceError("NOT_FOUND", "This session has ended.");

    const patch =
      input.action === "heartbeat"
        ? { lastSeenAt: new Date() }
        : input.action === "end"
          ? { isActive: false, endedAt: new Date() }
          : {
              guestName: input.guestName,
              ...set(input.guestPhone, "guestPhone"),
              ...set(input.guestEmail, "guestEmail"),
            };

    const updated = await sessionService.update({
      organizationId: ctx.orgId,
      id: session.id,
      patch,
    });
    if (updated === null) throw new ServiceError("INTERNAL", "The session was not updated.");
    const code = await qrService.byId({ organizationId: ctx.orgId, id: session.qrCodeId });
    if (code === null) throw new ServiceError("NOT_FOUND", "This code is no longer active.");
    return toSessionDto(updated, code);
  }),
];
