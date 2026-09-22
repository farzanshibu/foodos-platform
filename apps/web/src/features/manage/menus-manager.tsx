/**
 * SOT: menus-manager, master-menu, branch-menu-override
 * WHAT   The menus a restaurant serves, and which branch each one belongs to.
 * WHY    A menu with no branch is the master every branch inherits; one with a branch
 *        overrides it there. That is the whole multi-branch story, and it is a single
 *        nullable field rather than a copy-and-diverge feature.
 * HOW    Exactly one menu per restaurant is the default. Promoting a second demotes the
 *        first in the catalogue service, so a branch resolving its menu never finds two.
 * WHERE  services/catalog/src/menu.handlers.ts
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
type Branch = OutputOf<"branch", "read">["items"][number];
type Menu = OutputOf<"menu", "read">["items"][number];

export function MenusManager({
  restaurants,
  branches,
  initialMenus,
}: {
  restaurants: Restaurant[];
  branches: Branch[];
  initialMenus: Menu[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [branchId, setBranchId] = useState("");

  const menus = useQuery(
    trpc.menu.list.queryOptions(
      { limit: 50, cursor: null },
      { initialData: { items: initialMenus, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.menu.list.queryKey() });
  };
  const create = useMutation(
    trpc.menu.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const update = useMutation(trpc.menu.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.menu.remove.mutationOptions({ onSuccess: refresh }));

  return (
    <PageShell
      title="Menus"
      description="One master menu, plus a branch-specific one wherever a branch differs."
    >
      <Gate resource="menu" operation="create">
        <CreateRow>
          <Field label="Menu name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="All day"
              className={controlClass}
            />
          </Field>
          {restaurants.length <= 1 ? null : (
            <Field label="Restaurant" width="w-48">
              <select
                value={restaurantId}
                onChange={(event) => {
                  setRestaurantId(event.target.value);
                }}
                className={controlClass}
              >
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Branch" width="w-48">
            <select
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
              }}
              className={controlClass}
            >
              <option value="">Every branch (master)</option>
              {branches
                .filter((branch) => branch.restaurantId === restaurantId)
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            disabled={create.isPending || name.trim() === "" || restaurantId === ""}
            onClick={() => {
              create.mutate({
                restaurantId,
                name: name.trim(),
                ...(branchId === "" ? {} : { branchId }),
              });
            }}
          >
            Add menu
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {remove.error === null ? null : <Denial error={remove.error} />}

      {menus.data.items.length === 0 ? (
        <Empty
          icon="📖"
          title="No menus yet"
          detail="Create one, then add sections and dishes to it."
        />
      ) : (
        <ListCard>
          <ul>
            {menus.data.items.map((menu) => (
              <li key={menu.id}>
                <ListRow
                  title={menu.name}
                  subtitle={
                    menu.branchId === null
                      ? "Master — every branch inherits this"
                      : (branches.find((branch) => branch.id === menu.branchId)?.name ??
                        "One branch")
                  }
                  meta={
                    <div className="flex gap-1">
                      {menu.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                      <Badge variant={menu.isActive ? "outline" : "destructive"}>
                        {menu.isActive ? "Live" : "Hidden"}
                      </Badge>
                    </div>
                  }
                  actions={
                    <div className="flex gap-2">
                      <Gate resource="menu" operation="update">
                        {menu.isDefault ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={update.isPending}
                            onClick={() => {
                              update.mutate({ id: menu.id, isDefault: true });
                            }}
                          >
                            Make default
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => {
                            update.mutate({ id: menu.id, isActive: !menu.isActive });
                          }}
                        >
                          {menu.isActive ? "Hide" : "Show"}
                        </Button>
                      </Gate>
                      <Gate resource="menu" operation="delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            remove.mutate({ id: menu.id });
                          }}
                        >
                          Delete
                        </Button>
                      </Gate>
                    </div>
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
