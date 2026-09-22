/**
 * SOT: waiting-queue, place-allocation, walk-in-seating
 * WHAT   Baskets sent from the door that still need somewhere to sit.
 * WHY    This is the other half of the walk-in flow. Somebody ordered before being seated;
 *        until staff give them a place there is no order, no kitchen ticket and nothing to
 *        carry anywhere. Allocating is the act that makes it real.
 * HOW    Only free places are offered, and allocating marks the place occupied in the same
 *        breath - so two members of staff cannot seat two parties at the same table.
 * WHERE  services/orders/src/cart.handlers.ts, services/floor/src/floor.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Empty } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Cart = OutputOf<"cart", "read">["items"][number];
type Place = OutputOf<"place", "read">["items"][number];

export function WaitingQueue({ branchId }: { branchId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);

  const carts = useQuery(
    trpc.cart.get.queryOptions(
      {
        limit: 50,
        cursor: null,
        status: "awaiting_place",
        ...(branchId === "" ? {} : { branchId }),
      },
      { refetchInterval: 8_000 },
    ),
  );

  const places = useQuery(
    trpc.place.list.queryOptions(
      {
        limit: 200,
        cursor: null,
        status: "available",
        parameterFilters: [],
        customerVisibleParametersOnly: false,
        ...(branchId === "" ? {} : { branchId }),
      },
      { enabled: branchId !== "" },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.cart.get.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.place.list.queryKey() });
  };

  const allocate = useMutation(
    trpc.cart.update.mutationOptions({
      onSuccess: () => {
        setOpening(null);
        refresh();
      },
    }),
  );

  /** Marking the place occupied is what stops two people seating the same table at once. */
  const occupy = useMutation(trpc.place.floorAction.mutationOptions({ onSuccess: refresh }));

  if (carts.data === undefined) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (carts.data.items.length === 0) {
    return (
      <Empty
        icon="🚪"
        title="Nobody waiting"
        detail="Orders placed at the door appear here until you give them somewhere to sit."
      />
    );
  }

  return (
    <div className="space-y-3">
      {allocate.error === null ? null : <Denial error={allocate.error} />}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {carts.data.items.map((cart) => (
          <li key={cart.id}>
            <WaitingCard
              cart={cart}
              places={places.data?.items ?? []}
              open={opening === cart.id}
              pending={allocate.isPending || occupy.isPending}
              onOpen={() => {
                setOpening(opening === cart.id ? null : cart.id);
              }}
              onAllocate={(placeId) => {
                allocate.mutate({ id: cart.id, placeId, status: "allocated" });
                occupy.mutate({ action: "set_status", id: placeId, status: "occupied" });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WaitingCard({
  cart,
  places,
  open,
  pending,
  onOpen,
  onAllocate,
}: {
  cart: Cart;
  places: Place[];
  open: boolean;
  pending: boolean;
  onOpen: () => void;
  onAllocate: (placeId: string) => void;
}) {
  const people = cart.priced.lines.reduce((total, line) => total + line.quantity, 0);

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground">{cart.guestName ?? "Walk-in"}</p>
            <p className="text-muted-foreground text-xs">
              {people} item{people === 1 ? "" : "s"} · {money(cart.priced.totalPaise)}
            </p>
          </div>
          <Badge variant="outline">waiting</Badge>
        </div>

        <ul className="flex-1 space-y-0.5 text-muted-foreground text-sm">
          {cart.priced.lines.map((line, index) => (
            <li key={`${line.kind}-${String(index)}`}>
              {line.quantity}× {line.nameSnapshot}
            </li>
          ))}
        </ul>

        <Gate resource="cart" operation="update">
          {open ? (
            places.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing free right now.</p>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {places.map((place) => (
                  <Button
                    key={place.id}
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      onAllocate(place.id);
                    }}
                  >
                    {place.label}
                    <span className="ml-1 text-muted-foreground">·{place.capacity}</span>
                  </Button>
                ))}
              </div>
            )
          ) : (
            <Button className="w-full" disabled={pending} onClick={onOpen}>
              Seat them
            </Button>
          )}
        </Gate>
      </CardContent>
    </Card>
  );
}
