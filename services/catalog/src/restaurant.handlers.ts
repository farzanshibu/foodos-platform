/**
 * SOT: restaurant-handlers, branch-handlers, go-live-handler, opening-hours-handler
 * WHAT   Business rules for the restaurant and its branches. Nothing else.
 * WHY    Auth, plan limits, rate limits, audit and metering already happened at the gateway
 *        and are enforced by defineService. What is left is what the product means by
 *        "take a restaurant live", which is the only part worth thinking about.
 * HOW    handlerFor infers input and output from the contract - never annotate them.
 *        ctx.orgId comes from the signed envelope; nothing here is scoped to anything else.
 * WHERE  services/catalog/src/restaurant.service.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";

import { branchService, restaurantService } from "./restaurant.service";
import type { BranchHoursRow, BranchRow, RestaurantRow } from "./schema";

const SERVICE_MODES = ["dine_in", "takeaway", "pickup", "delivery"] as const;

type ServiceMode = (typeof SERVICE_MODES)[number];

/**
 * The column is plain `text`, because a Postgres enum is a migration every time the product
 * learns a new word. Narrowing happens here, on the way out, and an unrecognised value is
 * dropped rather than asserted - the contract is what the browser trusts.
 */
const asServiceModes = (values: readonly string[]): ServiceMode[] =>
  values.flatMap((value) => SERVICE_MODES.filter((candidate) => candidate === value));

function toRestaurantDto(row: RestaurantRow, branchCount: number) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    serviceModes: asServiceModes(row.serviceModes),
    isLive: row.isLive,
    wentLiveAt: row.wentLiveAt,
    branchCount,
    createdAt: row.createdAt,
  };
}

/**
 * Open now, in the branch's own timezone rather than the caller's. `closesAt` earlier than
 * `opensAt` means the branch trades past midnight, so the window is checked against
 * yesterday's row as well - a bar that shuts at 2am is open at 1am, on yesterday's shift.
 */
function isOpenNow(hours: readonly BranchHoursRow[], timezone: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = days.indexOf(lookup("weekday"));
  if (today < 0) return false;
  const minutes = Number(lookup("hour")) * 60 + Number(lookup("minute"));

  const toMinutes = (value: string): number => {
    const [hour = "0", minute = "0"] = value.split(":");
    return Number(hour) * 60 + Number(minute);
  };

  for (const offset of [0, -1]) {
    const day = (today + offset + 7) % 7;
    const row = hours.find((candidate) => candidate.dayOfWeek === day);
    if (row === undefined || row.isClosed) continue;
    const opens = toMinutes(row.opensAt);
    const closes = toMinutes(row.closesAt);
    const overnight = closes <= opens;
    if (offset === 0 && !overnight && minutes >= opens && minutes < closes) return true;
    if (offset === 0 && overnight && minutes >= opens) return true;
    if (offset === -1 && overnight && minutes < closes) return true;
  }
  return false;
}

function toBranchDto(row: BranchRow, hours: readonly BranchHoursRow[]) {
  const mine = hours.filter((entry) => entry.branchId === row.id);
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    timezone: row.timezone,
    isActive: row.isActive,
    isLive: row.isLive,
    serviceModes: asServiceModes(row.serviceModes),
    hours: mine.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      opensAt: entry.opensAt.slice(0, 5),
      closesAt: entry.closesAt.slice(0, 5),
      isClosed: entry.isClosed,
    })),
    isOpenNow: isOpenNow(mine, row.timezone),
    createdAt: row.createdAt,
  };
}

/** `exactOptionalPropertyTypes`: absent and present-but-undefined are different states. */
const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

export const restaurantHandlers = [
  handlerFor("restaurant", "read", async ({ ctx, input }) => {
    const page = await restaurantService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.id, "id"),
      ...set(input.slug, "slug"),
    });
    const items = await Promise.all(
      page.items.map(async (row) =>
        toRestaurantDto(
          row,
          await restaurantService.branchCount({
            organizationId: ctx.orgId,
            restaurantId: row.id,
          }),
        ),
      ),
    );
    return { items, nextCursor: page.nextCursor };
  }),

  handlerFor("restaurant", "create", async ({ ctx, input }) => {
    const clash = await restaurantService.bySlug({ organizationId: ctx.orgId, slug: input.slug });
    if (clash !== null) {
      throw new ServiceError("CONFLICT", "That slug is already taken in this organisation.");
    }
    const created = await restaurantService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      createdById: ctx.userId,
      name: input.name,
      slug: input.slug,
      logoUrl: input.logoUrl ?? null,
      serviceModes: input.serviceModes ?? ["dine_in"],
    });
    if (created === null) throw new ServiceError("INTERNAL", "The restaurant was not created.");
    return toRestaurantDto(created, 0);
  }),

  handlerFor("restaurant", "update", async ({ ctx, input }) => {
    const updated = await restaurantService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.logoUrl, "logoUrl"),
        ...set(input.serviceModes, "serviceModes"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Restaurant not found.");
    return toRestaurantDto(
      updated,
      await restaurantService.branchCount({ organizationId: ctx.orgId, restaurantId: updated.id }),
    );
  }),

  handlerFor("restaurant", "delete", async ({ ctx, input }) => {
    const removed = await restaurantService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Restaurant not found.");
    return removed;
  }),

  /**
   * Going live is what starts service, so it refuses a restaurant with no branch: there is
   * nowhere for a guest to be sitting, no table to scan, and nothing for an order to belong
   * to. Taking it offline clears the timestamp rather than keeping it, because "went live at"
   * describes the current spell of service, not the first one ever.
   */
  handlerFor("restaurant", "manage", async ({ ctx, input }) => {
    const live = input.action === "go_live";
    if (live) {
      const branches = await restaurantService.branchCount({
        organizationId: ctx.orgId,
        restaurantId: input.id,
      });
      if (branches === 0) {
        throw new ServiceError("CONFLICT", "Add a branch before taking this restaurant live.");
      }
    }
    const updated = await restaurantService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { isLive: live, wentLiveAt: live ? new Date() : null },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Restaurant not found.");
    return toRestaurantDto(
      updated,
      await restaurantService.branchCount({ organizationId: ctx.orgId, restaurantId: updated.id }),
    );
  }),
];

export const branchHandlers = [
  handlerFor("branch", "read", async ({ ctx, input }) => {
    const page = await branchService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.restaurantId, "restaurantId"),
      ...set(input.id, "id"),
    });
    const hours = await branchService.hoursFor({
      organizationId: ctx.orgId,
      branchIds: page.items.map((row) => row.id),
    });
    return { items: page.items.map((row) => toBranchDto(row, hours)), nextCursor: page.nextCursor };
  }),

  handlerFor("branch", "create", async ({ ctx, input }) => {
    const parent = await restaurantService.byId({
      organizationId: ctx.orgId,
      id: input.restaurantId,
    });
    if (parent === null) throw new ServiceError("NOT_FOUND", "Restaurant not found.");
    const created = await branchService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      restaurantId: input.restaurantId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      ...set(input.country, "country"),
      latitude:
        input.latitude === undefined || input.latitude === null ? null : String(input.latitude),
      longitude:
        input.longitude === undefined || input.longitude === null ? null : String(input.longitude),
      ...set(input.timezone, "timezone"),
      serviceModes: input.serviceModes ?? parent.serviceModes,
      ...set(input.isActive, "isActive"),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The branch was not created.");
    return toBranchDto(created, []);
  }),

  handlerFor("branch", "update", async ({ ctx, input }) => {
    const updated = await branchService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.phone, "phone"),
        ...set(input.email, "email"),
        ...set(input.addressLine1, "addressLine1"),
        ...set(input.addressLine2, "addressLine2"),
        ...set(input.city, "city"),
        ...set(input.state, "state"),
        ...set(input.pincode, "pincode"),
        ...set(input.country, "country"),
        ...set(input.timezone, "timezone"),
        ...set(input.serviceModes, "serviceModes"),
        ...set(input.isActive, "isActive"),
        ...(input.latitude === undefined
          ? {}
          : { latitude: input.latitude === null ? null : String(input.latitude) }),
        ...(input.longitude === undefined
          ? {}
          : { longitude: input.longitude === null ? null : String(input.longitude) }),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Branch not found.");
    const hours = await branchService.hoursFor({
      organizationId: ctx.orgId,
      branchIds: [updated.id],
    });
    return toBranchDto(updated, hours);
  }),

  handlerFor("branch", "delete", async ({ ctx, input }) => {
    const removed = await branchService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Branch not found.");
    return removed;
  }),

  handlerFor("branch", "manage", async ({ ctx, input }) => {
    const existing = await branchService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Branch not found.");

    const days = new Set(input.hours.map((entry) => entry.dayOfWeek));
    if (days.size !== 7) {
      throw new ServiceError("INVALID_INPUT", "Give each of the seven days exactly once.");
    }

    await branchService.replaceHours({
      organizationId: ctx.orgId,
      branchId: input.id,
      rows: input.hours.map((entry) => ({
        id: crypto.randomUUID(),
        organizationId: ctx.orgId,
        branchId: input.id,
        dayOfWeek: entry.dayOfWeek,
        opensAt: entry.opensAt,
        closesAt: entry.closesAt,
        isClosed: entry.isClosed,
      })),
    });

    const updated =
      input.isLive === undefined
        ? existing
        : ((await branchService.update({
            organizationId: ctx.orgId,
            id: input.id,
            patch: { isLive: input.isLive },
          })) ?? existing);

    const hours = await branchService.hoursFor({
      organizationId: ctx.orgId,
      branchIds: [updated.id],
    });
    return toBranchDto(updated, hours);
  }),
];
