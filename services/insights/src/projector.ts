/**
 * SOT: insights-projector, read-model, evt-consumer, order-facts, request-facts,
 *      name-denormalisation, platform-dimensions
 * WHAT   Keeps this service's read models in step with the rest of the platform.
 * WHY    Insights owns no orders and no requests, and may not read the tables that do. It
 *        learns that something changed from the event stream, then asks the owning service
 *        for that one row over the bus. That is the whole reason a reporting surface can
 *        exist without a cross-service join.
 * HOW    Every event carries the id of what changed, so this reads exactly one row rather than
 *        re-syncing an organisation. Every write is an upsert, which is what makes a
 *        redelivered event harmless - at-least-once delivery is a promise, not a warning.
 * WHERE  packages/core/src/service.ts, services/insights/src/insights.service.ts
 */
import "server-only";

import type { EventPayload, RequestMeta } from "@foodos/contracts";
import { type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import { factService } from "./insights.service";

/**
 * A context for reading on the changed organisation's behalf. Its org comes from the signed
 * event, never from anything the consumer chose, and its permission set is checked by
 * serviceCall before anything is signed.
 */
function contextFrom(meta: RequestMeta): ServiceContext {
  return {
    requestId: crypto.randomUUID(),
    orgId: meta.orgId,
    userId: "system:insights",
    role: "owner",
    /**
     * Empty on purpose, and stated rather than left off. This context runs as `owner`, which
     * no station gates, so an empty roster narrows nothing here - and `serviceCall` copies
     * whatever is here into the downstream envelope, so writing it down is what stops a
     * later reader wondering whether the omission meant something.
     */
    stations: [],
    plan: meta.plan,
    /**
     * Ten seconds rather than five: a projection is now up to three downstream calls - the
     * row that changed, plus the organisation's and the restaurant's names when they have
     * gone stale - and `serviceCall` only ever shrinks what is left of this.
     */
    deadlineAt: Date.now() + 10_000,
  };
}

/**
 * How long a name is trusted before it is asked for again.
 *
 * Every audited fact in the platform passes through this consumer, so refreshing a name per
 * event would put two rpcs on the bus for every order, every request and every menu edit in
 * every tenant. Names change about as often as a restaurant is renamed, and the console says
 * out loud that what it shows is as fresh as the last projection.
 */
const NAME_TTL_MS = 6 * 60 * 60 * 1000;

function stale(seenAt: Date | null): boolean {
  return seenAt === null || Date.now() - seenAt.getTime() > NAME_TTL_MS;
}

/**
 * The names the platform console shows, denormalised as the facts arrive.
 *
 * The alternative was a `serviceCall` per row at read time, and it does not work: an
 * envelope signed downstream carries the CALLER's organisation, and the caller of the
 * console is the platform's own organisation - so identity would answer for that
 * organisation rather than for the tenant on the row. Here the organisation is the one the
 * signed event named, which is the only context in this service that is genuinely the
 * tenant's. Denormalising is therefore not a performance choice; it is the only shape that
 * respects the tenancy boundary at all.
 *
 * Best effort on purpose. A name that could not be fetched must not cost the order fact
 * beside it: the console renders an id where a name is missing and says so, which is a
 * smaller harm than a report table that stops advancing because identity was restarting.
 */
async function rememberOrganization(ctx: ServiceContext): Promise<void> {
  if (!stale(await factService.organizationDimSeenAt(ctx.orgId))) return;
  try {
    const organization = await serviceCall({
      ctx,
      resource: "organization",
      operation: "read",
      input: {},
      secret: env.envelopeSecret(),
    });
    await factService.upsertOrganizationDim({
      organizationId: ctx.orgId,
      name: organization.name,
      /** From the envelope that carried the event. No billing read, and never a guess. */
      plan: ctx.plan,
    });
  } catch (error) {
    console.error(`[insights] could not name organisation ${ctx.orgId}`, error);
  }
}

async function rememberRestaurant(ctx: ServiceContext, restaurantId: string): Promise<void> {
  if (!stale(await factService.restaurantDimSeenAt(restaurantId))) return;
  try {
    const found = await serviceCall({
      ctx,
      resource: "restaurant",
      operation: "read",
      input: { id: restaurantId, limit: 1, cursor: null },
      secret: env.envelopeSecret(),
    });
    const restaurant = found.items[0];
    if (restaurant === undefined) return;
    await factService.upsertRestaurantDim({
      restaurantId: restaurant.id,
      organizationId: ctx.orgId,
      name: restaurant.name,
      isLive: restaurant.isLive,
      branchCount: restaurant.branchCount,
      openedAt: restaurant.createdAt,
    });
  } catch (error) {
    console.error(`[insights] could not name restaurant ${restaurantId}`, error);
  }
}

async function syncOrder(ctx: ServiceContext, orderId: string) {
  const found = await serviceCall({
    ctx,
    resource: "order",
    operation: "read",
    input: { id: orderId, limit: 1, cursor: null },
    secret: env.envelopeSecret(),
  });
  const order = found.items[0];
  if (order === undefined) return;

  /**
   * Item lines and combo CHILDREN, because the menu report is about dishes and a combo parent
   * is a price. The child's share of the money is zero by design, so revenue is attributed to
   * the parent line and quantities to the dishes - which is what "best selling" has to mean.
   */
  const lines = order.lines.flatMap((line) =>
    line.kind === "item"
      ? [
          {
            itemId: line.itemId,
            name: line.nameSnapshot,
            quantity: line.quantity,
            revenuePaise: line.lineTotalPaise,
            categoryId: null,
          },
        ]
      : line.children.map((child) => ({
          itemId: child.itemId,
          name: child.nameSnapshot,
          quantity: child.quantity,
          revenuePaise: 0,
          categoryId: null,
        })),
  );

  await factService.upsertOrder({
    id: crypto.randomUUID(),
    organizationId: ctx.orgId,
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    placeId: order.placeId,
    customerId: order.customerId,
    orderType: order.orderType,
    source: order.source,
    status: order.status,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    lines,
    placedAt: order.placedAt,
  });

  await rememberRestaurant(ctx, order.restaurantId);
}

async function syncRequest(ctx: ServiceContext, requestId: string) {
  const found = await serviceCall({
    ctx,
    resource: "serviceRequest",
    operation: "read",
    input: { id: requestId, limit: 1, cursor: null, bucket: "all", mineOnly: false },
    secret: env.envelopeSecret(),
  });
  const request = found.items[0];
  if (request === undefined) return;

  await factService.upsertService({
    id: crypto.randomUUID(),
    organizationId: ctx.orgId,
    kind: "request",
    entityId: request.id,
    branchId: request.branchId,
    referenceId: request.requestTypeId,
    label: request.requestTypeName,
    numericValue: request.responseSeconds === null ? null : String(request.responseSeconds),
    secondsValue: request.resolutionSeconds,
    /** The flag is the SLA breach, so compliance is a count rather than a recomputation. */
    flag: request.slaBreached,
    occurredAt: request.submittedAt,
  });
}

/**
 * One handler for every audited fact in the platform. It is deliberately a switch on the
 * resource rather than several consumers: one durable consumer means one place where "we
 * heard about it but did not record it" can happen, and one place to look when it does.
 */
export async function project(meta: RequestMeta, payload: EventPayload): Promise<void> {
  const entityId = payload.entityId;
  if (entityId === null) return;
  const ctx = contextFrom(meta);

  try {
    /**
     * Before the switch, so any audited fact that names a row teaches this service who the
     * organisation is - not only the two resources it keeps read models for. An organisation
     * that has edited a menu today is named on the console tomorrow, without waiting for an
     * order to arrive first.
     */
    await rememberOrganization(ctx);

    switch (meta.resource) {
      case "order":
        await syncOrder(ctx, entityId);
        return;
      case "serviceRequest":
        await syncRequest(ctx, entityId);
        return;
      default:
        return;
    }
  } catch (error) {
    /**
     * Rethrown so JetStream redelivers. A read model that silently misses an update is worse
     * than one that is briefly behind, and every write above is an upsert, so trying again is
     * free.
     */
    console.error(`[insights] could not project ${meta.resource} ${entityId}`, error);
    throw error;
  }
}
