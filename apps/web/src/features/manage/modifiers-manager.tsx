/**
 * SOT: modifiers-manager, add-on-groups, modifier-rules
 * WHAT   The add-on and size groups hung off a dish, with the rules for choosing from them.
 * WHY    The min/max rules are what stop "choose a base" being optional and "extra toppings"
 *        being unlimited. They are enforced in the catalogue when a cart is priced, so what
 *        is set here is the real rule, not a hint the checkout can ignore.
 * WHERE  services/catalog/src/item.handlers.ts
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
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Item = OutputOf<"menuItem", "read">["items"][number];

export function ModifiersManager({ items }: { items: Item[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [name, setName] = useState("");
  const [required, setRequired] = useState(false);
  const [max, setMax] = useState("1");
  const [options, setOptions] = useState("Cheese +20\nMushroom +30");

  const modifiers = useQuery(
    trpc.menuModifier.list.queryOptions(
      { limit: 50, cursor: null, ...(itemId === "" ? {} : { itemId }) },
      { enabled: itemId !== "" },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.menuModifier.list.queryKey() });
  };
  const create = useMutation(
    trpc.menuModifier.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const remove = useMutation(trpc.menuModifier.remove.mutationOptions({ onSuccess: refresh }));

  /**
   * One option per line, "Name +price". A textarea rather than a repeating form because a
   * chef typing eight toppings should type eight lines, not press "add" eight times.
   */
  const parsed = options
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, index) => {
      const match = /^(.*?)\s*\+\s*([0-9]+(?:\.[0-9]{1,2})?)$/.exec(line);
      return {
        name: (match?.[1] ?? line).trim(),
        priceDeltaPaise: Math.round(Number(match?.[2] ?? 0) * 100),
        isDefault: false,
        isAvailable: true,
        sortOrder: index,
      };
    });

  return (
    <PageShell
      title="Add-ons"
      description="Sizes, toppings and extras, with the rules for picking from them."
      action={
        <select
          value={itemId}
          onChange={(event) => {
            setItemId(event.target.value);
          }}
          className="max-w-60 rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      }
    >
      <Gate resource="menuModifier" operation="create">
        <CreateRow>
          <Field label="Group name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Toppings"
              className={controlClass}
            />
          </Field>
          <Field label="Choose up to" width="w-28">
            <input
              value={max}
              inputMode="numeric"
              onChange={(event) => {
                setMax(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-foreground text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => {
                setRequired(event.target.checked);
              }}
            />
            required
          </label>
          <Field label="Options — one per line, Name +price">
            <textarea
              rows={3}
              value={options}
              onChange={(event) => {
                setOptions(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Button
            disabled={
              create.isPending || name.trim() === "" || itemId === "" || parsed.length === 0
            }
            onClick={() => {
              create.mutate({
                itemId,
                name: name.trim(),
                isRequired: required,
                minSelections: required ? 1 : 0,
                maxSelections: Math.max(1, Number(max) || 1),
                sortOrder: modifiers.data?.items.length ?? 0,
                options: parsed,
              });
            }}
          >
            Add group
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}

      {modifiers.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : modifiers.data.items.length === 0 ? (
        <Empty
          icon="➕"
          title="No add-ons on this dish"
          detail="Sizes, toppings, sides — anything a guest picks alongside it."
        />
      ) : (
        <ListCard>
          <ul>
            {modifiers.data.items.map((modifier) => (
              <li key={modifier.id}>
                <ListRow
                  title={modifier.name}
                  subtitle={modifier.options
                    .map((option) =>
                      option.priceDeltaPaise === 0
                        ? option.name
                        : `${option.name} +${money(option.priceDeltaPaise)}`,
                    )
                    .join(" · ")}
                  meta={
                    <Badge variant="outline">
                      {modifier.isRequired ? "required" : "optional"}
                      {modifier.maxSelections === null
                        ? ""
                        : ` · up to ${String(modifier.maxSelections)}`}
                    </Badge>
                  }
                  actions={
                    <Gate resource="menuModifier" operation="delete">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate({ id: modifier.id });
                        }}
                      >
                        Delete
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
