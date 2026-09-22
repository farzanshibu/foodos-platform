/**
 * SOT: guest-cart-store, cart-lines, local-cart, zustand-persist
 * WHAT   The guest's basket, held in the browser between screens and across a phone lock.
 * WHY    It holds LINES - what was chosen - and never a price. Prices come from the server on
 *        every read, so a menu that changed while somebody was deciding shows up before they
 *        pay rather than after. A basket that remembered a price would be a basket that could
 *        disagree with the kitchen.
 * HOW    zustand with `persist`, because somebody switching to their messages and back should
 *        not lose their order. One store, so two screens reading it cannot disagree.
 * NOTE   `hasHydrated` exists because on the first render the basket is empty by definition.
 *        Rendering "nothing in your order yet" for one frame before it fills in is the kind
 *        of flicker people read as a bug, so screens wait for it.
 * WHERE  apps/web/src/features/table/cart-page.tsx
 */
"use client";

import type { InputOf } from "@foodos/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type CartLine = InputOf<"quote", "read">["lines"][number];

type CartState = {
  lines: CartLine[];
  /** The server-side basket, once it has been sent to the counter to be seated. */
  pendingCartId: string | null;
  hasHydrated: boolean;
  add: (line: CartLine) => void;
  removeAt: (index: number) => void;
  setQuantityAt: (index: number, quantity: number) => void;
  setPendingCartId: (id: string | null) => void;
  setHydrated: () => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      pendingCartId: null,
      hasHydrated: false,

      add: (line) => {
        set((state) => ({ lines: [...state.lines, line] }));
      },

      removeAt: (index) => {
        set((state) => ({ lines: state.lines.filter((_, position) => position !== index) }));
      },

      setQuantityAt: (index, quantity) => {
        set((state) => ({
          lines: state.lines.map((line, position) =>
            position === index ? { ...line, quantity: Math.max(1, quantity) } : line,
          ),
        }));
      },

      setPendingCartId: (id) => {
        set({ pendingCartId: id });
      },

      setHydrated: () => {
        set({ hasHydrated: true });
      },

      clear: () => {
        set({ lines: [], pendingCartId: null });
      },
    }),
    {
      name: "foodos.cart",
      storage: createJSONStorage(() => localStorage),
      /** Only the basket is persisted. `hasHydrated` is derived; storing it would be a lie. */
      partialize: (state) => ({ lines: state.lines, pendingCartId: state.pendingCartId }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

/** How many things are in it, for the badge on the bottom bar. */
export const cartCount = (lines: readonly CartLine[]): number =>
  lines.reduce((total, line) => total + line.quantity, 0);
