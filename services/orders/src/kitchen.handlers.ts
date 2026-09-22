/**
 * SOT: kitchen-handlers, kitchen-display, ticket-transitions, station-routing
 * WHAT   Business rules for the kitchen display: what a ticket shows and how it moves.
 * WHY    A kitchen ticket is built from the order's item lines and a combo's CHILDREN, never
 *        from the combo parent - the parent is a price, and a kitchen cannot plate a price.
 *        Each child names the combo it belongs to so the pass sends them out together.
 * HOW    Every state change goes through assertTransition. Age and lateness are computed
 *        server-side, because a display on a tablet with a wrong clock would otherwise
 *        decide for itself what "delayed" means.
 * WHERE  services/orders/src/order.mapper.ts, services/orders/src/constants.ts
 */
import "server-only";

import { type InputOf, ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import {
  assertTransition,
  isKitchenStatus,
  KITCHEN_TRANSITIONS,
  type KitchenStatus,
} from "./constants";
import { toTicketLines } from "./order.mapper";
import { kitchenService, orderService } from "./order.service";
import type { KitchenStationRow, KitchenTicketRow, OrderRow } from "./schema";

type ManageInput = InputOf<"kitchenTicket", "manage">;

/** A ticket nobody has started within this long is late enough for the display to say so. */
const DELAY_THRESHOLD_SECONDS = 15 * 60;

const asKitchenStatus = (value: string): KitchenStatus =>
  isKitchenStatus(value) ? value : "pending";

const asPriority = (value: string): "normal" | "high" => (value === "high" ? "high" : "normal");

function statusesFor(bucket: string): readonly KitchenStatus[] | undefined {
  switch (bucket) {
    case "new":
      return ["pending"];
    case "preparing":
      return ["accepted", "preparing"];
    case "ready":
      return ["ready"];
    /** Delayed is a time window over open tickets, not a status; narrowed after the read. */
    case "delayed":
      return ["pending", "accepted", "preparing"];
    default:
      return undefined;
  }
}

function toTicketDto(args: {
  ticket: KitchenTicketRow;
  order: OrderRow | undefined;
  stations: readonly KitchenStationRow[];
  lines: ReturnType<typeof toTicketLines>;
  now: number;
}) {
  const ageSeconds = Math.max(0, Math.floor((args.now - args.ticket.createdAt.getTime()) / 1000));
  return {
    id: args.ticket.id,
    orderId: args.ticket.orderId,
    branchId: args.ticket.branchId,
    stationId: args.ticket.stationId,
    stationName:
      args.stations.find((station) => station.id === args.ticket.stationId)?.name ?? null,
    ticketNumber: args.ticket.ticketNumber,
    orderNumber: args.order?.orderNumber ?? "",
    placeLabel: args.order?.placeLabel ?? null,
    status: asKitchenStatus(args.ticket.status),
    priority: asPriority(args.ticket.priority),
    estimatedMinutes: args.ticket.estimatedMinutes,
    ageSeconds,
    isDelayed: args.ticket.readyAt === null && ageSeconds > DELAY_THRESHOLD_SECONDS,
    lines: args.lines,
    createdAt: args.ticket.createdAt,
  };
}

async function loadTicket(organizationId: string, id: string) {
  const ticket = await kitchenService.byId({ organizationId, id });
  if (ticket === null) throw new ServiceError("NOT_FOUND", "Ticket not found.");
  const order = await orderService.byId({ organizationId, id: ticket.orderId });
  const { lines, modifiers } = await orderService.linesFor({
    organizationId,
    orderIds: [ticket.orderId],
  });
  const stations = await kitchenService.stationsFor({
    organizationId,
    branchId: ticket.branchId,
  });
  return toTicketDto({
    ticket,
    order: order ?? undefined,
    stations,
    lines: toTicketLines(lines, modifiers),
    now: Date.now(),
  });
}

function targetOf(action: ManageInput["action"]): KitchenStatus | null {
  switch (action) {
    case "accept":
      return "accepted";
    case "start":
      return "preparing";
    case "ready":
      return "ready";
    default:
      /** set_priority and route do not move the ticket along; they change how it is worked. */
      return null;
  }
}

export const kitchenHandlers = [
  handlerFor("kitchenTicket", "read", async ({ ctx, input }) => {
    const statuses = statusesFor(input.bucket);
    const page = await kitchenService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      branchId: input.branchId,
      ...(input.stationId === undefined ? {} : { stationId: input.stationId }),
      ...(input.status === undefined
        ? { ...(statuses === undefined ? {} : { statuses }) }
        : { statuses: [input.status] }),
    });

    const orderIds = [...new Set(page.items.map((row) => row.orderId))];
    const { lines, modifiers } = await orderService.linesFor({
      organizationId: ctx.orgId,
      orderIds,
    });
    const stations = await kitchenService.stationsFor({
      organizationId: ctx.orgId,
      branchId: input.branchId,
    });
    const orders = await Promise.all(
      orderIds.map((id) => orderService.byId({ organizationId: ctx.orgId, id })),
    );
    const now = Date.now();

    const items = page.items.map((ticket) =>
      toTicketDto({
        ticket,
        order: orders.find((row) => row?.id === ticket.orderId) ?? undefined,
        stations,
        lines: toTicketLines(
          lines.filter((line) => line.orderId === ticket.orderId),
          modifiers,
        ),
        now,
      }),
    );

    return {
      items: input.bucket === "delayed" ? items.filter((item) => item.isDelayed) : items,
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("kitchenTicket", "manage", async ({ ctx, input }) => {
    const existing = await kitchenService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Ticket not found.");

    if (input.action === "set_priority") {
      await kitchenService.update({
        organizationId: ctx.orgId,
        id: input.id,
        patch: { priority: input.priority },
      });
      return loadTicket(ctx.orgId, input.id);
    }

    if (input.action === "route") {
      await kitchenService.update({
        organizationId: ctx.orgId,
        id: input.id,
        patch: { stationId: input.stationId },
      });
      return loadTicket(ctx.orgId, input.id);
    }

    const to = targetOf(input.action);
    if (to === null) throw new ServiceError("INVALID_INPUT", "Unknown ticket action.");
    assertTransition(KITCHEN_TRANSITIONS, asKitchenStatus(existing.status), to, "ticket");

    await kitchenService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        status: to,
        ...(to === "accepted" ? { acceptedAt: new Date() } : {}),
        ...(to === "ready" ? { readyAt: new Date() } : {}),
      },
    });
    return loadTicket(ctx.orgId, input.id);
  }),
];
