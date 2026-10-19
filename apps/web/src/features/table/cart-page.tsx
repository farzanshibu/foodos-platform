/**
 * SOT: guest-cart-page, checkout, walk-in-allocation, order-placement
 * WHAT   The basket, priced by the server, and the two ways it becomes an order.
 * WHY    There are two, and they are genuinely different. Somebody who scanned the code ON a
 *        table already has a place, so they just order. Somebody who scanned at the door does
 *        not: they send the basket, staff seat them, and only then does it become an order -
 *        at the place staff chose, which is where it will actually be carried to.
 * HOW    Everything with a currency symbol came back from `quote.price`. The browser holds
 *        lines and quantities; it never holds a total and never sends one.
 * WHERE  services/catalog/src/quote.handlers.ts, services/orders/src/cart.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCartStore } from "@/features/table/cart-store";
import { money } from "@/features/table/money";
import { useTableCart } from "@/features/table/table-cart-provider";
import { AddedBy, TableParty } from "@/features/table/table-party";
import { useTRPC } from "@/trpc/react";

export function CartPage({
  branchId,
  placeId,
  placeKind,
  placeLabel,
  guestName,
  guestPhone,
  pollSeconds,
}: {
  branchId: string;
  placeId: string | null;
  placeKind: "table" | "seat" | null;
  placeLabel: string | null;
  guestName: string | null;
  guestPhone: string | null;
  pollSeconds: number;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const lines = useCartStore((state) => state.lines);
  const hasHydrated = useCartStore((state) => state.hasHydrated);
  const pendingCartId = useCartStore((state) => state.pendingCartId);
  const setPendingCartId = useCartStore((state) => state.setPendingCartId);
  const clear = useCartStore((state) => state.clear);

  /**
   * The basket, whichever kind this is. Seated, it lives on the server because three phones
   * write to it; unseated, it is this browser's own. `setQuantity` and `remove` route to the
   * right one, so nothing below this line has to know which.
   */
  const table = useTableCart();

  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [name, setName] = useState(guestName ?? "");
  const [phone, setPhone] = useState(guestPhone ?? "");

  /**
   * Only the unshared basket is priced from here. A shared one is priced by the service that
   * owns it and arrives already costed, so quoting it again from this phone's copy would be a
   * second answer to a question that already has one - and the two would disagree the moment
   * somebody else added a dish.
   */
  const quote = useQuery(
    trpc.quote.price.queryOptions(
      {
        branchId,
        lines,
        orderType: "dine_in",
        ...(applied === null ? {} : { couponCode: applied }),
      },
      { enabled: !table.isShared && lines.length > 0 },
    ),
  );

  const seated = useSeating(pendingCartId, pollSeconds);

  const send = useMutation(
    trpc.cart.create.mutationOptions({
      onSuccess: (created) => {
        setPendingCartId(created.id);
      },
    }),
  );

  const place = useMutation(
    trpc.order.create.mutationOptions({
      onSuccess: (order) => {
        clear();
        router.push(`/t/orders?placed=${order.orderNumber}`);
      },
    }),
  );

  const view = basketView({
    shared: table.isShared,
    sharedPriced: table.priced,
    joining: table.joining,
    localPriced: quote.data,
    localCount: lines.length,
    hasHydrated,
  });
  const priced = view.priced;
  if (view.settling || view.lineCount === 0) {
    return <EmptyBasket loading={view.settling} />;
  }
  const allocatedTo = seated?.status === "allocated" ? seated : null;
  const waiting = seated !== null && seated.status === "awaiting_place";

  /**
   * Where this order is going, decided once. Staff allocation wins over whatever the QR said,
   * because staff allocate second and they are looking at the room.
   */
  const destination = {
    id: allocatedTo?.placeId ?? placeId,
    kind: allocatedTo?.placeKind ?? placeKind,
    label: allocatedTo?.placeLabel ?? placeLabel,
  };
  const editable = pendingCartId === null;

  /** Everything the order needs, assembled once. No price: the server puts that on. */
  const confirmOrder = (confirmedPlaceId: string | null) => {
    place.mutate({
      branchId,
      orderType: "dine_in",
      ...(confirmedPlaceId === null ? {} : { placeId: confirmedPlaceId }),
      /**
       * Naming the basket makes the SERVER read its lines, which is what carries everyone's
       * attribution onto the order - and means the phone confirming cannot send a list that
       * is already stale because somebody added a dish a second ago.
       */
      ...(table.cartId === null ? {} : { cartId: table.cartId }),
      lines,
      ...(applied === null ? {} : { couponCode: applied }),
      ...(name.trim() === "" ? {} : { guestName: name.trim() }),
      ...(phone.trim() === "" ? {} : { guestPhone: phone.trim() }),
    });
  };

  return (
    <div className="space-y-5">
      <h1 className="font-semibold text-foreground text-xl">Your order</h1>

      <SeatingBanner
        waiting={waiting}
        placeKind={allocatedTo?.placeKind ?? null}
        placeLabel={allocatedTo?.placeLabel ?? null}
      />

      <TableParty members={table.members} stream={table.stream} />

      <CartLines
        lines={priced?.lines ?? []}
        attribution={table.attribution}
        editable={editable}
        onQuantity={table.setQuantity}
        onRemove={table.remove}
      />

      <Summary
        editable={editable}
        coupon={coupon}
        onCoupon={setCoupon}
        onApply={() => {
          setApplied(coupon.trim() === "" ? null : coupon.trim());
        }}
        error={quote.error}
        priced={priced ?? null}
      />

      {editable ? (
        <GuestDetails name={name} phone={phone} onName={setName} onPhone={setPhone} />
      ) : null}

      {send.error === null ? null : <Denial error={send.error} />}
      {place.error === null ? null : <Denial error={place.error} />}

      <CheckoutButton
        placeId={destination.id}
        placeKind={destination.kind}
        placeLabel={destination.label}
        waiting={waiting}
        ready={priced !== undefined}
        busy={send.isPending || place.isPending}
        totalPaise={priced?.totalPaise ?? 0}
        onSend={() => {
          send.mutate({ branchId, orderType: "dine_in", lines });
        }}
        onPlace={confirmOrder}
      />
    </div>
  );
}

/**
 * One button, three sentences, depending on where the person is standing. Split out because
 * the decision is the interesting part and it should be readable in one screen.
 */
function CheckoutButton({
  placeId,
  placeKind,
  placeLabel,
  waiting,
  ready,
  busy,
  totalPaise,
  onSend,
  onPlace,
}: {
  placeId: string | null;
  placeKind: "table" | "seat" | null;
  placeLabel: string | null;
  waiting: boolean;
  ready: boolean;
  busy: boolean;
  totalPaise: number;
  onSend: () => void;
  onPlace: (placeId: string | null) => void;
}) {
  if (waiting) {
    return (
      <Button className="w-full" size="lg" disabled>
        Waiting for a {placeKind === "seat" ? "seat" : "table"}…
      </Button>
    );
  }

  /** Seated already - either they scanned the place, or staff just allocated one. */
  if (placeId !== null) {
    return (
      <Button
        className="w-full"
        size="lg"
        disabled={!ready || busy}
        onClick={() => {
          onPlace(placeId);
        }}
      >
        {busy
          ? "Sending…"
          : placeLabel === null
            ? `Place order · ${money(totalPaise)}`
            : `Confirm for ${placeKind === "seat" ? "seat" : "table"} ${placeLabel} · ${money(totalPaise)}`}
      </Button>
    );
  }

  /** No place: they scanned at the door, so this goes to the counter to be seated. */
  return (
    <Button
      className="w-full"
      size="lg"
      disabled={!ready || busy}
      onClick={onSend}
    >
      {busy ? "Sending…" : `Send order · ${money(totalPaise)}`}
    </Button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type PricedCart = OutputOf<"quote", "read">;
type PricedLine = OutputOf<"quote", "read">["lines"][number];

/**
 * The basket's contents, priced. Split out because the page above it is a decision - which of
 * the two checkout paths somebody is on - and that decision should be readable in one screen.
 * Quantity controls disappear once the basket has been sent: it is with the counter now.
 */
/**
 * Which basket this screen is showing, and whether it is ready to be shown.
 *
 * The two kinds settle differently and the distinction is the whole point of separating this
 * out: a shared basket is not empty because this phone has not read it yet, and a local one is
 * not ready because storage rehydrated. Getting that wrong flashes "nothing in your order yet"
 * over somebody else's dishes, which reads as having lost the order.
 */
function basketView(args: {
  shared: boolean;
  sharedPriced: PricedCart | null;
  joining: boolean;
  localPriced: PricedCart | undefined;
  localCount: number;
  hasHydrated: boolean;
}): { priced: PricedCart | undefined; lineCount: number; settling: boolean } {
  if (args.shared) {
    return {
      priced: args.sharedPriced ?? undefined,
      lineCount: args.sharedPriced?.lines.length ?? 0,
      settling: args.sharedPriced === null || args.joining,
    };
  }
  return {
    priced: args.localPriced,
    lineCount: args.localCount,
    settling: !args.hasHydrated,
  };
}

function CartLines({
  lines,
  attribution,
  editable,
  onQuantity,
  onRemove,
}: {
  lines: readonly PricedLine[];
  /** Parallel to `lines`, and empty when the basket is not shared. */
  attribution: readonly { lineId: string; addedByName: string | null; isMine: boolean }[];
  editable: boolean;
  onQuantity: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <ul className="space-y-2">
      {lines.map((line, index) => (
        <li key={attribution[index]?.lineId ?? `${line.kind}-${String(index)}`}>
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {line.nameSnapshot}
                    {line.kind === "item" && line.variantNameSnapshot !== null
                      ? ` · ${line.variantNameSnapshot}`
                      : ""}{" "}
                    <AddedBy
                      name={attribution[index]?.addedByName ?? null}
                      isMine={attribution[index]?.isMine ?? true}
                    />
                  </p>
                  {line.kind === "combo" ? (
                    <p className="text-muted-foreground text-sm">
                      {line.children
                        .map((child) => `${String(child.quantity)}× ${child.nameSnapshot}`)
                        .join(", ")}
                    </p>
                  ) : null}
                  {line.kind === "item" && line.modifiers.length > 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {line.modifiers.map((modifier) => modifier.nameSnapshot).join(", ")}
                    </p>
                  ) : null}
                  {line.notes === null ? null : (
                    <p className="text-muted-foreground text-xs italic">{line.notes}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">{money(line.lineTotalPaise)}</p>
                  {line.kind === "combo" && line.savingsPaise > 0 ? (
                    <p className="text-muted-foreground text-xs line-through">
                      {money(line.referencePricePaise)}
                    </p>
                  ) : null}
                </div>
              </div>

              {editable ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-md border border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onQuantity(index, line.quantity - 1);
                      }}
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm">{line.quantity}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onQuantity(index, line.quantity + 1);
                      }}
                    >
                      +
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onRemove(index);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Polls the sent basket until staff seat it, and only while one is actually out there. The
 * interval is the server's, handed out with the QR session, so a busy branch can slow every
 * phone in the room from one setting.
 */
function useSeating(pendingCartId: string | null, pollSeconds: number) {
  const trpc = useTRPC();
  const pending = useQuery(
    trpc.cart.get.queryOptions(
      { limit: 1, cursor: null, ...(pendingCartId === null ? {} : { id: pendingCartId }) },
      { enabled: pendingCartId !== null, refetchInterval: pollSeconds * 1000 },
    ),
  );
  return pending.data?.items[0] ?? null;
}

/**
 * Nothing to show yet - either the basket has not come back from storage, or there is
 * genuinely nothing in it. Kept apart so the two are never confused: showing "your basket is
 * empty" during hydration reads as having lost somebody's order.
 */
function EmptyBasket({ loading }: { loading: boolean }) {
  const router = useRouter();
  if (loading) {
    return <p className="py-16 text-center text-muted-foreground text-sm">One moment…</p>;
  }
  return (
    <div className="space-y-4 py-16 text-center">
      <div
        className="mx-auto flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        aria-hidden="true"
      >
        <ReceiptText className="size-5" />
      </div>
      <p className="text-muted-foreground text-sm">Nothing in your order yet.</p>
      <Button
        onClick={() => {
          router.push("/t");
        }}
      >
        Browse the menu
      </Button>
    </div>
  );
}

/** Where somebody is in the walk-in handshake, said in one sentence. */
function SeatingBanner({
  waiting,
  placeKind,
  placeLabel,
}: {
  waiting: boolean;
  placeKind: "table" | "seat" | null;
  placeLabel: string | null;
}) {
  if (waiting) {
    return (
      <Card className="border-primary">
        <CardContent className="space-y-1 p-4 text-center">
          <p className="font-medium text-foreground">Sent to the counter</p>
          <p className="text-muted-foreground text-sm">
            We&apos;ll find you somewhere to sit. This page updates on its own.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (placeLabel === null) return null;
  return (
    <Card className="border-primary">
      <CardContent className="space-y-1 p-4 text-center">
        <p className="font-medium text-foreground">
          You&apos;re at {placeKind === "seat" ? "seat" : "table"} {placeLabel}
        </p>
        <p className="text-muted-foreground text-sm">
          Confirm below and it goes straight to the kitchen.
        </p>
      </CardContent>
    </Card>
  );
}

function Totals({ priced }: { priced: OutputOf<"quote", "read"> | null }) {
  if (priced === null) {
    return <p className="text-muted-foreground text-sm">Working out your total…</p>;
  }
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Subtotal" value={money(priced.subtotalPaise)} />
      {priced.discountPaise === 0 ? null : (
        <Row label="Discount" value={`− ${money(priced.discountPaise)}`} />
      )}
      {priced.taxPaise === 0 ? null : <Row label="Tax" value={money(priced.taxPaise)} />}
      <div className="flex justify-between border-border border-t pt-2 font-semibold text-base text-foreground">
        <dt>Total</dt>
        <dd>{money(priced.totalPaise)}</dd>
      </div>
    </dl>
  );
}

/** The offer box and the totals. One card, because they are one conversation about money. */
function Summary({
  editable,
  coupon,
  onCoupon,
  onApply,
  error,
  priced,
}: {
  editable: boolean;
  coupon: string;
  onCoupon: (value: string) => void;
  onApply: () => void;
  error: React.ComponentProps<typeof Denial>["error"];
  priced: OutputOf<"quote", "read"> | null;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {editable ? (
          <div className="flex gap-2">
            <input
              value={coupon}
              onChange={(event) => {
                onCoupon(event.target.value.toUpperCase());
              }}
              placeholder="Offer code"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <Button variant="outline" onClick={onApply}>
              Apply
            </Button>
          </div>
        ) : null}
        {error === null ? null : <Denial error={error} />}
        <Totals priced={priced} />
      </CardContent>
    </Card>
  );
}

function GuestDetails({
  name,
  phone,
  onName,
  onPhone,
}: {
  name: string;
  phone: string;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-medium text-foreground text-sm">Who is this for?</p>
        <input
          value={name}
          onChange={(event) => {
            onName(event.target.value);
          }}
          placeholder="Your name (optional)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          value={phone}
          inputMode="tel"
          onChange={(event) => {
            onPhone(event.target.value);
          }}
          placeholder="Mobile number (optional)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </CardContent>
    </Card>
  );
}
