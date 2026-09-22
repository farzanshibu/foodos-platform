/**
 * SOT: menu-csv-assertions, import-parser-assertions, round-trip-assertions
 * WHAT   Plain assertions for the CSV a restaurant hands to the menu importer, and for the
 *        round trip between it and the exporter. Run with
 *        `pnpm tsx --conditions=react-server tests/menu-csv.test.ts` - the condition is
 *        required because the exporter imports `server-only`.
 * WHY    This parser is the only thing standing between a spreadsheet and a live menu, and
 *        the failure it exists to prevent is silent: a line that cannot be read has to come
 *        out as a rejection with its row number, never as one fewer row. Every assertion here
 *        is a way somebody could later "simplify" that guarantee away.
 * WHERE  apps/web/src/features/manage/menu-csv.ts, services/catalog/src/menu-csv.ts
 */
import assert from "node:assert/strict";

import { parseMenuCsv } from "../apps/web/src/features/manage/menu-csv";
import { MENU_CSV_COLUMNS } from "../packages/contracts/src/resources/catalog.contract";
import { menuCsv } from "../services/catalog/src/menu-csv";

const HEADER = MENU_CSV_COLUMNS.join(",");

/** A file body under the real header, so a column added to the format breaks these too. */
const file = (...lines: string[]): string => [HEADER, ...lines].join("\r\n");

function parsed(text: string) {
  const result = parseMenuCsv(text);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.problem}`);
  return result;
}

function refused(text: string): string {
  const result = parseMenuCsv(text);
  return result.ok ? "" : result.problem;
}

type Check = { name: string; run: () => void };

const checks: Check[] = [
  {
    name: "a plain row becomes a row, with rupees turned into integer paise",
    run: () => {
      const result = parsed(file(",Biryani,Chicken Biryani,,220.50,,,,,,,,yes"));
      assert.equal(result.totalRows, 1);
      assert.equal(result.rejected.length, 0);
      const [row] = result.rows;
      assert.ok(row !== undefined);
      assert.equal(row.pricePaise, 22_050);
      assert.equal(row.itemId, null);
      assert.equal(row.category, "Biryani");
      assert.equal(row.name, "Chicken Biryani");
      assert.equal(row.isAvailable, true);
      assert.equal(row.rowNumber, 2);
    },
  },
  {
    name: "220 means two hundred and twenty rupees, not two rupees twenty",
    run: () => {
      const [row] = parsed(file(",Biryani,Chicken Biryani,,220,,,,,,,,yes")).rows;
      assert.equal(row?.pricePaise, 22_000);
    },
  },
  {
    name: "a price the binary cannot hold exactly still converts exactly",
    run: () => {
      const [row] = parsed(file(",Biryani,Chicken Biryani,,220.55,,,,,,,,yes")).rows;
      assert.equal(row?.pricePaise, 22_055);
    },
  },
  {
    name: "a third decimal place is refused rather than rounded behind the manager's back",
    run: () => {
      const result = parsed(file(",Biryani,Chicken Biryani,,220.555,,,,,,,,yes"));
      assert.equal(result.rows.length, 0);
      assert.equal(result.rejected[0]?.rowNumber, 2);
      assert.match(result.rejected[0]?.reason ?? "", /two decimals/);
    },
  },
  {
    name: "a malformed row is rejected with its row number, never dropped",
    run: () => {
      const result = parsed(
        file(
          ",Biryani,Chicken Biryani,,220,,,,,,,,yes",
          ",Biryani,,,180,,,,,,,,yes",
          ",Biryani,Veg Biryani,,abc,,,,,,,,yes",
          ",Biryani,Mutton Biryani,,320,,,,,,,,yes",
        ),
      );
      assert.equal(result.totalRows, 4);
      assert.equal(result.rows.length + result.rejected.length, 4);
      assert.deepEqual(
        result.rejected.map((entry) => entry.rowNumber),
        [3, 4],
      );
    },
  },
  {
    name: "one line collects every problem it has, so it is fixed once",
    run: () => {
      const result = parsed(file(",,,,abc,,,,,,,,maybe"));
      const reason = result.rejected[0]?.reason ?? "";
      assert.match(reason, /dish name is empty/);
      assert.match(reason, /section is empty/);
      assert.match(reason, /not an amount in rupees/);
      assert.match(reason, /not yes or no/);
    },
  },
  {
    name: "a quoted field may hold the comma in 'Chicken 65, half'",
    run: () => {
      const [row] = parsed(file(',Starters,"Chicken 65, half",,180,,,,,,,,yes')).rows;
      assert.equal(row?.name, "Chicken 65, half");
    },
  },
  {
    name: "a doubled quote inside a quoted field is one quote",
    run: () => {
      const [row] = parsed(file(',Starters,"The ""Big"" Platter",,180,,,,,,,,yes')).rows;
      assert.equal(row?.name, 'The "Big" Platter');
    },
  },
  {
    name: "a quoted field may hold a line break without ending the row",
    run: () => {
      const result = parsed(file(',Starters,Papad,"Crisp,\r\nvery crisp",40,,,,,,,,yes'));
      assert.equal(result.totalRows, 1);
      assert.equal(result.rows[0]?.description, "Crisp,\r\nvery crisp");
    },
  },
  {
    name: "an id in the first column travels, so an exported file updates in place",
    run: () => {
      const [row] = parsed(file("itm_1,Biryani,Chicken Biryani,,220,,,,,,,,yes")).rows;
      assert.equal(row?.itemId, "itm_1");
    },
  },
  {
    name: "blank lines are not rows and do not shift the row numbers after them",
    run: () => {
      const result = parsed(
        file(
          ",Biryani,Chicken Biryani,,220,,,,,,,,yes",
          "",
          ",Biryani,Veg Biryani,,180,,,,,,,,yes",
        ),
      );
      assert.equal(result.totalRows, 2);
      assert.deepEqual(
        result.rows.map((row) => row.rowNumber),
        [2, 4],
      );
    },
  },
  {
    name: "an offer price and the flags survive the trip",
    run: () => {
      const [row] = parsed(
        file(
          ",Biryani,Chicken Biryani,Our best,220,199,SKU-1,25,650,2,vegetarian|jain,nuts|dairy,no",
        ),
      ).rows;
      assert.equal(row?.discountPricePaise, 19_900);
      assert.equal(row?.sku, "SKU-1");
      assert.equal(row?.prepTimeMinutes, 25);
      assert.equal(row?.calories, 650);
      assert.equal(row?.spiceLevel, 2);
      assert.deepEqual(row?.dietaryLabels, ["vegetarian", "jain"]);
      assert.deepEqual(row?.allergens, ["nuts", "dairy"]);
      assert.equal(row?.isAvailable, false);
    },
  },
  {
    name: "a dietary label nobody serves is named back rather than swallowed",
    run: () => {
      const result = parsed(file(",Biryani,Chicken Biryani,,220,,,,,,vegn,,yes"));
      assert.equal(result.rows.length, 0);
      assert.match(result.rejected[0]?.reason ?? "", /not a dietary label/);
    },
  },
  {
    name: "a spice level outside 0-3 is refused",
    run: () => {
      const result = parsed(file(",Biryani,Chicken Biryani,,220,,,,,9,,,yes"));
      assert.match(result.rejected[0]?.reason ?? "", /spice level has to be between 0 and 3/);
    },
  },
  {
    name: "a price in paise typed into the rupee column is caught by the ceiling",
    run: () => {
      const result = parsed(file(",Biryani,Chicken Biryani,,22000000,,,,,,,,yes"));
      assert.match(result.rejected[0]?.reason ?? "", /above the/);
    },
  },
  {
    name: "a byte-order mark does not hide the first column from the header check",
    run: () => {
      const result = parseMenuCsv(`﻿${file(",Biryani,Chicken Biryani,,220,,,,,,,,yes")}`);
      assert.equal(result.ok, true);
    },
  },
  {
    name: "a file without the columns it needs is refused whole, not row by row",
    run: () => {
      assert.match(refused("dish,cost\r\nBiryani,220"), /no category or name or price_rupees/);
      assert.match(refused(""), /empty/);
      assert.match(refused(HEADER), /no dishes/);
    },
  },
  {
    name: "the row count is taken from the file, so a lost row fails the service's arithmetic",
    run: () => {
      const result = parsed(
        file(
          ",Biryani,A,,220,,,,,,,,yes",
          ",Biryani,B,,abc,,,,,,,,yes",
          ",Biryani,C,,240,,,,,,,,yes",
        ),
      );
      assert.equal(result.totalRows, result.rows.length + result.rejected.length);
      assert.equal(result.totalRows, 3);
    },
  },
  {
    name: "the exporter writes the header the parser demands",
    run: () => {
      assert.equal(menuCsv([]).trimEnd(), HEADER);
    },
  },
  {
    name: "what the exporter writes is what the parser reads: a round trip changes nothing",
    run: () => {
      const exported = menuCsv([
        {
          id: "itm_1",
          categoryName: "Biryani",
          name: 'Chicken "65", half',
          description: "Slow cooked,\r\nvery slow",
          pricePaise: 22_000,
          discountPricePaise: 19_950,
          sku: "SKU-1",
          prepTimeMinutes: 25,
          calories: 650,
          spiceLevel: 2,
          dietaryLabels: ["vegetarian", "jain"],
          allergens: ["nuts", "dairy"],
          isAvailable: false,
        },
      ]);
      const result = parsed(exported);
      assert.equal(result.totalRows, 1);
      assert.equal(result.rejected.length, 0);
      const [row] = result.rows;
      assert.equal(row?.itemId, "itm_1");
      assert.equal(row?.category, "Biryani");
      assert.equal(row?.name, 'Chicken "65", half');
      assert.equal(row?.description, "Slow cooked,\r\nvery slow");
      assert.equal(row?.pricePaise, 22_000);
      assert.equal(row?.discountPricePaise, 19_950);
      assert.equal(row?.sku, "SKU-1");
      assert.equal(row?.prepTimeMinutes, 25);
      assert.equal(row?.calories, 650);
      assert.equal(row?.spiceLevel, 2);
      assert.deepEqual(row?.dietaryLabels, ["vegetarian", "jain"]);
      assert.deepEqual(row?.allergens, ["nuts", "dairy"]);
      assert.equal(row?.isAvailable, false);
    },
  },
  {
    name: "an item with nothing optional filled in still round-trips",
    run: () => {
      const exported = menuCsv([
        {
          id: "itm_2",
          categoryName: "Breads",
          name: "Chapati",
          description: null,
          pricePaise: 1_500,
          discountPricePaise: null,
          sku: null,
          prepTimeMinutes: null,
          calories: null,
          spiceLevel: null,
          dietaryLabels: [],
          allergens: [],
          isAvailable: true,
        },
      ]);
      const [row] = parsed(exported).rows;
      assert.equal(row?.pricePaise, 1_500);
      assert.equal(row?.description, null);
      assert.equal(row?.discountPricePaise, null);
      assert.equal(row?.sku, null);
      assert.equal(row?.prepTimeMinutes, null);
      assert.equal(row?.calories, null);
      assert.equal(row?.spiceLevel, null);
      assert.deepEqual(row?.dietaryLabels, []);
      assert.deepEqual(row?.allergens, []);
      assert.equal(row?.isAvailable, true);
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
