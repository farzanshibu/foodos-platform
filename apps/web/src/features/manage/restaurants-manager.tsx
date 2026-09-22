/**
 * SOT: restaurants-manager, go-live-switch, restaurant-profile
 * WHAT   The restaurants this organisation runs, and the switch that starts service.
 * WHY    Going live is the moment scans resolve and orders start arriving, so it is its own
 *        audited action rather than a checkbox. The catalogue refuses to take one live with no
 *        branch: there is nowhere for a guest to be sitting and nothing for an order to belong
 *        to. There is no public directory any more, so nothing here is a listing - "live"
 *        means the floor is open, and that is all it has ever needed to mean.
 * WHERE  services/catalog/src/restaurant.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreateRow, controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];

/** The slug is not a URL any more; the QR service prints it into every code it makes. */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export function RestaurantsManager({ initialRestaurants }: { initialRestaurants: Restaurant[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const restaurants = useQuery(
    trpc.restaurant.list.queryOptions(
      { limit: 20, cursor: null },
      { initialData: { items: initialRestaurants, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.restaurant.list.queryKey() });
  };
  const create = useMutation(
    trpc.restaurant.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const setLive = useMutation(trpc.restaurant.setLive.mutationOptions({ onSuccess: refresh }));

  return (
    <PageShell
      title="Restaurants"
      description="Going live opens the floor: table codes resolve and orders start arriving."
    >
      <Gate resource="restaurant" operation="create">
        <CreateRow>
          <Field label="Restaurant name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Paradise Biryani"
              className={controlClass}
            />
          </Field>
          <Button
            disabled={create.isPending || name.trim().length < 2}
            onClick={() => {
              create.mutate({ name: name.trim(), slug: slugify(name) });
            }}
          >
            Create
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {setLive.error === null ? null : <Denial error={setLive.error} />}

      {restaurants.data.items.length === 0 ? (
        <Empty
          icon="🏪"
          title="No restaurant yet"
          detail="Create one, add a branch, build a menu, print the codes. About fifteen minutes."
        />
      ) : (
        <ListCard>
          <ul>
            {restaurants.data.items.map((restaurant) => (
              <li key={restaurant.id}>
                <ListRow
                  title={restaurant.name}
                  subtitle={`${String(restaurant.branchCount)} branch${
                    restaurant.branchCount === 1 ? "" : "es"
                  } · ${restaurant.slug}`}
                  meta={
                    <Badge variant={restaurant.isLive ? "secondary" : "outline"}>
                      {restaurant.isLive ? "Live" : "Not serving"}
                    </Badge>
                  }
                  actions={
                    <Gate resource="restaurant" operation="manage">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setLive.isPending}
                        onClick={() => {
                          setLive.mutate({
                            action: restaurant.isLive ? "take_offline" : "go_live",
                            id: restaurant.id,
                          });
                        }}
                      >
                        {restaurant.isLive ? "Take offline" : "Go live"}
                      </Button>
                    </Gate>
                  }
                />
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}
