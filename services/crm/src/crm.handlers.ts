/**
 * SOT: crm-handlers, customer-handlers, review-handlers, favorite-handlers
 * WHAT   Business rules for diners, what they thought, and what they saved.
 * WHY    Two rules carry this file. A diner is matched on phone rather than created twice,
 *        because the same person scanning two tables is one relationship. And a review's
 *        ratings are written once and never edited - only the restaurant's reply can change.
 * WHERE  services/crm/src/crm.service.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import { customerService, favoriteService, loyaltyService, reviewService } from "./crm.service";
import type { CustomerRow, FavoriteRow, ReviewRow } from "./schema";

const SEGMENTS = ["new", "returning", "vip", "inactive", "high_value"] as const;
type Segment = (typeof SEGMENTS)[number];

const REVIEW_STATUSES = ["pending", "published", "flagged", "removed"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const asReviewStatus = (value: string): ReviewStatus =>
  REVIEW_STATUSES.find((candidate) => candidate === value) ?? "published";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Segments are derived, never stored. A stored segment is a segment that is wrong the moment
 * somebody orders again, and every screen that reads it would be wrong with it.
 */
function segmentOf(row: CustomerRow, now: number): Segment {
  const sinceVisit =
    row.lastVisitAt === null ? Number.POSITIVE_INFINITY : now - row.lastVisitAt.getTime();
  if (sinceVisit > 90 * DAY_MS) return "inactive";
  if (row.totalOrders >= 20 && row.totalSpendPaise >= 5_000_000) return "vip";
  if (row.totalSpendPaise >= 2_000_000) return "high_value";
  if (row.totalOrders <= 1) return "new";
  return "returning";
}

function readFavouriteItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const fields: ReadonlyMap<string, unknown> =
      typeof entry === "object" && entry !== null ? new Map(Object.entries(entry)) : new Map();
    const itemId = fields.get("itemId");
    const name = fields.get("name");
    const count = fields.get("count");
    return typeof itemId === "string" && typeof name === "string" && typeof count === "number"
      ? [{ itemId, name, count }]
      : [];
  });
}

function toCustomerDto(row: CustomerRow, loyaltyPoints: number, now: number) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    totalOrders: row.totalOrders,
    totalSpendPaise: row.totalSpendPaise,
    averageOrderPaise:
      row.totalOrders === 0 ? 0 : Math.round(row.totalSpendPaise / row.totalOrders),
    lastVisitAt: row.lastVisitAt,
    segment: segmentOf(row, now),
    favouriteItems: readFavouriteItems(row.favouriteItems),
    reviewCount: row.reviewCount,
    loyaltyPoints,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

const toReviewDto = (row: ReviewRow) => ({
  id: row.id,
  restaurantId: row.restaurantId,
  branchId: row.branchId,
  orderId: row.orderId,
  customerId: row.customerId,
  authorName: row.authorName,
  food: row.food,
  service: row.service,
  ambience: row.ambience,
  value: row.value,
  overall: Number(row.overall),
  body: row.body,
  status: asReviewStatus(row.status),
  reply: row.reply,
  repliedAt: row.repliedAt,
  flagReason: row.flagReason,
  createdAt: row.createdAt,
});

const toFavoriteDto = (row: FavoriteRow) => ({
  id: row.id,
  kind: row.kind === "item" ? ("item" as const) : ("restaurant" as const),
  targetId: row.targetId,
  name: row.name,
  imageUrl: row.imageUrl,
  createdAt: row.createdAt,
});

export const customerHandlers = [
  handlerFor("customer", "read", async ({ ctx, input }) => {
    const page = await customerService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      sort: input.sort,
      ...set(input.id, "id"),
      ...set(input.search, "search"),
    });
    const now = Date.now();
    const items = await Promise.all(
      page.items.map(async (row) =>
        toCustomerDto(
          row,
          await loyaltyService.balance({ organizationId: ctx.orgId, customerId: row.id }),
          now,
        ),
      ),
    );
    return {
      items:
        input.segment === undefined ? items : items.filter((row) => row.segment === input.segment),
      nextCursor: page.nextCursor,
    };
  }),

  /**
   * A guest naming themselves at checkout. Matched on phone, because scanning a second table
   * next month is the same person and a restaurant that sees two of them learns nothing.
   */
  handlerFor("customer", "create", async ({ ctx, input }) => {
    const existing =
      input.phone === undefined
        ? null
        : await customerService.byPhone({ organizationId: ctx.orgId, phone: input.phone });

    const row =
      existing === null
        ? await customerService.create({
            id: crypto.randomUUID(),
            organizationId: ctx.orgId,
            name: input.name,
            phone: input.phone ?? null,
            email: input.email ?? null,
          })
        : await customerService.update({
            organizationId: ctx.orgId,
            id: existing.id,
            patch: { name: input.name, ...set(input.email, "email") },
          });

    if (row === null) throw new ServiceError("INTERNAL", "The customer was not saved.");
    return toCustomerDto(row, 0, Date.now());
  }),

  handlerFor("customer", "update", async ({ ctx, input }) => {
    const updated = await customerService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.phone, "phone"),
        ...set(input.email, "email"),
        ...set(input.notes, "notes"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Customer not found.");
    return toCustomerDto(
      updated,
      await loyaltyService.balance({ organizationId: ctx.orgId, customerId: updated.id }),
      Date.now(),
    );
  }),

  handlerFor("customer", "delete", async ({ ctx, input }) => {
    const removed = await customerService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Customer not found.");
    return removed;
  }),
];

export const reviewHandlers = [
  handlerFor("review", "read", async ({ ctx, input }) => {
    const page = await reviewService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.id, "id"),
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.branchId, "branchId"),
      ...set(input.minOverall, "minOverall"),
      /** A guest only ever sees what has been published. */
      ...(ctx.role === "guest" ? { status: "published" } : set(input.status, "status")),
    });
    const items = page.items.map(toReviewDto);
    return {
      items: input.withReplyOnly ? items.filter((row) => row.reply !== null) : items,
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("review", "create", async ({ ctx, input }) => {
    if (input.orderId != null) {
      const already = await reviewService.byOrder({
        organizationId: ctx.orgId,
        orderId: input.orderId,
      });
      if (already !== null) {
        throw new ServiceError("CONFLICT", "This order has already been reviewed. Thank you!");
      }
    }

    /** Computed once, here, so no screen rounds the average differently from another. */
    const overall = (input.food + input.service + input.ambience + input.value) / 4;

    const created = await reviewService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      orderId: input.orderId ?? null,
      authorName: input.authorName ?? null,
      food: input.food,
      service: input.service,
      ambience: input.ambience,
      value: input.value,
      overall: overall.toFixed(2),
      body: input.body ?? null,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The review was not saved.");
    if (created.customerId !== null) {
      await loyaltyService.bumpReviewCount({
        organizationId: ctx.orgId,
        customerId: created.customerId,
      });
    }
    return toReviewDto(created);
  }),

  /** The reply, and only the reply. A restaurant does not get to edit what somebody said. */
  handlerFor("review", "update", async ({ ctx, input }) => {
    const updated = await reviewService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { reply: input.reply, repliedAt: new Date() },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Review not found.");
    return toReviewDto(updated);
  }),

  handlerFor("review", "delete", async ({ ctx, input }) => {
    const removed = await reviewService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Review not found.");
    return removed;
  }),

  /**
   * Flagging hides a review from guests and puts it in front of platform moderation. A
   * restaurant cannot remove criticism on its own - that is the whole point of the queue.
   */
  handlerFor("review", "manage", async ({ ctx, input }) => {
    const updated = await reviewService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch:
        input.action === "flag"
          ? { status: "flagged", flagReason: input.reason }
          : { status: "published", flagReason: null },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Review not found.");
    return toReviewDto(updated);
  }),
];

export const favoriteHandlers = [
  handlerFor("favorite", "read", async ({ ctx, input }) => {
    const page = await favoriteService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      owner: ctx.role === "guest" ? ctx.userId : null,
      ...set(input.kind, "kind"),
    });
    return { items: page.items.map(toFavoriteDto), nextCursor: page.nextCursor };
  }),

  handlerFor("favorite", "create", async ({ ctx, input }) => {
    const created = await favoriteService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      sessionId: ctx.role === "guest" ? ctx.userId : null,
      kind: input.kind,
      targetId: input.targetId,
      name: "",
    });
    if (created === null) throw new ServiceError("INTERNAL", "The favourite was not saved.");
    return toFavoriteDto(created);
  }),

  handlerFor("favorite", "delete", async ({ ctx, input }) => {
    const removed = await favoriteService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Favourite not found.");
    return removed;
  }),
];
