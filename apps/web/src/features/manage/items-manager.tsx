/**
 * SOT: items-manager, menu-item-editor, bulk-availability
 * WHAT   The screen a restaurant spends most of its time on: the dishes, their prices, and
 *        whether they are on today.
 * WHY    Availability is the action that matters during service - the kitchen runs out of
 *        something and it has to come off every phone in the room in one tap. So it is a
 *        toggle on the row rather than something behind an edit form.
 * HOW    Prices are entered in rupees and sent in paise. That conversion happens once, here,
 *        at the edge - everything below this line is integers. The same rule holds for a whole
 *        spreadsheet: menu-import.tsx converts a CSV's rupee column once and sends paise.
 * WHERE  services/catalog/src/item.handlers.ts, apps/web/src/features/manage/menu-import.tsx
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

import { MenuImport } from "@/features/manage/menu-import";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Menu = OutputOf<"menu", "read">["items"][number];
type Category = OutputOf<"menuCategory", "read">["items"][number];
type Item = OutputOf<"menuItem", "read">["items"][number];

/** Rupees in the box, paise on the wire. One place, so nothing downstream sees a float. */
const toPaise = (rupees: string): number => Math.round(Number(rupees) * 100);

export function ItemsManager({
  menus,
  categories,
  initialItems,
}: {
  menus: Menu[];
  categories: Category[];
  initialItems: Item[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [menuId, setMenuId] = useState(menus[0]?.id ?? "");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");

  const items = useQuery(
    trpc.menuItem.list.queryOptions(
      { limit: 100, cursor: null, availableOnly: false },
      { initialData: { items: initialItems, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.menuItem.list.queryKey() });
  };

  const create = useMutation(
    trpc.menuItem.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setPrice("");
        refresh();
      },
    }),
  );
  const bulk = useMutation(trpc.menuItem.bulk.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.menuItem.remove.mutationOptions({ onSuccess: refresh }));

  const inMenu = (items.data?.items ?? []).filter(
    (item) => menuId === "" || item.menuId === menuId,
  );

  return (
    <PageShell
      title="Items"
      description="Everything on the menu. Toggle a dish off and it disappears from every table."
      action={
        menus.length <= 1 ? null : (
          <select
            value={menuId}
            onChange={(event) => {
              setMenuId(event.target.value);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {menus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name}
              </option>
            ))}
          </select>
        )
      }
    >
      {/* No fallback: <Gate> already renders the registry's own upgrade copy when the plan
          is the blocker, and passing one here would replace copy the registry owns. */}
      <Gate resource="menuItem" operation="create">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 p-4">
            <label className="min-w-40 flex-1 space-y-1">
              <span className="font-medium text-foreground text-sm">Dish</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Chicken Biryani"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="w-28 space-y-1">
              <span className="font-medium text-foreground text-sm">Price ₹</span>
              <input
                value={price}
                inputMode="decimal"
                onChange={(event) => {
                  setPrice(event.target.value);
                }}
                placeholder="220"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="min-w-40 flex-1 space-y-1">
              <span className="font-medium text-foreground text-sm">Section</span>
              <select
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {categories
                  .filter((category) => menuId === "" || category.menuId === menuId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              disabled={create.isPending || name.trim() === "" || price === "" || categoryId === ""}
              onClick={() => {
                create.mutate({
                  menuId,
                  categoryId,
                  name: name.trim(),
                  pricePaise: toPaise(price),
                });
              }}
            >
              Add dish
            </Button>
          </CardContent>
        </Card>
      </Gate>

      <MenuImport menuId={menuId} onImported={refresh} />

      {create.error === null ? null : <Denial error={create.error} />}
      {bulk.error === null ? null : <Denial error={bulk.error} />}

      {inMenu.length === 0 ? (
        <Empty
          icon="🍽️"
          title="No dishes yet"
          detail="Add the first one above. It appears on every table's menu straight away."
        />
      ) : (
        <ul className="space-y-2">
          {inMenu.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {money(item.discountPricePaise ?? item.pricePaise)}
                      {item.variants.length === 0 ? "" : ` · ${String(item.variants.length)} sizes`}
                      {item.modifiers.length === 0
                        ? ""
                        : ` · ${String(item.modifiers.length)} add-on groups`}
                    </p>
                  </div>

                  <Badge variant={item.isAvailable ? "secondary" : "outline"}>
                    {item.isAvailable ? "On" : "Off"}
                  </Badge>

                  <Gate resource="menuItem" operation="manage">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={bulk.isPending}
                      onClick={() => {
                        bulk.mutate({
                          action: "set_availability",
                          ids: [item.id],
                          isAvailable: !item.isAvailable,
                        });
                      }}
                    >
                      {item.isAvailable ? "Take off" : "Put on"}
                    </Button>
                  </Gate>

                  <Gate resource="menuItem" operation="delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => {
                        remove.mutate({ id: item.id });
                      }}
                    >
                      Delete
                    </Button>
                  </Gate>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
