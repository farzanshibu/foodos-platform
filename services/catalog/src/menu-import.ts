/**
 * SOT: menu-import, import-dry-run, import-matching, import-report
 * WHAT   Turns the rows a browser read out of a CSV into a decision per row - add, update or
 *        reject - and, on a commit run, applies the whole lot in one transaction.
 * WHY    An importer that silently drops a malformed row is how a menu ends up with three
 *        items priced at zero. So nothing here drops anything: every line of the file comes
 *        back in the report with a row number, including the lines the browser could not read
 *        at all, and a run with a single rejected row writes nothing whatsoever. A partial
 *        import is the failure this was refused for; all-or-nothing is the whole design.
 * HOW    Matching is by the `id` column first - the exporter writes it, so an exported file
 *        handed straight back updates in place - and by section-and-name for a row whose ID
 *        is blank, which is how a spreadsheet somebody typed themselves still finds its
 *        dishes. Two rows landing on the same dish reject each other rather than letting the
 *        later one win. Money arrives as integer paise; the rupees lived in the spreadsheet.
 * WHERE  services/catalog/src/item.handlers.ts, apps/web/src/features/manage/menu-csv.ts
 */
import "server-only";

import { type InputOf, type OutputOf, ServiceError } from "@foodos/contracts";

import { categoryService, itemService, menuService } from "./menu.service";
import type { MenuCategoryRow, MenuItemRow } from "./schema";

/** Derived from the contract, never restated: a hand-written copy is a copy that drifts. */
type ImportInput = Extract<InputOf<"menuItem", "manage">, { action: "import" }>;
type ImportRow = ImportInput["rows"][number];
type Report = NonNullable<OutputOf<"menuItem", "manage">["report"]>;
type ReportRow = Report["rows"][number];

type Plan =
  | { kind: "create"; row: ImportRow; categoryId: string; dishKey: string }
  | {
      kind: "update";
      row: ImportRow;
      categoryId: string;
      itemId: string;
      /** Set only when the row moves or renames the dish onto a name it did not already hold. */
      claimedName: string | null;
    }
  | { kind: "reject"; row: ImportRow; reasons: readonly string[] };

type Lookups = {
  categoriesByName: Map<string, MenuCategoryRow>;
  itemsById: Map<string, MenuItemRow>;
  itemsByName: Map<string, MenuItemRow>;
};

/** "Chicken Biryani" and "chicken biryani " are the same dish to everyone except a computer. */
const fold = (value: string): string => value.trim().toLowerCase();

/** A dish is identified by its section and its name; the NUL keeps the two halves apart. */
const dishKeyFor = (categoryId: string, name: string): string => `${categoryId}\u0000${fold(name)}`;

const inRupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

async function loadLookups(organizationId: string, menuId: string): Promise<Lookups> {
  const [categories, items] = await Promise.all([
    categoryService.allIn({ organizationId, menuId }),
    itemService.allIn({ organizationId, menuId }),
  ]);
  return {
    categoriesByName: new Map(categories.map((row) => [fold(row.name), row])),
    itemsById: new Map(items.map((row) => [row.id, row])),
    itemsByName: new Map(items.map((row) => [dishKeyFor(row.categoryId, row.name), row])),
  };
}

/**
 * One row's verdict. Every reason it collects is addressed to the person holding the
 * spreadsheet, because they are the only one who can fix it.
 */
function planRow(row: ImportRow, lookups: Lookups): Plan {
  const reasons: string[] = [];
  const category = lookups.categoriesByName.get(fold(row.category));
  if (category === undefined) {
    reasons.push(
      `There is no section called "${row.category}" in this menu. Add the section first, or correct the spelling.`,
    );
  }
  const byId = row.itemId === null ? undefined : lookups.itemsById.get(row.itemId);
  if (row.itemId !== null && byId === undefined) {
    reasons.push(
      `No dish in this menu has the ID ${row.itemId}. Clear the ID column to add it as a new dish.`,
    );
  }
  if (row.discountPricePaise !== null && row.discountPricePaise > row.pricePaise) {
    reasons.push(
      `The offer price ${inRupees(row.discountPricePaise)} is higher than the price ${inRupees(row.pricePaise)}.`,
    );
  }
  if (category === undefined || reasons.length > 0) return { kind: "reject", row, reasons };

  const dishKey = dishKeyFor(category.id, row.name);
  const existing = byId ?? lookups.itemsByName.get(dishKey);
  if (existing !== undefined) {
    const held = dishKeyFor(existing.categoryId, existing.name);
    return {
      kind: "update",
      row,
      categoryId: category.id,
      itemId: existing.id,
      claimedName: held === dishKey ? null : dishKey,
    };
  }
  return { kind: "create", row, categoryId: category.id, dishKey };
}

/**
 * What a row lays claim to: the dish it changes, and the name it is putting on the menu when
 * that name is new to it. A row that leaves a dish where it already was claims no name, so a
 * menu that already holds two dishes with one name still exports and re-imports cleanly -
 * the ids tell them apart, and the file did not create the ambiguity.
 */
function targetsOf(plan: Plan): readonly string[] {
  if (plan.kind === "reject") return [];
  if (plan.kind === "create") return [plan.dishKey];
  const own = `item:${plan.itemId}`;
  return plan.claimedName === null ? [own] : [own, plan.claimedName];
}

/**
 * Two lines that would land on the same dish. Left alone the later one silently wins, which
 * is the same class of quiet damage as dropping a row, so both are rejected and told about
 * each other. Positions rather than row numbers key the pass, so the "other rows" list is
 * never empty even if a client sends the same line twice.
 */
function rejectDuplicates(plans: readonly Plan[]): Plan[] {
  const claims = new Map<string, Array<{ position: number; rowNumber: number }>>();
  for (const [position, plan] of plans.entries()) {
    for (const target of targetsOf(plan)) {
      const held = claims.get(target) ?? [];
      held.push({ position, rowNumber: plan.row.rowNumber });
      claims.set(target, held);
    }
  }
  return plans.map((plan, position) => {
    const others = new Map<number, number>();
    for (const target of targetsOf(plan)) {
      for (const claim of claims.get(target) ?? []) {
        if (claim.position !== position) others.set(claim.position, claim.rowNumber);
      }
    }
    if (others.size === 0) return plan;
    const rowNumbers = [...others.values()].sort((left, right) => left - right);
    const where = rowNumbers.length === 1 ? "row" : "rows";
    return {
      kind: "reject",
      row: plan.row,
      reasons: [`This dish is also on ${where} ${rowNumbers.join(", ")}. Keep one line per dish.`],
    };
  });
}

function toReportRow(plan: Plan): ReportRow {
  if (plan.kind === "reject") {
    return {
      rowNumber: plan.row.rowNumber,
      name: plan.row.name,
      category: plan.row.category,
      outcome: "reject",
      itemId: null,
      pricePaise: null,
      reasons: [...plan.reasons],
    };
  }
  return {
    rowNumber: plan.row.rowNumber,
    name: plan.row.name,
    category: plan.row.category,
    outcome: plan.kind,
    itemId: plan.kind === "update" ? plan.itemId : null,
    pricePaise: plan.row.pricePaise,
    reasons: [],
  };
}

/**
 * The whole file, in file order. The browser's own rejections are folded in here rather than
 * reported separately, so what the manager reads is one list with one row number per line of
 * their spreadsheet.
 */
function buildReport(
  dryRun: boolean,
  plans: readonly Plan[],
  rejected: ImportInput["rejected"],
): Report {
  const fromClient: ReportRow[] = rejected.map((entry) => ({
    rowNumber: entry.rowNumber,
    name: entry.name,
    category: "",
    outcome: "reject",
    itemId: null,
    pricePaise: null,
    reasons: [entry.reason],
  }));
  const rows = [...plans.map(toReportRow), ...fromClient].sort(
    (left, right) => left.rowNumber - right.rowNumber,
  );
  const counted = (outcome: ReportRow["outcome"]) =>
    rows.filter((row) => row.outcome === outcome).length;
  return {
    dryRun,
    rows,
    createCount: counted("create"),
    updateCount: counted("update"),
    rejectCount: counted("reject"),
  };
}

/** Everything the CSV format carries. Variants and modifiers are not in it and stay as they are. */
const fieldsOf = (row: ImportRow) => ({
  name: row.name,
  description: row.description,
  pricePaise: row.pricePaise,
  discountPricePaise: row.discountPricePaise,
  sku: row.sku,
  prepTimeMinutes: row.prepTimeMinutes,
  calories: row.calories,
  spiceLevel: row.spiceLevel,
  dietaryLabels: [...row.dietaryLabels],
  allergens: [...row.allergens],
  isAvailable: row.isAvailable,
});

function commit(organizationId: string, menuId: string, plans: readonly Plan[]): Promise<number> {
  const creates = plans.flatMap((plan) =>
    plan.kind === "create"
      ? [
          {
            id: crypto.randomUUID(),
            organizationId,
            menuId,
            categoryId: plan.categoryId,
            ...fieldsOf(plan.row),
          },
        ]
      : [],
  );
  const updates = plans.flatMap((plan) =>
    plan.kind === "update"
      ? [{ id: plan.itemId, patch: { categoryId: plan.categoryId, ...fieldsOf(plan.row) } }]
      : [],
  );
  return itemService.applyImport({ organizationId, creates, updates });
}

/**
 * A dry run reports and writes nothing. A commit writes only when the report is clean - a run
 * with rejections comes back with `changed: 0` and the reasons intact rather than as an
 * exception, because the row numbers are what the manager needs and an error string cannot
 * carry them.
 */
export async function runMenuImport(
  organizationId: string,
  input: ImportInput,
): Promise<{ changed: number; report: Report }> {
  const arrived = input.rows.length + input.rejected.length;
  if (arrived !== input.totalRows) {
    throw new ServiceError(
      "INVALID_INPUT",
      `The file has ${input.totalRows} rows but ${arrived} arrived. Nothing was imported.`,
    );
  }
  const menuRow = await menuService.byId({ organizationId, id: input.menuId });
  if (menuRow === null) throw new ServiceError("NOT_FOUND", "Menu not found.");

  const lookups = await loadLookups(organizationId, input.menuId);
  const plans = rejectDuplicates(input.rows.map((row) => planRow(row, lookups)));
  const report = buildReport(input.dryRun, plans, input.rejected);

  if (input.dryRun || report.rejectCount > 0) return { changed: 0, report };
  return { changed: await commit(organizationId, input.menuId, plans), report };
}
