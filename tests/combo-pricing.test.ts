/**
 * SOT: combo-pricing-assertions, flat-rate-assertions, flat-percentage-assertions
 * WHAT   Plain assertions for the combo pricing engine. Run with
 *        `pnpm tsx --conditions=react-server tests/combo-pricing.test.ts` - the condition is
 *        required because the engine imports `server-only`, which is the point of it.
 * WHY    This is the function that decides what a customer pays. Every rule it enforces is a
 *        rule somebody will otherwise "fix" into a rounding bug or a negative discount.
 * WHERE  services/catalog/src/pricing.ts
 */
import assert from "node:assert/strict";

import {
  type ComboDef,
  type ComboGroupDef,
  comboDisplayHint,
  priceComboSelection,
} from "../services/catalog/src/pricing";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function option(itemId: string, unitPricePaise: number, name = itemId) {
  return { itemId, variantId: null, name, variantName: null, unitPricePaise };
}

function group(
  id: string,
  name: string,
  minSelections: number,
  maxSelections: number | null,
  options: ReadonlyArray<ReturnType<typeof option>>,
): ComboGroupDef {
  return {
    id,
    name,
    minSelections,
    maxSelections,
    allowed: new Map(options.map((entry) => [`${entry.itemId}:`, entry])),
  };
}

/** Biryani ₹220 or veg biryani ₹180, plus two sides from raita ₹30 / soda ₹40 / jamun ₹50. */
function biryaniCombo(overrides: Partial<ComboDef> = {}): ComboDef {
  return {
    id: "cmb_1",
    name: "Biryani Combo",
    pricingMode: "flat_rate",
    flatRatePaise: 29_900,
    flatPercentage: null,
    groups: [
      group("g_main", "Choose your main", 1, 1, [
        option("itm_bir", 22_000, "Chicken Biryani"),
        option("itm_vbir", 18_000, "Veg Biryani"),
      ]),
      group("g_sides", "Pick any 2 sides", 2, 2, [
        option("itm_raita", 3_000, "Raita"),
        option("itm_soda", 4_000, "Lemon Soda"),
        option("itm_jamun", 5_000, "Gulab Jamun"),
      ]),
    ],
    ...overrides,
  };
}

const pick = (groupId: string, itemId: string, quantity = 1) => ({ groupId, itemId, quantity });

const validPick = [
  pick("g_main", "itm_bir"),
  pick("g_sides", "itm_raita"),
  pick("g_sides", "itm_soda"),
];

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

type Check = { name: string; run: () => void };

const checks: Check[] = [
  /* ── Flat rate ─────────────────────────────────────────────────────────── */
  {
    name: "flat rate: the combo price wins and the item prices are ignored",
    run: () => {
      // Parts come to 22000 + 3000 + 4000 = 29000, which is LESS than the 29900 flat rate.
      const priced = priceComboSelection(biryaniCombo(), validPick);
      assert.equal(priced.unitPricePaise, 29_900);
      assert.equal(priced.referencePricePaise, 29_000);
    },
  },
  {
    name: "flat rate: a combo dearer than its parts shows no saving, never a negative one",
    run: () => assert.equal(priceComboSelection(biryaniCombo(), validPick).savingsPaise, 0),
  },
  {
    name: "flat rate below the parts produces exactly that saving",
    run: () => {
      const priced = priceComboSelection(biryaniCombo({ flatRatePaise: 25_000 }), validPick);
      assert.equal(priced.unitPricePaise, 25_000);
      assert.equal(priced.savingsPaise, 4_000);
    },
  },
  {
    name: "flat rate does not move when a member item's price changes",
    run: () => {
      const dearer = biryaniCombo();
      dearer.groups[0]?.allowed.set("itm_bir:", option("itm_bir", 90_000, "Chicken Biryani"));
      assert.equal(priceComboSelection(dearer, validPick).unitPricePaise, 29_900);
    },
  },

  /* ── Flat percentage ───────────────────────────────────────────────────── */
  {
    name: "flat percentage: 15% off the parts, rounded half-up at the paise",
    run: () => {
      // 29000 * 0.85 = 24650 exactly.
      const priced = priceComboSelection(
        biryaniCombo({ pricingMode: "flat_percentage", flatRatePaise: null, flatPercentage: 15 }),
        validPick,
      );
      assert.equal(priced.unitPricePaise, 24_650);
      assert.equal(priced.savingsPaise, 4_350);
    },
  },
  {
    name: "flat percentage rounds half-up rather than truncating",
    run: () => {
      // One side only, 3 paise of parts, 50% off -> 1.5 paise, which must land on 2.
      const tiny: ComboDef = {
        id: "cmb_tiny",
        name: "Tiny",
        pricingMode: "flat_percentage",
        flatRatePaise: null,
        flatPercentage: 50,
        groups: [group("g", "Pick one", 1, 1, [option("itm_a", 3)])],
      };
      assert.equal(priceComboSelection(tiny, [pick("g", "itm_a")]).unitPricePaise, 2);
    },
  },
  {
    name: "flat percentage DOES move when a member item's price changes",
    run: () => {
      const base = biryaniCombo({
        pricingMode: "flat_percentage",
        flatRatePaise: null,
        flatPercentage: 10,
      });
      const before = priceComboSelection(base, validPick).unitPricePaise;
      base.groups[0]?.allowed.set("itm_bir:", option("itm_bir", 32_000, "Chicken Biryani"));
      const after = priceComboSelection(base, validPick).unitPricePaise;
      assert.equal(before, 26_100);
      assert.equal(after, 35_100);
    },
  },
  {
    name: "a fractional percentage keeps its two decimals",
    run: () => {
      // 29000 * (1 - 0.125) = 25375 exactly.
      const priced = priceComboSelection(
        biryaniCombo({
          pricingMode: "flat_percentage",
          flatRatePaise: null,
          flatPercentage: 12.5,
        }),
        validPick,
      );
      assert.equal(priced.unitPricePaise, 25_375);
    },
  },

  /* ── Quantity ──────────────────────────────────────────────────────────── */
  {
    name: "a child's quantity multiplies only the reference price, not the flat rate",
    run: () => {
      const priced = priceComboSelection(biryaniCombo({ flatRatePaise: 25_000 }), [
        pick("g_main", "itm_bir"),
        pick("g_sides", "itm_raita", 3),
        pick("g_sides", "itm_soda"),
      ]);
      // 22000 + (3000 x 3) + 4000 = 35000.
      assert.equal(priced.referencePricePaise, 35_000);
      assert.equal(priced.unitPricePaise, 25_000);
      assert.equal(priced.children.length, 3);
      assert.equal(priced.children.find((line) => line.itemId === "itm_raita")?.quantity, 3);
    },
  },
  {
    name: "children carry the price the item had at pricing time",
    run: () => {
      const priced = priceComboSelection(biryaniCombo(), validPick);
      assert.equal(
        priced.children.find((line) => line.itemId === "itm_bir")?.unitPriceSnapshotPaise,
        22_000,
      );
    },
  },

  /* ── Group rules ───────────────────────────────────────────────────────── */
  {
    name: "refuses a group the combo does not have",
    run: () =>
      assert.match(
        refusal(() => priceComboSelection(biryaniCombo(), [pick("g_nope", "itm_bir")])),
        /no group matching/,
      ),
  },
  {
    name: "refuses an item the group does not allow",
    run: () =>
      assert.match(
        refusal(() =>
          priceComboSelection(biryaniCombo(), [
            pick("g_main", "itm_pizza"),
            pick("g_sides", "itm_raita"),
            pick("g_sides", "itm_soda"),
          ]),
        ),
        /not available in this combo/,
      ),
  },
  {
    name: "refuses fewer choices than minSelections",
    run: () =>
      assert.match(
        refusal(() =>
          priceComboSelection(biryaniCombo(), [
            pick("g_main", "itm_bir"),
            pick("g_sides", "itm_raita"),
          ]),
        ),
        /choose at least 2/,
      ),
  },
  {
    name: "refuses more choices than maxSelections",
    run: () =>
      assert.match(
        refusal(() =>
          priceComboSelection(biryaniCombo(), [
            pick("g_main", "itm_bir"),
            pick("g_sides", "itm_raita"),
            pick("g_sides", "itm_soda"),
            pick("g_sides", "itm_jamun"),
          ]),
        ),
        /choose at most 2/,
      ),
  },
  {
    name: "refuses the same option twice in one group and says to use quantity",
    run: () =>
      assert.match(
        refusal(() =>
          priceComboSelection(biryaniCombo(), [
            pick("g_main", "itm_bir"),
            pick("g_sides", "itm_raita"),
            pick("g_sides", "itm_raita"),
          ]),
        ),
        /Increase its quantity instead/,
      ),
  },
  {
    name: "refuses a group that was not chosen from at all",
    run: () =>
      assert.match(
        refusal(() => priceComboSelection(biryaniCombo(), [pick("g_main", "itm_bir")])),
        /choose at least 2/,
      ),
  },
  {
    name: "refuses a flat-rate combo with no rate rather than pricing it at zero",
    run: () =>
      assert.match(
        refusal(() => priceComboSelection(biryaniCombo({ flatRatePaise: null }), validPick)),
        /has no rate/,
      ),
  },

  /* ── Display hint ──────────────────────────────────────────────────────── */
  {
    name: "the hint prices the CHEAPEST valid configuration, not the first one",
    run: () => {
      // Cheapest: veg biryani 18000 + raita 3000 + soda 4000 = 25000.
      const hint = comboDisplayHint(biryaniCombo());
      assert.equal(hint.referencePricePaise, 25_000);
      assert.equal(hint.displayPricePaise, 29_900);
      assert.equal(hint.savingsPaise, 0);
      assert.equal(hint.badge, null);
    },
  },
  {
    name: "a flat-rate hint below the cheapest parts advertises the saving in rupees",
    run: () => {
      const hint = comboDisplayHint(biryaniCombo({ flatRatePaise: 21_000 }));
      assert.equal(hint.savingsPaise, 4_000);
      assert.equal(hint.badge, "Save ₹40");
    },
  },
  {
    name: "a percentage hint advertises the percentage without a trailing zero",
    run: () => {
      const hint = comboDisplayHint(
        biryaniCombo({ pricingMode: "flat_percentage", flatRatePaise: null, flatPercentage: 15 }),
      );
      assert.equal(hint.displayPricePaise, 21_250);
      assert.equal(hint.badge, "15% off");
    },
  },
  {
    name: "a combo with an empty group is unorderable and its hint says nothing",
    run: () => {
      const empty = biryaniCombo({
        groups: [group("g_main", "Choose your main", 1, 1, [])],
      });
      assert.deepEqual(comboDisplayHint(empty), {
        displayPricePaise: 0,
        referencePricePaise: 0,
        savingsPaise: 0,
        badge: null,
      });
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) process.exit(1);
