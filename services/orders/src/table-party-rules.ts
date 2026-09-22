/**
 * SOT: table-party-rules, shared-cart-rules, member-name, cart-line-entry, line-ops
 * WHAT   The basket three people at one table share: who is in it, what each of them added,
 *        and the only safe way to change it while more than one phone is holding it open.
 * WHY    A basket used to belong to a phone, so replacing its whole line list was harmless.
 *        Shared by a table it is not: two phones each sending a complete list means the slower
 *        write erases the faster one's dish with no error anywhere, and the person who lost it
 *        finds out when the food does not come. Every edit here names one line instead.
 * HOW    Adds are commutative, so they need no coordination beyond the row lock. Removes and
 *        quantity changes are keyed on a client-minted `lineId`, which makes them idempotent -
 *        a retry after a dropped connection re-removes nothing. The lock is `SELECT ... FOR
 *        UPDATE` on the cart row, held for the microseconds it takes to rewrite a small array.
 * NOTE   No database import, deliberately: these are the rules the whole feature rests on,
 * and rules that cannot be asserted without a Postgres are rules nobody asserts.
 * WHERE  services/orders/src/table-party.ts, tests/shared-cart.test.ts
 */
import { type CartLineEntry, cartLineEntry } from "@foodos/contracts";

/* ── Names ───────────────────────────────────────────────────────────────── */

/**
 * Names are assigned, never asked for.
 *
 * A diner who has just sat down will not type their name to add a naan, and a free-text field
 * shared with whoever else scanned that code is a field somebody eventually writes something
 * unpleasant into. These answer the only question attribution has to answer - whose dish is
 * that - and nothing else. Nothing here is a real name, so nothing here is personal data.
 *
 * Deliberately food-neutral and gender-neutral: a table naming somebody "Spicy Prawn" is a
 * joke that stops being funny on the receipt it ends up printed on.
 */
const COLOURS = [
  "Amber",
  "Azure",
  "Cobalt",
  "Coral",
  "Crimson",
  "Emerald",
  "Golden",
  "Indigo",
  "Ivory",
  "Jade",
  "Lilac",
  "Maroon",
  "Olive",
  "Rustic",
  "Saffron",
  "Scarlet",
  "Silver",
  "Teal",
  "Umber",
  "Violet",
] as const;

const CREATURES = [
  "Heron",
  "Ibis",
  "Jackal",
  "Kestrel",
  "Lynx",
  "Marten",
  "Otter",
  "Panther",
  "Quail",
  "Raven",
  "Sable",
  "Tiger",
  "Vulture",
  "Walrus",
  "Weaver",
  "Yak",
  "Falcon",
  "Gannet",
  "Hornbill",
  "Mongoose",
] as const;

function pick<T>(values: readonly T[], fallback: T): T {
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? fallback;
}

/**
 * A name nobody at this table already holds.
 *
 * Four hundred combinations against a table of at most a few dozen, so a first pick almost
 * always lands; the loop is for the rest, and the numbered suffix is the guarantee that this
 * terminates rather than a nicety. Two people called "Amber Heron" would make attribution
 * worse than no attribution at all.
 */
export function freshMemberName(taken: readonly string[]): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const name = `${pick(COLOURS, "Amber")} ${pick(CREATURES, "Heron")}`;
    if (!used.has(name)) return name;
  }
  for (let suffix = 2; ; suffix += 1) {
    const name = `Guest ${suffix}`;
    if (!used.has(name)) return name;
  }
}

/* ── Reading stored lines ────────────────────────────────────────────────── */

/**
 * The lines column is JSONB, so it arrives as `unknown` and is narrowed rather than trusted -
 * the one place this service has to parse something it did not just write. Anything
 * unreadable is dropped rather than thrown: a corrupt entry should cost one re-pick, not the
 * whole table's basket.
 */
export function readEntries(value: unknown): CartLineEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const parsed = cartLineEntry.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

/* ── Changing lines ────────────────────────────────── */

export type LineChange =
  | { readonly kind: "add"; readonly entry: CartLineEntry }
  | { readonly kind: "quantity"; readonly lineId: string; readonly quantity: number }
  | { readonly kind: "remove"; readonly lineId: string };

/** The pure half, so the rule is testable without a database. Null means "no change". */
export function nextEntries(
  entries: readonly CartLineEntry[],
  change: LineChange,
): CartLineEntry[] | null {
  switch (change.kind) {
    case "add": {
      /** Idempotent: the same lineId twice is one retry, not two dishes. */
      if (entries.some((entry) => entry.lineId === change.entry.lineId)) return null;
      return [...entries, change.entry];
    }
    case "quantity": {
      let moved = false;
      const next = entries.map((entry) => {
        if (entry.lineId !== change.lineId) return entry;
        if (entry.line.quantity === change.quantity) return entry;
        moved = true;
        return { ...entry, line: { ...entry.line, quantity: change.quantity } };
      });
      return moved ? next : null;
    }
    case "remove": {
      const next = entries.filter((entry) => entry.lineId !== change.lineId);
      return next.length === entries.length ? null : next;
    }
  }
}
