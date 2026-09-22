/**
 * SOT: menu-csv-writer, menu-export-format, csv-escaping
 * WHAT   The CSV document `menuItem.manage → export` hands back, written in the column order
 *        the contract fixes.
 * WHY    Export and import have to be one format or neither is worth having: the file a
 *        restaurant downloads is the file it edits in a spreadsheet and hands straight back.
 *        The column list lives in @foodos/contracts precisely so this writer and the
 *        browser's parser cannot drift apart - a column added on one side and forgotten on
 *        the other is a type error here, not a silently missing dish.
 * HOW    Paise are divided by a hundred exactly once, here, and always printed with two
 *        decimals, because the header calls the column `price_rupees` and a column of prices
 *        that sometimes says 220 and sometimes 220.5 is a column somebody will re-type.
 * WHERE  services/catalog/src/item.handlers.ts, apps/web/src/features/manage/menu-csv.ts
 */
import "server-only";

import { MENU_CSV_COLUMNS } from "@foodos/contracts";

export type MenuCsvItem = {
  id: string;
  categoryName: string;
  name: string;
  description: string | null;
  pricePaise: number;
  discountPricePaise: number | null;
  sku: string | null;
  prepTimeMinutes: number | null;
  calories: number | null;
  spiceLevel: number | null;
  dietaryLabels: readonly string[];
  allergens: readonly string[];
  isAvailable: boolean;
};

/**
 * One cell per column, in the contract's order. Mapping over the column tuple is what makes
 * the arity a compile error: add a column and this stops type-checking until a cell exists
 * for it, which is cheaper than discovering the gap in a customer's spreadsheet.
 */
type OneStringPer<Columns extends readonly string[]> = { [Index in keyof Columns]: string };
type Cells = OneStringPer<typeof MENU_CSV_COLUMNS>;

/** Two decimals always. `220` and `220.50` in the same column is how a menu gets re-typed. */
const rupees = (paise: number): string => (paise / 100).toFixed(2);

const optionalNumber = (value: number | null): string => (value === null ? "" : String(value));

/**
 * RFC 4180: quote anything holding a comma, a quote or a line break, and double the quotes
 * inside it. "Chicken 65, half" is a real dish and a naive join eats it.
 */
function cell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

const line = (values: readonly string[]): string => values.map(cell).join(",");

function cellsFor(item: MenuCsvItem): Cells {
  return [
    item.id,
    item.categoryName,
    item.name,
    item.description ?? "",
    rupees(item.pricePaise),
    item.discountPricePaise === null ? "" : rupees(item.discountPricePaise),
    item.sku ?? "",
    optionalNumber(item.prepTimeMinutes),
    optionalNumber(item.calories),
    optionalNumber(item.spiceLevel),
    item.dietaryLabels.join("|"),
    item.allergens.join("|"),
    item.isAvailable ? "yes" : "no",
  ];
}

/** CRLF, because the spreadsheet on the other end of this is usually Excel. */
export function menuCsv(items: readonly MenuCsvItem[]): string {
  const rows = [line(MENU_CSV_COLUMNS), ...items.map((item) => line(cellsFor(item)))];
  return `${rows.join("\r\n")}\r\n`;
}
