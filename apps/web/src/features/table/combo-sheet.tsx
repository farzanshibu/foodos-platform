/**
 * SOT: combo-sheet, combo-picker, live-combo-price
 * WHAT   Picking a combo: one choice per group, within that group's rules, with the price
 *        updating as the choices change.
 * WHY    The price shown while picking is the SERVER'S price. Every change asks the catalogue
 *        to price that exact selection and renders what comes back - which is why a
 *        flat-rate combo does not move when a dearer main is chosen, and a percentage one
 *        does. Reimplementing that here would be two engines that eventually disagree.
 * HOW    The group rules gate the button so it explains itself before it is pressed; the same
 *        rules are enforced again in the engine, because a rule only in a browser is not one.
 * WHERE  services/catalog/src/pricing.ts
 */
"use client";

import type { InputOf, OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { cn } from "@foodos/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { money } from "@/features/table/money";
import { Sheet } from "@/features/table/sheet";
import { useTableCart } from "@/features/table/table-cart-provider";
import { useTRPC } from "@/trpc/react";

type Combo = OutputOf<"combo", "read">["items"][number];
type Selection = Extract<
  InputOf<"quote", "read">["lines"][number],
  { kind: "combo" }
>["selections"][number];

export function ComboSheet({
  combo,
  branchId,
  onClose,
}: {
  combo: Combo;
  branchId: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { add } = useTableCart();
  const [quantity, setQuantity] = useState(1);

  /** Each group starts on its cheapest options, so the sheet opens with a real price. */
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      combo.groups.map((group) => [
        group.id,
        [...group.items]
          .sort((left, right) => left.unitPricePaise - right.unitPricePaise)
          .slice(0, group.minSelections)
          .map((item) => item.itemId),
      ]),
    ),
  );

  const selections: Selection[] = useMemo(
    () =>
      combo.groups.flatMap((group) =>
        (picked[group.id] ?? []).map((itemId) => ({ groupId: group.id, itemId, quantity: 1 })),
      ),
    [combo.groups, picked],
  );

  const unmet = combo.groups.find((group) => {
    const held = (picked[group.id] ?? []).length;
    if (held < group.minSelections) return true;
    return group.maxSelections !== null && held > group.maxSelections;
  });

  /**
   * The live price. Only asked once the selection is valid, because an invalid one is
   * something the engine correctly refuses and a refusal is not a price to render.
   */
  const quote = useQuery(
    trpc.quote.price.queryOptions(
      {
        branchId,
        lines: [{ kind: "combo", comboId: combo.id, quantity: 1, selections }],
        orderType: "dine_in",
      },
      { enabled: unmet === undefined && selections.length > 0 },
    ),
  );

  const line = quote.data?.lines[0];
  const priced = line?.kind === "combo" ? line : null;

  const toggle = (groupId: string, itemId: string, max: number | null) => {
    setPicked((current) => {
      const held = current[groupId] ?? [];
      if (held.includes(itemId)) {
        return { ...current, [groupId]: held.filter((id) => id !== itemId) };
      }
      if (max === 1) return { ...current, [groupId]: [itemId] };
      if (max !== null && held.length >= max) {
        /** At the cap, the newest choice replaces the oldest rather than being ignored. */
        return { ...current, [groupId]: [...held.slice(1), itemId] };
      }
      return { ...current, [groupId]: [...held, itemId] };
    });
  };

  return (
    <Sheet
      title={combo.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {priced === null ? null : (
            <p className="flex items-baseline gap-2 text-sm">
              <span className="font-semibold text-foreground text-base">
                {money(priced.unitPricePaise * quantity)}
              </span>
              {priced.savingsPaise > 0 ? (
                <>
                  <span className="text-muted-foreground line-through">
                    {money(priced.referencePricePaise * quantity)}
                  </span>
                  <span className="text-primary">
                    You save {money(priced.savingsPaise * quantity)}
                  </span>
                </>
              ) : null}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuantity((value) => Math.max(1, value - 1));
                }}
              >
                −
              </Button>
              <span className="w-8 text-center font-medium text-sm">{quantity}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuantity((value) => Math.min(20, value + 1));
                }}
              >
                +
              </Button>
            </div>
            <Button
              className="flex-1"
              disabled={unmet !== undefined}
              onClick={() => {
                add({ kind: "combo", comboId: combo.id, quantity, selections });
                onClose();
              }}
            >
              {unmet === undefined ? "Add to cart" : `Choose ${unmet.name}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {combo.description === null ? null : (
          <p className="text-muted-foreground text-sm">{combo.description}</p>
        )}

        {combo.groups.map((group) => {
          const held = (picked[group.id] ?? []).length;
          return (
            <fieldset key={group.id} className="space-y-2">
              <legend className="font-medium text-foreground text-sm">
                {group.name}{" "}
                <span className="font-normal text-muted-foreground">
                  ·{" "}
                  {group.maxSelections === group.minSelections
                    ? `pick ${String(group.minSelections)}`
                    : `pick ${String(group.minSelections)}${
                        group.maxSelections === null
                          ? " or more"
                          : `–${String(group.maxSelections)}`
                      }`}{" "}
                  ({String(held)} chosen)
                </span>
              </legend>
              {group.items.map((option) => {
                const chosen = (picked[group.id] ?? []).includes(option.itemId);
                return (
                  <label
                    key={`${option.itemId}:${option.variantId ?? ""}`}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm",
                      chosen ? "border-primary" : "border-border",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type={group.maxSelections === 1 ? "radio" : "checkbox"}
                        name={group.id}
                        checked={chosen}
                        onChange={() => {
                          toggle(group.id, option.itemId, group.maxSelections);
                        }}
                      />
                      {option.name}
                      {option.variantName === null ? null : (
                        <span className="text-muted-foreground">({option.variantName})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">{money(option.unitPricePaise)}</span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}

        {combo.pricingMode === "flat_percentage" && combo.hint.badge !== null ? (
          <Badge variant="secondary">{combo.hint.badge} on everything you pick</Badge>
        ) : null}
      </div>
    </Sheet>
  );
}
