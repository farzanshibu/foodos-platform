/**
 * SOT: shared-cart-assertions
 * WHAT   Plain assertions for the rules a basket shared by three phones at one table depends
 *        on. Run with `pnpm tsx tests/shared-cart.test.ts` - no test runner, no config.
 * WHY    The bug this feature replaced was silent: two phones each sending a whole line list
 *        meant the slower write erased the faster one's dish, with no error anywhere and no
 *        way to notice until the food did not arrive. Everything here pins the properties
 *        that make that impossible - commutativity, idempotency, and never guessing at
 *        attribution - because none of them fail loudly on their own.
 * WHERE  services/orders/src/table-party.ts, services/floor/src/floor.handlers.ts
 */
import assert from "node:assert/strict";

import {
  CART_STATUSES,
  type CartLineEntry,
  type CartStatus,
  isCartOpen,
  PLACE_STATUSES,
  placeHoldsAParty,
  TERMINAL_CART_STATUSES,
} from "../packages/contracts/src/index";
import {
  freshMemberName,
  nextEntries,
  readEntries,
} from "../services/orders/src/table-party-rules";

type Check = { name: string; run: () => void };

const dish = (quantity: number): CartLineEntry["line"] => ({
  kind: "item",
  itemId: "item_biryani",
  quantity,
  modifiers: [],
});

const entry = (lineId: string, who: string, quantity = 1): CartLineEntry => ({
  lineId,
  addedBySessionId: `session_${who}`,
  addedByName: who,
  line: dish(quantity),
});

const checks: Check[] = [
  /* ── the bug this replaced ────────────────────────────────────────────── */
  {
    name: "THE BUG: two people adding at the same moment both keep their dish",
    run: () => {
      const start: CartLineEntry[] = [];
      /** Both read the same empty basket, as two phones racing genuinely would. */
      const afterFarzan = nextEntries(start, { kind: "add", entry: entry("l1", "Amber Heron") });
      assert.ok(afterFarzan !== null);
      const afterPriya = nextEntries(afterFarzan, {
        kind: "add",
        entry: entry("l2", "Jade Otter"),
      });
      assert.ok(afterPriya !== null);
      assert.deepEqual(
        afterPriya.map((line) => line.lineId),
        ["l1", "l2"],
      );
    },
  },
  {
    name: "adds commute - the order two people arrive in does not change the basket",
    run: () => {
      const a = entry("l1", "Amber Heron");
      const b = entry("l2", "Jade Otter");
      const oneWay = nextEntries(nextEntries([], { kind: "add", entry: a }) ?? [], {
        kind: "add",
        entry: b,
      });
      const otherWay = nextEntries(nextEntries([], { kind: "add", entry: b }) ?? [], {
        kind: "add",
        entry: a,
      });
      assert.ok(oneWay !== null && otherWay !== null);
      assert.deepEqual(
        [...oneWay].map((line) => line.lineId).sort(),
        [...otherWay].map((line) => line.lineId).sort(),
      );
    },
  },

  /* ── idempotency: a retry must not become a second dish ───────────────── */
  {
    name: "re-sending the same add is a retry, not a second dish",
    run: () => {
      const start = [entry("l1", "Amber Heron")];
      assert.equal(nextEntries(start, { kind: "add", entry: entry("l1", "Amber Heron") }), null);
    },
  },
  {
    name: "re-removing a line that has already gone changes nothing",
    run: () => {
      assert.equal(
        nextEntries([entry("l1", "Amber Heron")], { kind: "remove", lineId: "l9" }),
        null,
      );
    },
  },
  {
    name: "setting a quantity to what it already is changes nothing",
    run: () => {
      const start = [entry("l1", "Amber Heron", 2)];
      assert.equal(nextEntries(start, { kind: "quantity", lineId: "l1", quantity: 2 }), null);
    },
  },

  /* ── edits are keyed on the line, never on a position ─────────────────── */
  {
    name: "a quantity change finds its line by id, not by where it sits",
    run: () => {
      const start = [entry("l1", "Amber Heron"), entry("l2", "Jade Otter")];
      const next = nextEntries(start, { kind: "quantity", lineId: "l2", quantity: 5 });
      assert.ok(next !== null);
      assert.equal(next[0]?.line.quantity, 1);
      assert.equal(next[1]?.line.quantity, 5);
    },
  },
  {
    name: "removing somebody else's line leaves everyone else's untouched",
    run: () => {
      const start = [
        entry("l1", "Amber Heron"),
        entry("l2", "Jade Otter"),
        entry("l3", "Teal Yak"),
      ];
      const next = nextEntries(start, { kind: "remove", lineId: "l2" });
      assert.ok(next !== null);
      assert.deepEqual(
        next.map((line) => line.lineId),
        ["l1", "l3"],
      );
    },
  },
  {
    name: "a change never rewrites who added a line",
    run: () => {
      const start = [entry("l1", "Amber Heron", 1)];
      const next = nextEntries(start, { kind: "quantity", lineId: "l1", quantity: 4 });
      assert.ok(next !== null);
      assert.equal(next[0]?.addedByName, "Amber Heron");
      assert.equal(next[0]?.addedBySessionId, "session_Amber Heron");
    },
  },

  /* ── names ────────────────────────────────────────────────────────────── */
  {
    name: "nobody at a table is handed a name somebody else already holds",
    run: () => {
      const taken: string[] = [];
      for (let seat = 0; seat < 40; seat += 1) {
        const name = freshMemberName(taken);
        assert.ok(!taken.includes(name), `${name} was handed out twice`);
        taken.push(name);
      }
    },
  },
  {
    name: "a name is always two readable words, never an id",
    run: () => {
      const name = freshMemberName([]);
      assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    },
  },

  /* ── stored lines are parsed, never trusted ───────────────────────────── */
  {
    name: "a corrupt entry costs one re-pick, not the whole table's basket",
    run: () => {
      const stored = [
        { lineId: "l1", addedBySessionId: "s1", addedByName: "Amber Heron", line: dish(1) },
        { lineId: "l2", line: { kind: "nonsense" } },
        null,
        "not an object",
        { lineId: "l3", addedBySessionId: null, addedByName: null, line: dish(2) },
      ];
      const read = readEntries(stored);
      assert.deepEqual(
        read.map((line) => line.lineId),
        ["l1", "l3"],
      );
    },
  },
  {
    name: "a basket written before the table shared it still reads, with no name",
    run: () => {
      const read = readEntries([{ lineId: "l1", line: dish(1) }]);
      assert.equal(read.length, 1);
      assert.equal(read[0]?.addedByName, null);
    },
  },
  {
    name: "anything that is not a list at all is an empty basket, not an exception",
    run: () => {
      assert.deepEqual(readEntries(null), []);
      assert.deepEqual(readEntries("[]"), []);
      assert.deepEqual(readEntries({ lines: [] }), []);
    },
  },

  /* ── clearing the table ───────────────────────────────────────────────── */
  {
    name: "THE BUG: only an occupied table is still holding a party",
    run: () => {
      /**
       * Inverting this loses a party's order in the middle of their meal, and the way anyone
       * finds out is the kitchen never getting the ticket. Every status is named here rather
       * than looped over, so adding one to PLACE_STATUSES makes somebody decide what it means
       * instead of inheriting an answer.
       */
      assert.equal(placeHoldsAParty("occupied"), true);
      assert.equal(placeHoldsAParty("available"), false);
      assert.equal(placeHoldsAParty("cleaning"), false);
      assert.equal(placeHoldsAParty("reserved"), false);
      assert.equal(placeHoldsAParty("disabled"), false);
    },
  },
  {
    name: "a status nobody has classified clears the table rather than inheriting it",
    run: () => {
      const seating = PLACE_STATUSES.filter((status) => placeHoldsAParty(status));
      assert.deepEqual(
        seating,
        ["occupied"],
        "a new place status must opt in to meaning occupied - defaulting the other way " +
          "would hand the next party the last party's basket, silently",
      );
    },
  },
  {
    name: "a basket that is over cannot be added to, and one that is not stays open",
    run: () => {
      assert.equal(isCartOpen("active"), true);
      assert.equal(isCartOpen("awaiting_place"), true);
      assert.equal(isCartOpen("allocated"), true);
      assert.equal(isCartOpen("converted"), false);
      assert.equal(isCartOpen("abandoned"), false);
    },
  },
  {
    name: "the two endings are the only endings, and they are both real statuses",
    run: () => {
      assert.deepEqual([...TERMINAL_CART_STATUSES], ["converted", "abandoned"]);
      for (const status of TERMINAL_CART_STATUSES) {
        assert.ok(
          CART_STATUSES.includes(status),
          `${status} is terminal but is not a status a cart can hold`,
        );
      }
      const open = CART_STATUSES.filter((status: CartStatus) => isCartOpen(status));
      assert.equal(
        open.length + TERMINAL_CART_STATUSES.length,
        CART_STATUSES.length,
        "every status is either open or an ending - there is no third kind",
      );
    },
  },
];

let failed = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${check.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exit(1);
