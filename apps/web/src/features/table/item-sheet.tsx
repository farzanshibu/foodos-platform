/**
 * SOT: item-sheet, dish-picker, modifier-picker
 * WHAT   Picking a dish: its size, its add-ons, how many, and a note for the kitchen.
 * WHY    The min/max rules on a modifier group are enforced here so the button explains
 *        itself before it is pressed - but they are enforced again in the catalogue when the
 *        cart is priced, because a rule only in a browser is not a rule.
 * WHERE  services/catalog/src/quote.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Button } from "@foodos/ui/button";
import { cn } from "@foodos/ui/lib/utils";
import { useState } from "react";
import { money } from "@/features/table/money";
import { Sheet } from "@/features/table/sheet";
import { useTableCart } from "@/features/table/table-cart-provider";

type Item = OutputOf<"menuItem", "read">["items"][number];

export function ItemSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const { add } = useTableCart();
  const [variantId, setVariantId] = useState<string | undefined>(
    item.variants.find((variant) => variant.isDefault)?.id ?? item.variants[0]?.id,
  );
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      item.modifiers.map((modifier) => [
        modifier.id,
        modifier.options.filter((option) => option.isDefault).map((option) => option.id),
      ]),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const toggle = (modifierId: string, optionId: string, single: boolean) => {
    setChosen((current) => {
      const held = current[modifierId] ?? [];
      if (single) return { ...current, [modifierId]: held.includes(optionId) ? [] : [optionId] };
      return {
        ...current,
        [modifierId]: held.includes(optionId)
          ? held.filter((id) => id !== optionId)
          : [...held, optionId],
      };
    });
  };

  /** The same rules the catalogue will apply, stated up front rather than after a refusal. */
  const unmet = item.modifiers.find((modifier) => {
    const held = (chosen[modifier.id] ?? []).length;
    if (modifier.isRequired && held < Math.max(1, modifier.minSelections)) return true;
    return modifier.maxSelections !== null && held > modifier.maxSelections;
  });

  const base =
    item.variants.find((variant) => variant.id === variantId)?.pricePaise ??
    item.discountPricePaise ??
    item.pricePaise;

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
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
                setQuantity((value) => Math.min(50, value + 1));
              }}
            >
              +
            </Button>
          </div>
          <Button
            className="flex-1"
            disabled={unmet !== undefined}
            onClick={() => {
              add({
                kind: "item",
                itemId: item.id,
                ...(variantId === undefined ? {} : { variantId }),
                quantity,
                modifiers: Object.entries(chosen)
                  .filter(([, optionIds]) => optionIds.length > 0)
                  .map(([modifierId, optionIds]) => ({ modifierId, optionIds })),
                ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
              });
              onClose();
            }}
          >
            {unmet === undefined ? `Add · ${money(base * quantity)}` : `Choose ${unmet.name}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {item.description === null ? null : (
          <p className="text-muted-foreground text-sm">{item.description}</p>
        )}

        {item.allergens.length === 0 ? null : (
          <p className="text-muted-foreground text-xs">Contains: {item.allergens.join(", ")}</p>
        )}

        {item.variants.length === 0 ? null : (
          <fieldset className="space-y-2">
            <legend className="font-medium text-foreground text-sm">Size</legend>
            {item.variants.map((variant) => (
              <label
                key={variant.id}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm",
                  variantId === variant.id ? "border-primary" : "border-border",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="variant"
                    checked={variantId === variant.id}
                    onChange={() => {
                      setVariantId(variant.id);
                    }}
                  />
                  {variant.name}
                </span>
                <span className="text-muted-foreground">{money(variant.pricePaise)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {item.modifiers.map((modifier) => {
          const single = modifier.maxSelections === 1;
          return (
            <fieldset key={modifier.id} className="space-y-2">
              <legend className="font-medium text-foreground text-sm">
                {modifier.name}{" "}
                <span className="font-normal text-muted-foreground">
                  {modifier.isRequired ? "· required" : "· optional"}
                  {modifier.maxSelections === null
                    ? ""
                    : ` · up to ${String(modifier.maxSelections)}`}
                </span>
              </legend>
              {modifier.options.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm",
                    (chosen[modifier.id] ?? []).includes(option.id)
                      ? "border-primary"
                      : "border-border",
                    option.isAvailable ? "" : "opacity-50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={modifier.id}
                      disabled={!option.isAvailable}
                      checked={(chosen[modifier.id] ?? []).includes(option.id)}
                      onChange={() => {
                        toggle(modifier.id, option.id, single);
                      }}
                    />
                    {option.name}
                  </span>
                  {option.priceDeltaPaise === 0 ? null : (
                    <span className="text-muted-foreground">+{money(option.priceDeltaPaise)}</span>
                  )}
                </label>
              ))}
            </fieldset>
          );
        })}

        <label className="block space-y-1">
          <span className="font-medium text-foreground text-sm">Anything to tell the kitchen?</span>
          <input
            value={notes}
            maxLength={200}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
            placeholder="Less spicy, no onion…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Sheet>
  );
}
