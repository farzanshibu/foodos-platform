/**
 * SOT: combo-pricing, pricing-engine, flat-rate, flat-percentage, combo-display-hint
 * WHAT   The one function that decides what a combo costs, and the hint a menu card shows
 *        before anybody has chosen anything.
 * WHY    Server-authoritative pricing is not a preference. A price the client can compute is
 *        a price the client can choose, so this lives behind the bus and the browser only
 *        renders what it is told. It is the reason `quote.read` exists at all.
 * HOW    Pure. It reads no database: the handler loads the combo with current prices and
 *        hands it in, so every rule below is unit-testable without a Postgres. All arithmetic
 *        is integer paise; the single rounding step happens once, where the percentage is
 *        applied, and never on an intermediate line.
 * WHERE  services/catalog/src/quote.handlers.ts, services/catalog/src/pricing.test.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";

export type PricedItemRef = {
  readonly itemId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly variantName: string | null;
  readonly unitPricePaise: number;
};

export type ComboGroupDef = {
  readonly id: string;
  readonly name: string;
  readonly minSelections: number;
  /** Null means no upper bound. */
  readonly maxSelections: number | null;
  /** Keyed `${itemId}:${variantId ?? ""}`, holding only options that are available now. */
  readonly allowed: ReadonlyMap<string, PricedItemRef>;
};

export type ComboDef = {
  readonly id: string;
  readonly name: string;
  readonly pricingMode: "flat_rate" | "flat_percentage";
  readonly flatRatePaise: number | null;
  /** Percent off the sum of the parts, 1 to 99. */
  readonly flatPercentage: number | null;
  readonly groups: readonly ComboGroupDef[];
};

export type ComboSelection = {
  readonly groupId: string;
  readonly itemId: string;
  readonly variantId?: string | undefined;
  readonly quantity: number;
};

export type ComboChildLine = {
  readonly itemId: string;
  readonly variantId: string | null;
  readonly nameSnapshot: string;
  readonly variantNameSnapshot: string | null;
  readonly quantity: number;
  readonly unitPriceSnapshotPaise: number;
};

export type ComboPricing = {
  /** The price of ONE combo. Multiply by the line quantity, never by a child's quantity. */
  readonly unitPricePaise: number;
  /** What the chosen parts would have cost separately. Drives the strike-through. */
  readonly referencePricePaise: number;
  /** Clamped at zero: a combo dearer than its parts shows no saving, not a negative one. */
  readonly savingsPaise: number;
  readonly children: readonly ComboChildLine[];
};

export type ComboDisplayHint = {
  readonly displayPricePaise: number;
  readonly referencePricePaise: number;
  readonly savingsPaise: number;
  readonly badge: string | null;
};

const optionKey = (itemId: string, variantId: string | null | undefined): string =>
  `${itemId}:${variantId ?? ""}`;

const invalid = (message: string): never => {
  throw new ServiceError("INVALID_INPUT", message);
};

/**
 * Half-up at the paise, done with integers so no float ever holds a price. `percent` may
 * carry two decimals, so it is scaled to basis points first and the division is the only
 * place a fraction exists.
 */
function applyPercentOff(subtotalPaise: number, percent: number): number {
  const remainingBasisPoints = 10_000 - Math.round(percent * 100);
  return Math.floor((subtotalPaise * remainingBasisPoints + 5_000) / 10_000);
}

/**
 * Prices one combo line's selection.
 *
 * A flat-rate combo ignores what its parts cost - that is the entire meaning of the mode,
 * and the reference price is computed anyway so the card can still show what was saved.
 * A percentage combo is derived from the parts as they are priced *right now*, which is why
 * this is called at order time and not read from something written when the combo was built.
 */
export function priceComboSelection(
  combo: ComboDef,
  selections: readonly ComboSelection[],
): ComboPricing {
  const byGroup = bucketByGroup(combo, selections);

  const children: ComboChildLine[] = [];
  let referencePricePaise = 0;

  for (const group of combo.groups) {
    for (const child of pricedChildrenOf(group, byGroup.get(group.id) ?? [])) {
      referencePricePaise += child.unitPriceSnapshotPaise * child.quantity;
      children.push(child);
    }
  }

  const unitPricePaise = unitPriceOf(combo, referencePricePaise);

  return {
    unitPricePaise,
    referencePricePaise,
    savingsPaise: Math.max(0, referencePricePaise - unitPricePaise),
    children,
  };
}

/** Every selection must name a group this combo actually has, before anything is priced. */
function bucketByGroup(
  combo: ComboDef,
  selections: readonly ComboSelection[],
): ReadonlyMap<string, ComboSelection[]> {
  const byGroup = new Map<string, ComboSelection[]>();
  for (const selection of selections) {
    if (!combo.groups.some((candidate) => candidate.id === selection.groupId)) {
      return invalid(`"${combo.name}" has no group matching one of the choices.`);
    }
    const bucket = byGroup.get(selection.groupId);
    if (bucket === undefined) byGroup.set(selection.groupId, [selection]);
    else bucket.push(selection);
  }
  return byGroup;
}

/**
 * One group's rules, then its lines. Split out so the pricing function above stays a
 * summation and this stays the place every "you cannot order that" message is written.
 */
function pricedChildrenOf(
  group: ComboGroupDef,
  chosen: readonly ComboSelection[],
): readonly ComboChildLine[] {
  /**
   * The same option twice in one group is a picker bug, and merging it silently would turn
   * that bug into a price. The caller means quantity, and quantity is a field they have.
   */
  const seen = new Set<string>();
  for (const selection of chosen) {
    const key = optionKey(selection.itemId, selection.variantId);
    if (seen.has(key)) {
      return invalid(`"${group.name}": the same choice twice. Increase its quantity instead.`);
    }
    seen.add(key);
  }

  if (chosen.length < group.minSelections) {
    return invalid(`"${group.name}": choose at least ${group.minSelections}.`);
  }
  if (group.maxSelections !== null && chosen.length > group.maxSelections) {
    return invalid(`"${group.name}": choose at most ${group.maxSelections}.`);
  }

  return chosen.map((selection) => {
    const option = group.allowed.get(optionKey(selection.itemId, selection.variantId));
    if (option === undefined) {
      return invalid(`"${group.name}": that choice is not available in this combo.`);
    }
    return {
      itemId: option.itemId,
      variantId: option.variantId,
      nameSnapshot: option.name,
      variantNameSnapshot: option.variantName,
      quantity: selection.quantity,
      unitPriceSnapshotPaise: option.unitPricePaise,
    };
  });
}

function unitPriceOf(combo: ComboDef, referencePricePaise: number): number {
  if (combo.pricingMode === "flat_rate") {
    if (combo.flatRatePaise === null) {
      return invalid(`"${combo.name}" is priced at a flat rate but has no rate.`);
    }
    return combo.flatRatePaise;
  }
  if (combo.flatPercentage === null) {
    return invalid(`"${combo.name}" is priced by percentage but has no percentage.`);
  }
  return applyPercentOff(referencePricePaise, combo.flatPercentage);
}

/**
 * What a menu card shows before a choice has been made: the cheapest configuration the combo
 * allows. It is a hint and nothing else - `quote.read` prices the actual cart, and the two
 * will differ the moment somebody picks something dearer than the cheapest option.
 *
 * A group with no available options makes the whole combo unorderable, so the hint says the
 * parts are worth nothing rather than inventing a price for a combo nobody can complete.
 */
export function comboDisplayHint(combo: ComboDef): ComboDisplayHint {
  let referencePricePaise = 0;
  for (const group of combo.groups) {
    const prices = [...group.allowed.values()]
      .map((option) => option.unitPricePaise)
      .sort((left, right) => left - right);
    if (prices.length === 0) {
      return { displayPricePaise: 0, referencePricePaise: 0, savingsPaise: 0, badge: null };
    }
    for (let picked = 0; picked < group.minSelections; picked += 1) {
      /** Cheapest first, and the cheapest option repeats once the list runs out. */
      referencePricePaise += prices[Math.min(picked, prices.length - 1)] ?? 0;
    }
  }

  const displayPricePaise = unitPriceOf(combo, referencePricePaise);
  const savingsPaise = Math.max(0, referencePricePaise - displayPricePaise);

  return {
    displayPricePaise,
    referencePricePaise,
    savingsPaise,
    badge:
      combo.pricingMode === "flat_percentage" && combo.flatPercentage !== null
        ? `${trimPercent(combo.flatPercentage)}% off`
        : savingsPaise > 0
          ? `Save ₹${(savingsPaise / 100).toFixed(savingsPaise % 100 === 0 ? 0 : 2)}`
          : null,
  };
}

/** 15 rather than 15.00, but 12.5 stays 12.5. A trailing zero in a badge reads as noise. */
function trimPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(2)));
}
