/**
 * SOT: menu-csv-parser, csv-tokeniser, rupees-to-paise, menu-import-client
 * WHAT   Turns the CSV a restaurant hands over into the rows the catalogue's import contract
 *        expects - and, for every line it cannot turn into a row, a rejection carrying that
 *        line's number and the reason in words a manager can act on.
 * WHY    Restaurants have spreadsheets, not JSON, so the file is read here rather than shipped
 *        to a service as a blob to guess at. The one rule this exists to hold: a line that
 *        cannot be read is never quietly skipped. It leaves here as a rejection, travels with
 *        the good rows, and appears in the same report - because an importer that drops a
 *        malformed row is how a menu ends up with three dishes priced at zero.
 * HOW    `price_rupees` is rupees, as its name says, and is converted to integer paise by
 *        integer arithmetic - 220.55 * 100 is 22054.999999999996 and a menu is not the place
 *        to find out what that rounds to. Nothing past this file sees a rupee.
 * WHERE  packages/contracts/src/resources/catalog.contract.ts, apps/web/src/features/manage/menu-import.tsx
 */
import {
  DIETARY_LABELS,
  type InputOf,
  type MENU_CSV_COLUMNS,
  MENU_IMPORT_MAX_ROWS,
} from "@foodos/contracts";

type ImportAction = Extract<InputOf<"menuItem", "manage">, { action: "import" }>;
export type MenuCsvRow = ImportAction["rows"][number];
export type MenuCsvRejection = ImportAction["rejected"][number];

/** A problem with the file itself, not with a row: there is nothing to report row by row. */
export type MenuCsvParse =
  | { ok: false; problem: string }
  | { ok: true; totalRows: number; rows: MenuCsvRow[]; rejected: MenuCsvRejection[] };

type Column = (typeof MENU_CSV_COLUMNS)[number];
type DietaryLabel = (typeof DIETARY_LABELS)[number];

/** Everything else can be blank; without these three there is no dish to speak of. */
const REQUIRED_COLUMNS: readonly Column[] = ["category", "name", "price_rupees"];

/** Ten lakh rupees. A price above it is nearly always paise typed into a rupee column. */
const MAX_PAISE = 100_000_000;

/* ── Tokeniser ───────────────────────────────────────────────────────────── */

type Scan = { rows: string[][]; row: string[]; cell: string; quoted: boolean };

function endRow(state: Scan): void {
  state.row.push(state.cell);
  state.rows.push(state.row);
  state.cell = "";
  state.row = [];
}

/** Inside quotes everything is literal, and a doubled quote is one quote. */
function inQuotes(text: string, index: number, char: string, state: Scan): number {
  if (char !== '"') {
    state.cell += char;
    return 1;
  }
  if (text[index + 1] === '"') {
    state.cell += '"';
    return 2;
  }
  state.quoted = false;
  return 1;
}

/** Consumes one token and answers how many characters it took. */
function step(text: string, index: number, state: Scan): number {
  const char = text[index] ?? "";
  if (state.quoted) return inQuotes(text, index, char, state);
  if (char === '"') {
    state.quoted = true;
    return 1;
  }
  if (char === ",") {
    state.row.push(state.cell);
    state.cell = "";
    return 1;
  }
  if (char === "\n") {
    endRow(state);
    return 1;
  }
  if (char === "\r") {
    endRow(state);
    return text[index + 1] === "\n" ? 2 : 1;
  }
  state.cell += char;
  return 1;
}

/**
 * RFC 4180, because a dish called `Chicken 65, half` is a real dish and splitting on commas
 * eats it. Quoted fields may hold commas, quotes and line breaks; unquoted ones may not.
 */
function records(text: string): string[][] {
  const state: Scan = { rows: [], row: [], cell: "", quoted: false };
  let index = 0;
  while (index < text.length) {
    index += step(text, index, state);
  }
  if (state.cell !== "" || state.row.length > 0) endRow(state);
  return state.rows;
}

const isBlank = (record: readonly string[]): boolean => record.every((cell) => cell.trim() === "");

/* ── Cells ───────────────────────────────────────────────────────────────── */

type Sheet = { read: (record: readonly string[], column: Column) => string; width: number };

function sheetFor(columns: readonly string[]): Sheet {
  const positions = new Map<string, number>();
  for (const [index, name] of columns.entries()) {
    if (!positions.has(name)) positions.set(name, index);
  }
  return {
    width: columns.length,
    read: (record, column) => {
      const position = positions.get(column);
      if (position === undefined) return "";
      return (record[position] ?? "").trim();
    },
  };
}

type Problems = string[];

function requiredText(value: string, label: string, max: number, problems: Problems): string {
  if (value === "") {
    problems.push(`The ${label} is empty.`);
    return "";
  }
  if (value.length > max) {
    problems.push(`The ${label} is longer than ${max} characters.`);
    return "";
  }
  return value;
}

function optionalText(
  value: string,
  label: string,
  max: number,
  problems: Problems,
): string | null {
  if (value === "") return null;
  if (value.length > max) {
    problems.push(`The ${label} is longer than ${max} characters.`);
    return null;
  }
  return value;
}

/** Rupees in the file, paise on the wire, and the conversion never touches a float. */
function paiseFrom(value: string, label: string, problems: Problems): number | null {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    problems.push(
      `The ${label} "${value}" is not an amount in rupees. Write it like 220 or 220.50.`,
    );
    return null;
  }
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > 2) {
    problems.push(
      `The ${label} "${value}" has more than two decimals. Nothing is smaller than a paisa.`,
    );
    return null;
  }
  const paise = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (paise > MAX_PAISE) {
    problems.push(`The ${label} ₹${value} is above the ₹10,00,000 limit. Is the column in paise?`);
    return null;
  }
  return paise;
}

function wholeNumber(
  value: string,
  label: string,
  bounds: { min: number; max: number },
  problems: Problems,
): number | null {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) {
    problems.push(`The ${label} "${value}" is not a whole number.`);
    return null;
  }
  const parsed = Number(value);
  if (parsed < bounds.min || parsed > bounds.max) {
    problems.push(`The ${label} has to be between ${bounds.min} and ${bounds.max}.`);
    return null;
  }
  return parsed;
}

const listFrom = (value: string): string[] =>
  value
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

function dietaryFrom(value: string, problems: Problems): DietaryLabel[] {
  const kept: DietaryLabel[] = [];
  for (const entry of listFrom(value)) {
    const folded = entry.toLowerCase().replace(/[\s-]+/g, "_");
    const match = DIETARY_LABELS.find((label) => label === folded);
    if (match === undefined) {
      problems.push(`"${entry}" is not a dietary label. Use ${DIETARY_LABELS.join(", ")}.`);
      continue;
    }
    kept.push(match);
  }
  if (kept.length > 8) problems.push("More than eight dietary labels on one dish.");
  return kept;
}

function allergensFrom(value: string, problems: Problems): string[] {
  const list = listFrom(value);
  if (list.length > 24) problems.push("More than twenty-four allergens on one dish.");
  if (list.some((entry) => entry.length > 40)) {
    problems.push("An allergen is longer than 40 characters.");
  }
  return list;
}

const YES = new Set(["yes", "y", "true", "1", "on"]);
const NO = new Set(["no", "n", "false", "0", "off"]);

/** A blank answer means the dish is on. Somebody who wants it off has to say so. */
function availableFrom(value: string, problems: Problems): boolean {
  if (value === "") return true;
  const folded = value.toLowerCase();
  if (YES.has(folded)) return true;
  if (NO.has(folded)) return false;
  problems.push(`"${value}" is not yes or no. Leave the column empty to keep the dish on.`);
  return true;
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

type RowResult = { row: MenuCsvRow } | { rejection: MenuCsvRejection };

function priceFrom(sheet: Sheet, record: readonly string[], problems: Problems): number | null {
  const cell = sheet.read(record, "price_rupees");
  if (cell === "") {
    problems.push("The price is empty. Write it in rupees, like 220.");
    return null;
  }
  return paiseFrom(cell, "price", problems);
}

function readRow(record: readonly string[], rowNumber: number, sheet: Sheet): RowResult {
  const problems: Problems = [];
  if (record.length > sheet.width) {
    problems.push(`This line has ${record.length} values but the header has ${sheet.width}.`);
  }
  const name = requiredText(sheet.read(record, "name"), "dish name", 120, problems);
  const category = requiredText(sheet.read(record, "category"), "section", 80, problems);
  const pricePaise = priceFrom(sheet, record, problems);
  const discountCell = sheet.read(record, "discount_price_rupees");
  const itemId = sheet.read(record, "id");

  /**
   * Every field is read even after something has already failed, so one pass names every
   * problem in the line. The object is thrown away if any of them did - `pricePaise ?? 0`
   * only exists to satisfy the shape of a row that is about to be rejected.
   */
  const row = {
    rowNumber,
    itemId: itemId === "" ? null : itemId,
    category,
    name,
    description: optionalText(sheet.read(record, "description"), "description", 1000, problems),
    pricePaise: pricePaise ?? 0,
    discountPricePaise:
      discountCell === "" ? null : paiseFrom(discountCell, "offer price", problems),
    sku: optionalText(sheet.read(record, "sku"), "SKU", 48, problems),
    prepTimeMinutes: wholeNumber(
      sheet.read(record, "prep_time_minutes"),
      "prep time",
      { min: 0, max: 600 },
      problems,
    ),
    calories: wholeNumber(
      sheet.read(record, "calories"),
      "calorie count",
      { min: 0, max: 100_000 },
      problems,
    ),
    spiceLevel: wholeNumber(
      sheet.read(record, "spice_level"),
      "spice level",
      { min: 0, max: 3 },
      problems,
    ),
    dietaryLabels: dietaryFrom(sheet.read(record, "dietary_labels"), problems),
    allergens: allergensFrom(sheet.read(record, "allergens"), problems),
    isAvailable: availableFrom(sheet.read(record, "available"), problems),
  };

  if (problems.length === 0 && pricePaise !== null) return { row };
  const joined = problems.join(" ").slice(0, 200);
  return {
    rejection: {
      rowNumber,
      name: name.slice(0, 200),
      reason: joined === "" ? "This line could not be read." : joined,
    },
  };
}

/* ── The file ────────────────────────────────────────────────────────────── */

function headerProblem(columns: readonly string[], dataRows: number): string | null {
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    return `This file has no ${missing.join(" or ")} column. Export a menu to see the format the import expects.`;
  }
  if (dataRows === 0) return "That file has a header but no dishes under it.";
  if (dataRows > MENU_IMPORT_MAX_ROWS) {
    return `That file has ${dataRows} rows. Split it into files of ${MENU_IMPORT_MAX_ROWS} rows or fewer.`;
  }
  return null;
}

/**
 * `totalRows` is counted from the file rather than from what came out of it, so the service
 * can check the arithmetic and refuse an import that lost a line on the way.
 */
export function parseMenuCsv(text: string): MenuCsvParse {
  const all = records(text.replace(/^\uFEFF/, ""));
  const header = all[0];
  if (header === undefined) return { ok: false, problem: "That file is empty." };

  const columns = header.map((cell) => cell.trim().toLowerCase());
  const data = all.filter((record, index) => index > 0 && !isBlank(record));
  const problem = headerProblem(columns, data.length);
  if (problem !== null) return { ok: false, problem };

  const sheet = sheetFor(columns);
  const rows: MenuCsvRow[] = [];
  const rejected: MenuCsvRejection[] = [];
  for (const [index, record] of all.entries()) {
    if (index === 0 || isBlank(record)) continue;
    const result = readRow(record, index + 1, sheet);
    if ("row" in result) rows.push(result.row);
    else rejected.push(result.rejection);
  }
  return { ok: true, totalRows: data.length, rows, rejected };
}
