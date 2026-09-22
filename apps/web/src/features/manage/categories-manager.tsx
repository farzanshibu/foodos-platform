/**
 * SOT: categories-manager, menu-sections, category-order
 * WHAT   The sections a menu is divided into, and the order they appear in.
 * WHY    Order matters more than it looks: it is the order a guest reads the menu in, and
 *        starters below desserts is a menu nobody scrolls. Reordering is two buttons rather
 *        than a drag, because this screen is used on a phone as often as a laptop.
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

type Menu = OutputOf<"menu", "read">["items"][number];
type Category = OutputOf<"menuCategory", "read">["items"][number];

export function CategoriesManager({
  menus,
  initialCategories,
}: {
  menus: Menu[];
  initialCategories: Category[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [menuId, setMenuId] = useState(menus[0]?.id ?? "");
  const [name, setName] = useState("");

  const categories = useQuery(
    trpc.menuCategory.list.queryOptions(
      { limit: 100, cursor: null },
      { initialData: { items: initialCategories, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.menuCategory.list.queryKey() });
  };
  const create = useMutation(
    trpc.menuCategory.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const update = useMutation(trpc.menuCategory.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.menuCategory.remove.mutationOptions({ onSuccess: refresh }));

  const shown = categories.data.items
    .filter((category) => menuId === "" || category.menuId === menuId)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  /** Swaps two neighbours' sort orders. Two writes, so the list never has a duplicate order. */
  const swap = (index: number, direction: -1 | 1) => {
    const here = shown[index];
    const there = shown[index + direction];
    if (here === undefined || there === undefined) return;
    update.mutate({ id: here.id, sortOrder: there.sortOrder });
    update.mutate({ id: there.id, sortOrder: here.sortOrder });
  };

  return (
    <PageShell
      title="Sections"
      description="Starters, mains, drinks. The order here is the order guests read them in."
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
      <Gate resource="menuCategory" operation="create">
        <CreateRow>
          <Field label="Section name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Starters"
              className={controlClass}
            />
          </Field>
          <Button
            disabled={create.isPending || name.trim() === "" || menuId === ""}
            onClick={() => {
              create.mutate({ menuId, name: name.trim(), sortOrder: shown.length });
            }}
          >
            Add section
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {remove.error === null ? null : <Denial error={remove.error} />}

      {shown.length === 0 ? (
        <Empty
          icon="🗂️"
          title="No sections yet"
          detail="Every dish belongs to one. Add a couple before adding dishes."
        />
      ) : (
        <ListCard>
          <ul>
            {shown.map((category, index) => (
              <li key={category.id}>
                <ListRow
                  title={category.name}
                  subtitle={`${String(category.itemCount)} dish${category.itemCount === 1 ? "" : "es"}`}
                  meta={category.isActive ? null : <Badge variant="destructive">Hidden</Badge>}
                  actions={
                    <div className="flex gap-1">
                      <Gate resource="menuCategory" operation="update">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={index === 0 || update.isPending}
                          onClick={() => {
                            swap(index, -1);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={index === shown.length - 1 || update.isPending}
                          onClick={() => {
                            swap(index, 1);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => {
                            update.mutate({ id: category.id, isActive: !category.isActive });
                          }}
                        >
                          {category.isActive ? "Hide" : "Show"}
                        </Button>
                      </Gate>
                      <Gate resource="menuCategory" operation="delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            remove.mutate({ id: category.id });
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
