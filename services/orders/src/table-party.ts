/**
 * SOT: table-party, shared-cart, cart-member, join-table, line-lock
 * WHAT   The database half of a basket shared by a table: who is sitting at it, and the lock
 *        that lets three phones change it at once without losing anybody's dish.
 * WHY    Adds are commutative and removes are idempotent - see `table-party-rules.ts`, which
 *        holds those rules and can be asserted without a Postgres. What still needs a database
 *        is serialising the read-modify-write, and that is all this file is.
 * WHERE  services/orders/src/table-party-rules.ts, services/orders/src/cart.handlers.ts
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { cart, cartMember } from "./schema";
import { freshMemberName, type LineChange, nextEntries, readEntries } from "./table-party-rules";

export * from "./table-party-rules";

/* ── Joining a table ─────────────────────────────────────────────────────── */

/**
 * Find the open basket for a place, or start one, and put the caller in it.
 *
 * Idempotent by design: a phone that reloads, backgrounds and comes back, or retries a
 * dropped request joins the basket it was already in rather than starting a second one. The
 * insert races cleanly - two people scanning at the same instant both run this, and the
 * `onConflictDoNothing` on the members primary key means the loser of that race is simply
 * already a member.
 *
 * A basket is found by (place, still active). A table that has already sent its order starts
 * a fresh one rather than reopening the last sitting, which is what stops tonight's diners
 * inheriting the dishes of whoever sat there before them.
 */
export function joinPlaceCart(args: {
  organizationId: string;
  branchId: string;
  placeId: string;
  sessionId: string;
}): Promise<{ cartId: string; name: string }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: cart.id })
      .from(cart)
      .where(
        and(
          eq(cart.organizationId, args.organizationId),
          eq(cart.placeId, args.placeId),
          eq(cart.status, "active"),
        ),
      )
      .orderBy(sql`${cart.createdAt} desc`)
      .limit(1);

    const cartId = existing?.id ?? crypto.randomUUID();
    if (existing === undefined) {
      await tx
        .insert(cart)
        .values({
          id: cartId,
          organizationId: args.organizationId,
          branchId: args.branchId,
          placeId: args.placeId,
          /** Null on purpose: a shared basket is owned by the place, not by whoever got there first. */
          sessionId: null,
          lines: [],
        })
        .onConflictDoNothing();
    }

    const seated = await tx
      .select({ sessionId: cartMember.sessionId, name: cartMember.name })
      .from(cartMember)
      .where(eq(cartMember.cartId, cartId));

    const mine = seated.find((member) => member.sessionId === args.sessionId);
    if (mine !== undefined) {
      await tx
        .update(cartMember)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(cartMember.cartId, cartId), eq(cartMember.sessionId, args.sessionId)));
      return { cartId, name: mine.name };
    }

    const name = freshMemberName(seated.map((member) => member.name));
    await tx
      .insert(cartMember)
      .values({
        cartId,
        sessionId: args.sessionId,
        organizationId: args.organizationId,
        name,
      })
      .onConflictDoNothing();
    return { cartId, name };
  });
}

/** Everyone currently holding this basket open, oldest first so the list does not reshuffle. */
export function membersOf(cartId: string) {
  return db
    .select()
    .from(cartMember)
    .where(eq(cartMember.cartId, cartId))
    .orderBy(sql`${cartMember.joinedAt} asc`);
}

/* ── Changing lines ──────────────────────────────────────────────────────── */

/**
 * Apply one change to one basket, under a row lock.
 *
 * The lock is what makes this safe rather than the array rewrite being clever: `FOR UPDATE`
 * serialises the read-modify-write, so two phones adding at the same moment queue for
 * microseconds and both dishes survive. Without it both would read the same array and the
 * second write would drop the first line - which is exactly the bug the whole-list replace
 * this file replaced had.
 *
 * Every change is idempotent on `lineId`, so a client that retries a request it never saw the
 * answer to gets the same basket rather than a duplicate dish.
 */
export function applyLineChange(args: {
  organizationId: string;
  cartId: string;
  change: LineChange;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ lines: cart.lines, version: cart.version })
      .from(cart)
      .where(and(eq(cart.organizationId, args.organizationId), eq(cart.id, args.cartId)))
      .for("update")
      .limit(1);
    if (locked === undefined) return false;

    const entries = readEntries(locked.lines);
    const next = nextEntries(entries, args.change);
    /** Nothing moved - a re-removed line, or a quantity already set. Leave the version alone. */
    if (next === null) return true;

    await tx
      .update(cart)
      .set({ lines: next, version: locked.version + 1, updatedAt: new Date() })
      .where(and(eq(cart.organizationId, args.organizationId), eq(cart.id, args.cartId)));
    return true;
  });
}
