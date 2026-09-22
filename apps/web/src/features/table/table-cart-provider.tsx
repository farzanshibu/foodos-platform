/**
 * SOT: table-cart-provider, shared-basket-client, join-table, line-ops-client
 * WHAT   One basket API for both kinds of guest: somebody sitting at a table sharing a basket
 *        with the people around them, and somebody who has not been seated yet.
 * WHY    The two are genuinely different - one lives on the server because three phones write
 *        to it, the other lives in this browser because nobody else can see it - and every
 *        screen that adds a dish would otherwise have to know which it is dealing with.
 * HOW    Seated, every change is a line-level mutation and the server is the truth; a live
 *        nudge says when to re-read. Unseated, it is the local store exactly as before. The
 *        surface is the same either way, so a menu screen just calls `add`.
 * NOTE   Mounted ONCE, in the guest layout. Every screen reads the same instance through
 *        context rather than running its own copy - two instances would each try to sit down,
 *        and one person would arrive at the table as two members with two different names.
 * WHERE  use-cart-stream.ts, cart-store.ts, apps/web/src/features/table/item-sheet.tsx
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { type CartLine, useCartStore } from "@/features/table/cart-store";
import { type StreamState, useCartStream } from "@/features/table/use-cart-stream";

export type { StreamState };

import { useTRPC } from "@/trpc/react";

type SharedCart = OutputOf<"cart", "read">["items"][number];

export type TableMember = {
  readonly sessionId: string;
  readonly name: string;
  readonly isYou: boolean;
};

export type TableCart = {
  /** True once the server has confirmed this basket belongs to a place, not to this phone. */
  readonly isShared: boolean;
  readonly cartId: string | null;
  readonly members: readonly TableMember[];
  /** Whose line is whose, positionally parallel to the priced lines. Empty when not shared. */
  readonly attribution: readonly { lineId: string; addedByName: string | null; isMine: boolean }[];
  readonly stream: StreamState;
  readonly joining: boolean;
  /**
   * The server's priced view of the shared basket, or null when this phone owns its own. The
   * prices are the server's every time - a basket that remembered one could disagree with the
   * kitchen, and with a table sharing it, with the other phones too.
   */
  readonly priced: SharedCart["priced"] | null;
  readonly status: SharedCart["status"] | null;
  add: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  remove: (index: number) => void;
};

/**
 * A line id minted here rather than by the server, which is what makes every change
 * idempotent: a retry after a dropped connection carries the same id, so it re-adds nothing.
 */
const newLineId = () => crypto.randomUUID();

function useTableCartState(args: { seated: boolean; pollSeconds: number }): TableCart {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const localLines = useCartStore((state) => state.lines);
  const localAdd = useCartStore((state) => state.add);
  const localRemoveAt = useCartStore((state) => state.removeAt);
  const localSetQuantityAt = useCartStore((state) => state.setQuantityAt);
  const localClear = useCartStore((state) => state.clear);
  const hasHydrated = useCartStore((state) => state.hasHydrated);

  const cartQuery = useQuery(
    trpc.cart.get.queryOptions({ limit: 1, cursor: null }, { enabled: args.seated }),
  );
  const cart = cartQuery.data?.items[0] ?? null;
  const isShared = cart?.isShared === true;

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.cart.get.queryKey() });
  }, [queryClient, trpc]);

  const stream = useCartStream({
    cartId: cart?.id ?? null,
    enabled: isShared,
    pollSeconds: args.pollSeconds,
    onChange: refetch,
  });

  const join = useMutation(trpc.cart.create.mutationOptions({ onSuccess: refetch }));
  const update = useMutation(trpc.cart.update.mutationOptions({ onSuccess: refetch }));

  /**
   * Sit down, once.
   *
   * Whatever was picked before joining goes with them and is then cleared locally, so a
   * person who chose three dishes on the way to the table arrives with them rather than to an
   * empty basket - and the local copy does not linger to be sent a second time.
   *
   * The ref is the guard that matters: without it a re-render while the request is in flight
   * fires a second join, and `joining` alone flips too late to stop it.
   */
  const joined = useRef(false);
  useEffect(() => {
    if (!args.seated || !hasHydrated || joined.current) return;
    if (cartQuery.isLoading) return;
    if (cart !== null) return;
    joined.current = true;
    join.mutate(
      { branchId: "", orderType: "dine_in", lines: localLines },
      { onSuccess: () => localClear() },
    );
  }, [args.seated, hasHydrated, cartQuery.isLoading, cart, localLines, localClear, join]);

  const add = useCallback(
    (line: CartLine) => {
      if (!isShared || cart === null) {
        localAdd(line);
        return;
      }
      update.mutate({ action: "add_line", id: cart.id, lineId: newLineId(), line });
    },
    [isShared, cart, localAdd, update],
  );

  const setQuantity = useCallback(
    (index: number, quantity: number) => {
      if (!isShared || cart === null) {
        localSetQuantityAt(index, quantity);
        return;
      }
      const lineId = cart.attribution[index]?.lineId;
      if (lineId === undefined) return;
      update.mutate({ action: "set_quantity", id: cart.id, lineId, quantity });
    },
    [isShared, cart, localSetQuantityAt, update],
  );

  const remove = useCallback(
    (index: number) => {
      if (!isShared || cart === null) {
        localRemoveAt(index);
        return;
      }
      const lineId = cart.attribution[index]?.lineId;
      if (lineId === undefined) return;
      update.mutate({ action: "remove_line", id: cart.id, lineId });
    },
    [isShared, cart, localRemoveAt, update],
  );

  const priced = cart?.priced ?? null;
  const status = cart?.status ?? null;
  const members = cart?.members ?? [];
  const attribution = cart?.attribution ?? [];
  const cartId = cart?.id ?? null;
  const joining = join.isPending;

  /** Memoised: this is a context value, so a new object every render re-renders every screen. */
  return useMemo(
    () => ({
      isShared,
      cartId,
      members,
      attribution,
      stream,
      joining,
      priced,
      status,
      add,
      setQuantity,
      remove,
    }),
    [
      isShared,
      cartId,
      members,
      attribution,
      stream,
      joining,
      priced,
      status,
      add,
      setQuantity,
      remove,
    ],
  );
}

/* ── The single instance ─────────────────────────────────────────────────── */

const TableCartContext = createContext<TableCart | null>(null);

export function TableCartProvider(props: {
  seated: boolean;
  pollSeconds: number;
  children: React.ReactNode;
}) {
  const value = useTableCartState({ seated: props.seated, pollSeconds: props.pollSeconds });
  return <TableCartContext.Provider value={value}>{props.children}</TableCartContext.Provider>;
}

/**
 * Throws rather than handing back a lifeless default. A screen that adds a dish into a basket
 * that turns out not to exist is a bug that shows up as somebody's order silently missing,
 * which is exactly the failure this whole feature was built to stop.
 */
export function useTableCart(): TableCart {
  const value = useContext(TableCartContext);
  if (value === null) {
    throw new Error("useTableCart must be used inside a TableCartProvider.");
  }
  return value;
}
