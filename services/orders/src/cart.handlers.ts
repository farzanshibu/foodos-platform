/**
 * SOT: cart-handlers, cart-pricing, guest-cart-scope
 * WHAT   Business rules for a guest's basket, before it becomes an order.
 * WHY    A cart stores what somebody chose, never what it costs. Prices are fetched from the
 *        catalogue every time it is read, so a menu change between adding a dish and paying
 *        for it is visible while the basket is still a basket - which is the only moment
 *        anyone can do anything about it.
 * HOW    A basket belongs to a PLACE when the scan named one, so everybody who scans the code
 *        on table twelve lands in the same basket and sees each other's dishes. A walk-in who
 *        has not been seated has no place, so their basket stays scoped to their own session
 *        until staff allocate one. Either way the id in the input is checked before anything
 *        is read back - a guest can only ever reach a basket they are actually in.
 * WHERE  services/orders/src/order.service.ts, services/catalog/src/quote.handlers.ts
 */
import "server-only";

import { CART_STATUSES, type InputOf, isCartOpen, ServiceError } from "@foodos/contracts";
import { handlerFor, type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import { cartService } from "./order.service";
import type { CartRow } from "./schema";
import { applyLineChange, joinPlaceCart, membersOf, readEntries } from "./table-party";

type CartLines = InputOf<"quote", "read">["lines"];

const ORDER_TYPES = ["dine_in", "takeaway", "pickup", "delivery"] as const;
type OrderType = (typeof ORDER_TYPES)[number];

const asOrderType = (value: string): OrderType =>
  ORDER_TYPES.find((candidate) => candidate === value) ?? "dine_in";

function priced(ctx: ServiceContext, row: CartRow) {
  const lines: CartLines = readEntries(row.lines).map((entry) => entry.line);
  if (lines.length === 0) {
    return Promise.resolve({
      lines: [],
      subtotalPaise: 0,
      taxPaise: 0,
      discountPaise: 0,
      serviceChargePaise: 0,
      packagingPaise: 0,
      totalPaise: 0,
      currency: "INR",
    });
  }
  return serviceCall({
    ctx,
    resource: "quote",
    operation: "read",
    input: {
      branchId: row.branchId,
      lines,
      orderType: asOrderType(row.orderType),
      ...(row.couponCode === null ? {} : { couponCode: row.couponCode }),
    },
    secret: env.envelopeSecret(),
  });
}

type CartStatus = (typeof CART_STATUSES)[number];

const asCartStatus = (value: string): CartStatus =>
  CART_STATUSES.find((candidate) => candidate === value) ?? "active";

async function toCartDto(ctx: ServiceContext, row: CartRow) {
  const entries = readEntries(row.lines);
  const [pricedCart, seated] = await Promise.all([priced(ctx, row), membersOf(row.id)]);

  /**
   * Attribution is paired with the priced lines BY POSITION, which is sound because this
   * service controls both the order it sent and the order it got back. If the two ever
   * disagree in length the pairing is dropped entirely rather than guessed at - putting
   * somebody else's dish against your name is worse than showing no name.
   */
  const aligned = pricedCart.lines.length === entries.length;

  return {
    id: row.id,
    branchId: row.branchId,
    placeId: row.placeId,
    placeLabel: row.placeLabel,
    placeKind:
      row.placeKind === "seat"
        ? ("seat" as const)
        : row.placeKind === "table"
          ? ("table" as const)
          : null,
    status: asCartStatus(row.status),
    guestName: row.guestName,
    orderType: asOrderType(row.orderType),
    couponCode: row.couponCode,
    priced: pricedCart,
    /** A basket the place owns is shared; one a single session owns is not. */
    isShared: row.placeId !== null && row.sessionId === null,
    members: seated.map((member) => ({
      sessionId: member.sessionId,
      name: member.name,
      isYou: ctx.role === "guest" && member.sessionId === ctx.userId,
      joinedAt: member.joinedAt,
    })),
    attribution: aligned
      ? entries.map((entry) => ({
          lineId: entry.lineId,
          addedByName: entry.addedByName,
          isMine: ctx.role === "guest" && entry.addedBySessionId === ctx.userId,
        }))
      : [],
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * Where this guest is sitting, from their signed QR session - never from anything they sent.
 * Staff have no seat, so they get nothing and fall through to the walk-in paths.
 */
async function seatOf(ctx: ServiceContext): Promise<{ branchId: string; placeId: string | null }> {
  if (ctx.role !== "guest") return { branchId: "", placeId: null };
  const session = await serviceCall({
    ctx,
    resource: "qrSession",
    operation: "read",
    input: {},
    secret: env.envelopeSecret(),
  });
  return { branchId: session.context.branchId ?? "", placeId: session.context.placeId };
}

/**
 * The label of the place staff just allocated, so the guest is told "Table 12" rather than an
 * id. Best-effort: the allocation itself is the thing that matters, and a floor service having
 * a bad second must not stop somebody being seated.
 */
async function placeLabelOf(ctx: ServiceContext, placeId: string) {
  try {
    const found = await serviceCall({
      ctx,
      resource: "place",
      operation: "read",
      input: {
        id: placeId,
        limit: 1,
        cursor: null,
        parameterFilters: [],
        customerVisibleParametersOnly: true,
      },
      secret: env.envelopeSecret(),
    });
    const place = found.items[0];
    return place === undefined ? null : { label: place.label, kind: place.kind };
  } catch (error) {
    console.warn("[orders] could not read the place while allocating a basket", error);
    return null;
  }
}

/**
 * A basket this caller may actually touch.
 *
 * Two ways in, and no third: it is the basket their own session started, or it is a shared
 * basket they are a member of. Membership is the check that matters once a table shares one -
 * being able to name an id is not permission, and scanning the code is what earns it.
 *
 * A refusal is always NOT_FOUND rather than PERMISSION_DENIED, so a guest probing ids cannot
 * tell a basket that exists from one that does not.
 */
export async function reachableCart(ctx: ServiceContext, id: string) {
  const row = await cartService.byId({ organizationId: ctx.orgId, id });
  if (row === null) throw new ServiceError("NOT_FOUND", "Cart not found.");
  if (ctx.role !== "guest") return row;
  if (row.sessionId === ctx.userId) return row;

  const seated = await membersOf(row.id);
  if (seated.some((member) => member.sessionId === ctx.userId)) return row;
  throw new ServiceError("NOT_FOUND", "Cart not found.");
}

/**
 * The same basket, and it has to still be open.
 *
 * Reading a closed basket is allowed - a phone that was holding it when the table was cleared
 * should be told what happened rather than shown an error - but nothing may CHANGE one.
 * Without this a basket could be closed and still added to, which is not a basket that closed.
 */
export async function openCart(ctx: ServiceContext, id: string) {
  const row = await reachableCart(ctx, id);
  const status = asCartStatus(row.status);
  if (!isCartOpen(status)) {
    throw new ServiceError(
      "INVALID_INPUT",
      status === "converted"
        ? "This basket has already been ordered. Start a new one."
        : "This table was cleared, so its basket is closed. Scan again to start a new one.",
    );
  }
  return row;
}

export const cartHandlers = [
  handlerFor("cart", "read", async ({ ctx, input }) => {
    /**
     * A guest is always narrowed to one basket, whatever they asked for: the one at the place
     * they scanned if they are seated, or their own if they are not. Staff get the queue -
     * baskets sent from the door that are still waiting for somewhere to sit.
     *
     * Reading never CREATES a shared basket, because a read that writes is not a read. Joining
     * is `cart.create`, which is a mutation and announces itself to the other phones.
     */
    if (ctx.role === "guest") {
      if (input.id !== undefined) {
        return {
          items: [await toCartDto(ctx, await reachableCart(ctx, input.id))],
          nextCursor: null,
        };
      }
      const seat = await seatOf(ctx);
      const row =
        seat.placeId === null
          ? await cartService.forSession({ organizationId: ctx.orgId, sessionId: ctx.userId })
          : await cartService.forPlace({ organizationId: ctx.orgId, placeId: seat.placeId });
      return {
        items: row === null ? [] : [await toCartDto(ctx, row)],
        nextCursor: null,
      };
    }

    const page = await cartService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    return {
      items: await Promise.all(page.items.map((row) => toCartDto(ctx, row))),
      nextCursor: page.nextCursor,
    };
  }),

  /**
   * Start a basket, or sit down at the one already open at this place.
   *
   * Idempotent for a seated guest: reloading, backgrounding the tab, or retrying a request
   * whose answer never arrived all land in the basket they were already in, under the name
   * they already had. That is why joining is `create` rather than a side effect of `read` -
   * it is a mutation, it is announced, and the other phones at the table see the new member
   * without asking.
   */
  handlerFor("cart", "create", async ({ ctx, input }) => {
    const seat = ctx.role === "guest" ? await seatOf(ctx) : { branchId: "", placeId: null };

    if (seat.placeId !== null) {
      const joined = await joinPlaceCart({
        organizationId: ctx.orgId,
        branchId: seat.branchId === "" ? input.branchId : seat.branchId,
        placeId: seat.placeId,
        sessionId: ctx.userId,
      });
      /**
       * Whatever this phone had chosen before it joined comes with it, attributed to them.
       * Dropping it would mean somebody who picked three dishes on the way to the table
       * arrives to an empty basket.
       */
      for (const line of input.lines) {
        await applyLineChange({
          organizationId: ctx.orgId,
          cartId: joined.cartId,
          change: {
            kind: "add",
            entry: {
              lineId: crypto.randomUUID(),
              addedBySessionId: ctx.userId,
              addedByName: joined.name,
              line,
            },
          },
        });
      }
      const row = await cartService.byId({ organizationId: ctx.orgId, id: joined.cartId });
      if (row === null) throw new ServiceError("INTERNAL", "The cart was not created.");
      return toCartDto(ctx, row);
    }

    /** No seat: a walk-in basket, owned by the one phone that made it, as before. */
    const created = await cartService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      branchId: input.branchId,
      placeId: input.placeId ?? null,
      sessionId: ctx.role === "guest" ? ctx.userId : null,
      orderType: input.orderType,
      lines: input.lines.map((line) => ({
        lineId: crypto.randomUUID(),
        addedBySessionId: ctx.role === "guest" ? ctx.userId : null,
        addedByName: null,
        line,
      })),
    });
    if (created === null) throw new ServiceError("INTERNAL", "The cart was not created.");
    return toCartDto(ctx, created);
  }),

  /**
   * One named change at a time.
   *
   * Split into its own functions per action, so each states who may send it. The two halves of
   * the walk-in handshake refuse each other's sender explicitly: `request_place` is a guest
   * saying they are ready, `allocate` is staff seating them, and neither can be reached by
   * sending the other's body.
   */
  handlerFor("cart", "update", async ({ ctx, input }) => {
    const row = await openCart(ctx, input.id);

    switch (input.action) {
      case "add_line":
      case "set_quantity":
      case "remove_line":
        return changeLine(ctx, row.id, input);
      case "set_coupon":
        return patchCart(ctx, row.id, { couponCode: input.couponCode });
      case "set_order_type":
        return patchCart(ctx, row.id, { orderType: input.orderType });
      case "request_place": {
        if (ctx.role !== "guest") {
          throw new ServiceError("PERMISSION_DENIED", "Only a guest can join the queue.");
        }
        return patchCart(ctx, row.id, { status: "awaiting_place" });
      }
      case "allocate": {
        if (ctx.role === "guest") {
          throw new ServiceError("PERMISSION_DENIED", "Only staff can seat a table.");
        }
        const seated = await placeLabelOf(ctx, input.placeId);
        return patchCart(ctx, row.id, {
          placeId: input.placeId,
          status: "allocated",
          ...(seated === null ? {} : { placeLabel: seated.label, placeKind: seated.kind }),
        });
      }
    }
  }),

  /**
   * Staff cleared the table, so whatever it was holding is over.
   *
   * Reached only from the floor service, which calls this the moment a place stops being
   * occupied - see `floorAction` in services/floor. Orders owns `ord_cart` and floor owns
   * `flr_place`, so this is a downstream call over the bus rather than a join: the service
   * that owns the table asks the service that owns the basket, and neither reads the other's
   * rows. The registry names `floor` as the only caller.
   */
  handlerFor("cart", "manage", async ({ ctx, input }) => {
    const closed = await cartService.closeAtPlace({
      organizationId: ctx.orgId,
      placeId: input.placeId,
    });
    /**
     * The newest, which for a table holding exactly one basket - the ordinary case - is that
     * basket. It is returned as `id` so the block announces the close on `notice.cart.<id>`
     * and the phones at that table hear about it. A place somehow holding two open baskets
     * announces only this one; the other's watchers find out on their next poll.
     */
    const [newest] = closed;
    return { id: newest?.id ?? null, closed: closed.length };
  }),

  handlerFor("cart", "delete", async ({ ctx, input }) => {
    await reachableCart(ctx, input.id);
    const removed = await cartService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Cart not found.");
    return removed;
  }),
];

/* ── The update actions ──────────────────────────────────────────────────── */

/** Everything that is not a line edit: one patch, one version bump, one notice. */
async function patchCart(
  ctx: ServiceContext,
  cartId: string,
  patch: Parameters<typeof cartService.update>[0]["patch"],
) {
  const updated = await cartService.update({
    organizationId: ctx.orgId,
    id: cartId,
    patch,
  });
  if (updated === null) throw new ServiceError("NOT_FOUND", "Cart not found.");
  return toCartDto(ctx, updated);
}

/**
 * A line edit, under the row lock that makes two phones adding at once both succeed.
 *
 * Anyone at the table may change any line, which is the rule a real table already runs on -
 * one person orders for everyone, and somebody tidies up before calling the waiter. What
 * keeps that honest is that every line carries who added it, so a change is attributable
 * rather than anonymous.
 */
async function changeLine(
  ctx: ServiceContext,
  cartId: string,
  input:
    | { action: "add_line"; lineId: string; line: CartLines[number] }
    | { action: "set_quantity"; lineId: string; quantity: number }
    | { action: "remove_line"; lineId: string },
) {
  const change =
    input.action === "add_line"
      ? {
          kind: "add" as const,
          entry: {
            lineId: input.lineId,
            addedBySessionId: ctx.role === "guest" ? ctx.userId : null,
            addedByName: ctx.role === "guest" ? await myNameIn(ctx, cartId) : null,
            line: input.line,
          },
        }
      : input.action === "set_quantity"
        ? { kind: "quantity" as const, lineId: input.lineId, quantity: input.quantity }
        : { kind: "remove" as const, lineId: input.lineId };

  const applied = await applyLineChange({ organizationId: ctx.orgId, cartId, change });
  if (!applied) throw new ServiceError("NOT_FOUND", "Cart not found.");

  const row = await cartService.byId({ organizationId: ctx.orgId, id: cartId });
  if (row === null) throw new ServiceError("NOT_FOUND", "Cart not found.");
  return toCartDto(ctx, row);
}

/**
 * The caller's own display name at this table, snapshotted onto the line they are adding.
 * Snapshotted rather than joined at read time so a line still says who chose it after that
 * phone's session has expired and the member row is gone.
 */
async function myNameIn(ctx: ServiceContext, cartId: string): Promise<string | null> {
  const seated = await membersOf(cartId);
  return seated.find((member) => member.sessionId === ctx.userId)?.name ?? null;
}
