/**
 * SOT: platform-page-assertions, platform-cursor-assertions
 * WHAT   Plain assertions for the platform console's keyset cursor, its ordering direction and
 *        the pattern its search box becomes. Run with `pnpm tsx tests/platform-page.test.ts` -
 *        no test runner, no config, no new dependency.
 * WHY    These are the three places the cross-tenant list can be wrong without failing: a
 *        cursor read under the wrong ordering skips a different set of rows than the caller
 *        has seen, an unescaped `%` in the search box matches every tenant on the deployment,
 *        and a bigint turned into a JS number loses money above 2^53. None of them throws.
 * WHY    Nothing here touches Postgres or NATS. platform-page.ts is deliberately the half of
 *        the query that is a function of its arguments, so this file needs neither.
 * WHERE  services/insights/src/platform-page.ts, services/insights/src/insights.service.ts
 */
import assert from "node:assert/strict";

import {
  cursorValueOf,
  decodeCursor,
  encodeCursor,
  ilikeNeedle,
  type PlatformCursor,
  type PlatformSort,
  sortAscends,
} from "../services/insights/src/platform-page";

type Check = { name: string; run: () => void };

const SORTS: readonly PlatformSort[] = ["orders", "revenue", "recent", "name"];

/** A row as the query hands it over: money and time already strings, count a number. */
const ROW = {
  orders: 42,
  gmv: "9007199254740993",
  lastOrderAt: "2026-08-22T09:15:00.000Z",
  sortName: "Blue Door Kitchen",
};

const checks: Check[] = [
  {
    name: "a cursor survives the round trip for every ordering",
    run: () => {
      for (const sort of SORTS) {
        const cursor: PlatformCursor = { s: sort, v: cursorValueOf(sort, ROW), r: "rest_1" };
        assert.deepEqual(decodeCursor(encodeCursor(cursor), sort), cursor, sort);
      }
    },
  },
  {
    name: "a cursor cut for one ordering is refused under another",
    run: () => {
      const encoded = encodeCursor({ s: "orders", v: "42", r: "rest_1" });
      assert.equal(decodeCursor(encoded, "revenue"), null);
      assert.equal(decodeCursor(encoded, "recent"), null);
      assert.equal(decodeCursor(encoded, "name"), null);
      // And is still readable under its own.
      assert.notEqual(decodeCursor(encoded, "orders"), null);
    },
  },
  {
    name: "anything that is not a cursor reads as null rather than as page one",
    run: () => {
      assert.equal(decodeCursor("", "orders"), null);
      assert.equal(decodeCursor("not-base64-json", "orders"), null);
      // Valid base64, valid JSON, wrong shape.
      const wrong = Buffer.from(JSON.stringify({ s: "orders", v: 42 }), "utf8").toString(
        "base64url",
      );
      assert.equal(decodeCursor(wrong, "orders"), null);
      const noSort = Buffer.from(JSON.stringify({ v: "42", r: "x" }), "utf8").toString("base64url");
      assert.equal(decodeCursor(noSort, "orders"), null);
      const unknownSort = Buffer.from(
        JSON.stringify({ s: "cheapest", v: "42", r: "x" }),
        "utf8",
      ).toString("base64url");
      assert.equal(decodeCursor(unknownSort, "orders"), null);
      // A bare JSON array parses but is not an object with these fields.
      const list = Buffer.from(JSON.stringify(["orders", "42", "x"]), "utf8").toString("base64url");
      assert.equal(decodeCursor(list, "orders"), null);
    },
  },
  {
    name: "a cursor is url-safe, so it survives being a query parameter",
    run: () => {
      const encoded = encodeCursor({ s: "name", v: "Café ?/+ Bar", r: "rest_1" });
      assert.equal(encoded, encodeURIComponent(encoded));
      assert.deepEqual(decodeCursor(encoded, "name"), {
        s: "name",
        v: "Café ?/+ Bar",
        r: "rest_1",
      });
    },
  },
  {
    name: "the cursor value is the column the ordering actually used",
    run: () => {
      assert.equal(cursorValueOf("orders", ROW), "42");
      assert.equal(cursorValueOf("revenue", ROW), ROW.gmv);
      assert.equal(cursorValueOf("recent", ROW), ROW.lastOrderAt);
      assert.equal(cursorValueOf("name", ROW), ROW.sortName);
    },
  },
  {
    name: "money keeps every digit: a bigint is carried as text, never as a JS number",
    run: () => {
      // 2^53 + 1. Rounded through a number this comes back one paisa short.
      assert.equal(cursorValueOf("revenue", ROW), "9007199254740993");
      assert.notEqual(String(Number(ROW.gmv)), ROW.gmv);
      const cursor: PlatformCursor = { s: "revenue", v: ROW.gmv, r: "rest_1" };
      assert.equal(decodeCursor(encodeCursor(cursor), "revenue")?.v, ROW.gmv);
    },
  },
  {
    name: "the rendered timestamp sorts as text in the same order it sorts as time",
    run: () => {
      // Why the query renders `max(placed_at)` fixed-width instead of letting the driver
      // build a Date: the keyset compares this string, and only a fixed width makes text
      // order and time order the same order.
      const earlier = "2026-08-22T09:15:00.000Z";
      const later = "2026-08-22T09:15:00.001Z";
      const nextYear = "2027-01-01T00:00:00.000Z";
      assert.ok(earlier < later);
      assert.ok(later < nextYear);
      assert.equal(earlier.length, nextYear.length);
    },
  },
  {
    name: "only the name ordering ascends",
    run: () => {
      assert.equal(sortAscends("name"), true);
      assert.equal(sortAscends("orders"), false);
      assert.equal(sortAscends("revenue"), false);
      assert.equal(sortAscends("recent"), false);
    },
  },
  {
    name: "the search box cannot smuggle a wildcard past ILIKE",
    run: () => {
      assert.equal(ilikeNeedle("blue"), "%blue%");
      // Without escaping, this matches every organisation on the deployment.
      assert.equal(ilikeNeedle("%"), "%\\%%");
      assert.equal(ilikeNeedle("_"), "%\\_%");
      // The backslash is escaped first, or it would escape the escapes added after it.
      assert.equal(ilikeNeedle("\\"), "%\\\\%");
      assert.equal(ilikeNeedle("a\\%b"), "%a\\\\\\%b%");
      assert.equal(ilikeNeedle("100% off"), "%100\\% off%");
    },
  },
  {
    name: "a search term with no wildcards is left exactly as it was typed",
    run: () => {
      for (const term of ["Blue Door", "org_", "rest-9", "Café"]) {
        const wrapped = ilikeNeedle(term);
        assert.ok(wrapped.startsWith("%") && wrapped.endsWith("%"), term);
        assert.equal(wrapped.replaceAll("\\", "").slice(1, -1), term.replaceAll("\\", ""));
      }
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
