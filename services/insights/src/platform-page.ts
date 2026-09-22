/**
 * SOT: platform-cursor, platform-keyset, platform-sort, ilike-needle, platform-pagination
 * WHAT   The pure half of the platform console's list: what a page cursor is, how it is read
 *        back, and how a search box becomes a pattern Postgres can match.
 * WHY    Kept out of insights.service.ts on purpose. That file imports ./db and therefore
 *        opens a connection the moment it is loaded, so nothing in it can be asserted without
 *        a database. Everything here is a function of its arguments, which is what
 *        tests/platform-page.test.ts pins.
 * HOW    A cursor is a keyset, not an offset: it carries the ordering value of the last row
 *        of the previous page plus that row's restaurant id as the tie-break. It is stamped
 *        with the sort it was cut for, because a cursor read against a different ordering
 *        does not skip the rows the caller has already seen - it skips a different set.
 * HOW    Every value travels as a string. The comparison in SQL casts it back to the column's
 *        own type, so a bigint is compared as a bigint and a timestamp as a timestamp rather
 *        than as whatever a JSON round trip made of it.
 * WHERE  services/insights/src/insights.service.ts, tests/platform-page.test.ts
 */
import { PLATFORM_SORTS } from "@foodos/contracts";

/** Derived from the contract's own list, so an ordering added there cannot be missed here. */
export type PlatformSort = (typeof PLATFORM_SORTS)[number];

/**
 * `v` is the ordering value of the last row on the page just served, `r` its restaurant id,
 * `s` the ordering both were read under. Short keys because a cursor is carried twice per
 * page and read by nobody.
 */
export type PlatformCursor = {
  readonly s: PlatformSort;
  readonly v: string;
  readonly r: string;
};

export function encodeCursor(cursor: PlatformCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Narrowed by hand rather than by a schema because this service has no zod of its own, and a
 * dependency added for one three-field object is a dependency. Every field is proved before
 * it is read, which is what a parse buys; nothing is asserted.
 */
function readCursor(value: unknown): PlatformCursor | null {
  if (typeof value !== "object" || value === null) return null;
  const fields: ReadonlyMap<string, unknown> = new Map(Object.entries(value));
  const sort = PLATFORM_SORTS.find((candidate) => candidate === fields.get("s"));
  const at = fields.get("v");
  const restaurantId = fields.get("r");
  if (sort === undefined || typeof at !== "string" || typeof restaurantId !== "string") {
    return null;
  }
  return { s: sort, v: at, r: restaurantId };
}

/**
 * Null means "this is not a cursor this ordering can use", which the handler turns into
 * INVALID_INPUT rather than quietly serving page one. Silently ignoring an unreadable cursor
 * is how a list loops on its first page and nobody notices.
 */
export function decodeCursor(value: string, sort: PlatformSort): PlatformCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const cursor = readCursor(parsed);
  if (cursor === null) return null;
  return cursor.s === sort ? cursor : null;
}

/** Ascending only for `name`; every other ordering puts the busiest or the newest first. */
export function sortAscends(sort: PlatformSort): boolean {
  return sort === "name";
}

/**
 * The four ordering values a row can be cut on, structurally rather than as the query's own
 * row type: this file must not import the schema, or a test of it would open a connection.
 */
export type PlatformOrderKeys = {
  readonly orders: number;
  readonly gmv: string;
  readonly lastOrderAt: string;
  readonly sortName: string;
};

/**
 * The value the next page starts after. `gmv` and `lastOrderAt` are already strings coming
 * out of Postgres - a bigint is not safe as a JS number and the timestamp is rendered
 * fixed-width on purpose - so only the order count needs turning into one.
 */
export function cursorValueOf(sort: PlatformSort, row: PlatformOrderKeys): string {
  if (sort === "revenue") return row.gmv;
  if (sort === "recent") return row.lastOrderAt;
  if (sort === "name") return row.sortName;
  return String(row.orders);
}

/**
 * A search box types `%` and `_` as often as anything else, and both are wildcards to ILIKE.
 * Unescaped, "100%" matches every row in the table. The backslash goes first, or it would
 * escape the escapes added after it.
 */
export function ilikeNeedle(search: string): string {
  const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
}
