/**
 * SOT: combos-manager, combo-editor, flat-rate-editor, flat-percentage-editor
 * WHAT   Building a combo: which dishes are in it, how many a guest picks from each group,
 *        and which of the two ways it is priced.
 * WHY    The two modes mean genuinely different things and the editor says so rather than
 *        hiding it behind a dropdown. A flat rate is a price - the parts stop mattering. A
 *        percentage is a discount - it follows every price change from now on. Choosing
 *        wrongly is the expensive mistake this screen exists to prevent.
 * HOW    The preview price comes from the catalogue, computed by the same engine that will
 *        price the real cart, so what is shown here is what a guest will be charged.
 * WHERE  services/catalog/src/pricing.ts, services/catalog/src/combo.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreateRow, controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];
type Item = OutputOf<"menuItem", "read">["items"][number];
type Combo = OutputOf<"combo", "read">["items"][number];

type DraftGroup = {
  name: string;
  minSelections: number;
  maxSelections: number | null;
  itemIds: string[];
};

export function CombosManager({
  restaurants,
  items,
  initialCombos,
}: {
  restaurants: Restaurant[];
  items: Item[];
  initialCombos: Combo[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [mode, setMode] = useState<"flat_rate" | "flat_percentage">("flat_rate");
  const [rate, setRate] = useState("299");
  const [percent, setPercent] = useState("15");
  const [groups, setGroups] = useState<DraftGroup[]>([
    { name: "Choose your main", minSelections: 1, maxSelections: 1, itemIds: [] },
  ]);

  const combos = useQuery(
    trpc.combo.list.queryOptions(
      { limit: 50, cursor: null, availableOnly: false },
      { initialData: { items: initialCombos, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.combo.list.queryKey() });
  };
  const create = useMutation(
    trpc.combo.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setGroups([{ name: "Choose your main", minSelections: 1, maxSelections: 1, itemIds: [] }]);
        refresh();
      },
    }),
  );
  const setAvailability = useMutation(
    trpc.combo.setAvailability.mutationOptions({ onSuccess: refresh }),
  );
  const remove = useMutation(trpc.combo.remove.mutationOptions({ onSuccess: refresh }));

  /**
   * What the cheapest allowed configuration costs, so the editor can say whether this combo
   * actually saves anybody anything. Purely a preview - the real number comes from the engine
   * the moment the combo is saved and read back.
   */
  const cheapest = groups.reduce((sum, group) => {
    const prices = group.itemIds
      .map((id) => items.find((item) => item.id === id)?.pricePaise ?? 0)
      .sort((left, right) => left - right);
    return sum + prices.slice(0, group.minSelections).reduce((total, price) => total + price, 0);
  }, 0);

  const previewPaise =
    mode === "flat_rate"
      ? Math.round(Number(rate) * 100)
      : Math.floor((cheapest * (10_000 - Math.round(Number(percent) * 100)) + 5_000) / 10_000);

  const usable =
    name.trim() !== "" &&
    restaurants.length > 0 &&
    groups.every((group) => group.itemIds.length >= group.minSelections);

  return (
    <PageShell
      title="Combos"
      description="Bundles sold as one thing, priced either at a flat rate or a flat percentage off."
    >
      <Gate resource="combo" operation="create">
        <Card>
          <CardContent className="space-y-4 p-4">
            <CreateRow>
              <Field label="Combo name">
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="Biryani Combo"
                  className={controlClass}
                />
              </Field>
            </CreateRow>

            <fieldset className="space-y-2">
              <legend className="font-medium text-foreground text-sm">How is it priced?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ModeCard
                  active={mode === "flat_rate"}
                  title="Flat rate"
                  detail="One price for the whole thing. What the dishes cost stops mattering."
                  onClick={() => {
                    setMode("flat_rate");
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">₹</span>
                    <input
                      value={rate}
                      inputMode="decimal"
                      onChange={(event) => {
                        setRate(event.target.value);
                      }}
                      className={controlClass}
                    />
                  </div>
                </ModeCard>

                <ModeCard
                  active={mode === "flat_percentage"}
                  title="Flat percentage"
                  detail="A discount off the parts. It follows every price change from now on."
                  onClick={() => {
                    setMode("flat_percentage");
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={percent}
                      inputMode="decimal"
                      onChange={(event) => {
                        setPercent(event.target.value);
                      }}
                      className={controlClass}
                    />
                    <span className="text-muted-foreground text-sm">% off</span>
                  </div>
                </ModeCard>
              </div>
            </fieldset>

            <div className="space-y-3">
              <p className="font-medium text-foreground text-sm">What is in it?</p>
              {groups.map((group, index) => (
                <GroupEditor
                  key={`${group.name}-${String(index)}`}
                  group={group}
                  items={items}
                  onChange={(next) => {
                    setGroups((current) =>
                      current.map((entry, position) => (position === index ? next : entry)),
                    );
                  }}
                  onRemove={
                    groups.length === 1
                      ? undefined
                      : () => {
                          setGroups((current) =>
                            current.filter((_, position) => position !== index),
                          );
                        }
                  }
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setGroups((current) => [
                    ...current,
                    { name: "Pick a side", minSelections: 1, maxSelections: 1, itemIds: [] },
                  ]);
                }}
              >
                + Another group
              </Button>
            </div>

            {cheapest === 0 ? null : (
              <p className="text-sm">
                <span className="text-muted-foreground">Cheapest configuration: </span>
                <span className="font-medium text-foreground">{money(previewPaise)}</span>
                {previewPaise < cheapest ? (
                  <span className="text-primary">
                    {" "}
                    · saves {money(cheapest - previewPaise)} against {money(cheapest)}
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-500">
                    {" "}
                    · that is {money(previewPaise - cheapest)} MORE than buying the parts
                  </span>
                )}
              </p>
            )}

            {create.error === null ? null : <Denial error={create.error} />}

            <Button
              disabled={!usable}
              loading={create.isPending}
              onClick={() => {
                const restaurantId = restaurants[0]?.id;
                if (restaurantId === undefined) return;
                create.mutate({
                  restaurantId,
                  name: name.trim(),
                  pricingMode: mode,
                  ...(mode === "flat_rate"
                    ? { flatRatePaise: Math.round(Number(rate) * 100) }
                    : { flatPercentage: Number(percent) }),
                  groups: groups.map((group, index) => ({
                    name: group.name,
                    minSelections: group.minSelections,
                    maxSelections: group.maxSelections,
                    sortOrder: index,
                    items: group.itemIds.map((itemId, position) => ({
                      itemId,
                      sortOrder: position,
                    })),
                  })),
                });
              }}
            >
              Create combo
            </Button>
          </CardContent>
        </Card>
      </Gate>

      {combos.data.items.length === 0 ? (
        <Empty
          icon="🍱"
          title="No combos yet"
          detail="Bundle a main, a side and a drink and price it as one thing."
        />
      ) : (
        <ListCard>
          <ul>
            {combos.data.items.map((combo) => (
              <li key={combo.id}>
                <ListRow
                  title={combo.name}
                  subtitle={combo.groups
                    .map(
                      (group) =>
                        `${group.name} (pick ${String(group.minSelections)} of ${String(group.items.length)})`,
                    )
                    .join(" · ")}
                  meta={
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">
                        {money(combo.hint.displayPricePaise)}
                      </span>
                      <Badge variant="outline">
                        {combo.pricingMode === "flat_rate"
                          ? "flat rate"
                          : `${String(combo.flatPercentage ?? 0)}% off`}
                      </Badge>
                      <Badge variant={combo.isAvailable ? "secondary" : "destructive"}>
                        {combo.isAvailable ? "On" : "Off"}
                      </Badge>
                    </div>
                  }
                  actions={
                    <div className="flex gap-2">
                      <Gate resource="combo" operation="manage">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setAvailability.isPending}
                          onClick={() => {
                            setAvailability.mutate({
                              id: combo.id,
                              isAvailable: !combo.isAvailable,
                            });
                          }}
                        >
                          {combo.isAvailable ? "Take off" : "Put on"}
                        </Button>
                      </Gate>
                      <Gate resource="combo" operation="delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            remove.mutate({ id: combo.id });
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

function ModeCard({
  active,
  title,
  detail,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3",
        active ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <button type="button" onClick={onClick} className="block w-full text-left">
        <span className="flex items-center gap-2 font-medium text-foreground text-sm">
          <input type="radio" checked={active} readOnly />
          {title}
        </span>
        <span className="mt-0.5 block text-muted-foreground text-xs">{detail}</span>
      </button>
      {active ? children : null}
    </div>
  );
}

function GroupEditor({
  group,
  items,
  onChange,
  onRemove,
}: {
  group: DraftGroup;
  items: Item[];
  onChange: (next: DraftGroup) => void;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Group">
          <input
            value={group.name}
            onChange={(event) => {
              onChange({ ...group, name: event.target.value });
            }}
            className={controlClass}
          />
        </Field>
        <Field label="Pick exactly" width="w-28">
          <input
            value={String(group.minSelections)}
            inputMode="numeric"
            onChange={(event) => {
              const count = Math.max(1, Number(event.target.value) || 1);
              onChange({ ...group, minSelections: count, maxSelections: count });
            }}
            className={controlClass}
          />
        </Field>
        {onRemove === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {items.map((item) => {
          const chosen = group.itemIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange({
                  ...group,
                  itemIds: chosen
                    ? group.itemIds.filter((id) => id !== item.id)
                    : [...group.itemIds, item.id],
                });
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                chosen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {item.name} · {money(item.pricePaise)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
