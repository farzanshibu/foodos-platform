/**
 * SOT: menu-board, dish-list, combo-card, category-rail
 * WHAT   The menu a guest reads and taps.
 * WHY    Every price on this screen came from the server. The combo cards show the hint the
 *        catalogue computed - a flat rate with its strike-through, or a percentage badge -
 *        and nothing here multiplies, discounts or rounds anything.
 * WHERE  apps/web/src/features/table/item-sheet.tsx, combo-sheet.tsx
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Card, CardContent } from "@foodos/ui/card";
import { cn } from "@foodos/ui/lib/utils";
import { useState } from "react";

import { ComboSheet } from "@/features/table/combo-sheet";
import { ItemSheet } from "@/features/table/item-sheet";
import { money } from "@/features/table/money";

type Category = OutputOf<"menuCategory", "read">["items"][number];
type Item = OutputOf<"menuItem", "read">["items"][number];
type Combo = OutputOf<"combo", "read">["items"][number];

const SPICE = ["", "🌶️", "🌶️🌶️", "🌶️🌶️🌶️"] as const;

export function MenuBoard({
  categories,
  items,
  combos,
  branchId,
  orderingEnabled,
}: {
  categories: Category[];
  items: Item[];
  combos: Combo[];
  branchId: string;
  orderingEnabled: boolean;
}) {
  const [openItem, setOpenItem] = useState<Item | null>(null);
  const [openCombo, setOpenCombo] = useState<Combo | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const shown = categories.filter((category) =>
    items.some((item) => item.categoryId === category.id),
  );

  return (
    <div className="space-y-6">
      {shown.length > 1 ? (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {shown.map((category) => (
            <a
              key={category.id}
              href={`#category-${category.id}`}
              onClick={() => {
                setActive(category.id);
              }}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
                active === category.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {category.name}
            </a>
          ))}
        </nav>
      ) : null}

      {combos.length === 0 ? null : (
        <section className="space-y-3">
          <h2 className="font-semibold text-foreground text-lg">Combos</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {combos.map((combo) => (
              <button
                key={combo.id}
                type="button"
                disabled={!orderingEnabled}
                onClick={() => {
                  setOpenCombo(combo);
                }}
                className="text-left disabled:opacity-60"
              >
                <Card className="h-full transition-colors hover:border-primary">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{combo.name}</p>
                      {combo.hint.badge === null ? null : (
                        <Badge variant="secondary">{combo.hint.badge}</Badge>
                      )}
                    </div>
                    {combo.description === null ? null : (
                      <p className="line-clamp-2 text-muted-foreground text-sm">
                        {combo.description}
                      </p>
                    )}
                    <p className="flex items-baseline gap-2">
                      <span className="font-semibold text-foreground">
                        {money(combo.hint.displayPricePaise)}
                      </span>
                      {combo.hint.savingsPaise > 0 ? (
                        <span className="text-muted-foreground text-sm line-through">
                          {money(combo.hint.referencePricePaise)}
                        </span>
                      ) : null}
                    </p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        </section>
      )}

      {shown.map((category) => (
        <section key={category.id} id={`category-${category.id}`} className="space-y-3">
          <h2 className="font-semibold text-foreground text-lg">{category.name}</h2>
          <ul className="space-y-2">
            {items
              .filter((item) => item.categoryId === category.id)
              .map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!orderingEnabled}
                    onClick={() => {
                      setOpenItem(item);
                    }}
                    className="w-full text-left disabled:opacity-60"
                  >
                    <Card className="transition-colors hover:border-primary">
                      <CardContent className="flex items-start gap-3 p-4">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium text-foreground">
                            {item.name}{" "}
                            {item.spiceLevel === null || item.spiceLevel === 0 ? null : (
                              <span title={`Spice level ${String(item.spiceLevel)}`}>
                                {SPICE[item.spiceLevel]}
                              </span>
                            )}
                          </p>
                          {item.description === null ? null : (
                            <p className="line-clamp-2 text-muted-foreground text-sm">
                              {item.description}
                            </p>
                          )}
                          <p className="flex items-center gap-2 text-sm">
                            <span className="font-semibold text-foreground">
                              {money(item.discountPricePaise ?? item.pricePaise)}
                            </span>
                            {item.discountPricePaise === null ? null : (
                              <span className="text-muted-foreground line-through">
                                {money(item.pricePaise)}
                              </span>
                            )}
                            {item.prepTimeMinutes === null ? null : (
                              <span className="text-muted-foreground">
                                · {String(item.prepTimeMinutes)} min
                              </span>
                            )}
                          </p>
                          {item.dietaryLabels.length === 0 ? null : (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {item.dietaryLabels.map((label) => (
                                <Badge key={label} variant="outline" className="text-xs">
                                  {label.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        {item.imageUrl === null ? null : (
                          // biome-ignore lint/performance/noImgElement: menu photos are remote and unsized
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-20 shrink-0 rounded-md border border-border object-cover"
                          />
                        )}
                      </CardContent>
                    </Card>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {shown.length === 0 && combos.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground text-sm">
          This menu is still being set up. Please ask a member of staff.
        </p>
      ) : null}

      {openItem === null ? null : (
        <ItemSheet
          item={openItem}
          onClose={() => {
            setOpenItem(null);
          }}
        />
      )}
      {openCombo === null ? null : (
        <ComboSheet
          combo={openCombo}
          branchId={branchId}
          onClose={() => {
            setOpenCombo(null);
          }}
        />
      )}
    </div>
  );
}
