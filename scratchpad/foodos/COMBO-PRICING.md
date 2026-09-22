# Combo pricing — the one engine that must be exactly right

Lives in `services/catalog/src/pricing.ts`, opens with `import "server-only";`, and is a
**pure function**. It reads no database. The handler loads the combo definition with current
prices and hands it in; the engine does arithmetic and validation and nothing else. That is
what makes it unit-testable without a database.

## The two modes

| Mode | Price of one combo |
| --- | --- |
| `flat_rate` | `flatRatePaise`. **The constituent item prices are ignored entirely.** |
| `flat_percentage` | `round(sum(constituent line totals) * (100 - pct) / 100)` |

`flat_rate` is 1 rupee to 10,00,000 rupees. `flat_percentage` is 1 to 99 — a 100% combo is a
free item, which is a promotion, not a combo, and the registry has a promotion resource.

## Rules that are not negotiable
1. **The server is the only source of a price.** The browser renders what came back. A price
   arriving in an input is a bug; there is no input field for one.
2. Money is integer paise throughout the engine. Round half-up, once, at the point the
   percentage is applied — never round intermediate line totals.
3. `quantity` on a combo line multiplies the **whole combo**, including every child line.
4. Pricing is **line-level**. Coupons and promotions apply afterwards, to the order subtotal.
   The engine has no coupon awareness by design, and must not grow any.
5. `savingsPaise = max(0, referencePricePaise - unitPricePaise)`. Clamped: a combo priced
   *above* its parts shows no savings rather than a negative one. The staff editor warns
   about that case; the engine does not refuse it.
6. Group validation, all of which are `INVALID_INPUT`:
   - a selection naming a group the combo does not have
   - a selection naming an item that group does not allow
   - fewer selections than `minSelections`
   - more selections than `maxSelections` when it is not null
   - the same (item, variant) twice inside one group — the caller means quantity, and
     silently merging them would let a picker bug become a price
7. Only the parent combo line carries money. Child lines exist for the kitchen ticket and
   the receipt and always have a line total of zero. The invariant the order service asserts
   is: `subtotal === sum(line totals of lines with no parent)`.

## Display hint
A menu card needs a price before anyone has picked anything. `comboDisplayHint(combo)`
computes the **cheapest valid configuration** (the lowest-priced allowed item for each group,
`minSelections` of them) and returns `{ displayPricePaise, referencePricePaise, badge }`.
For `flat_rate` the display price is the flat rate; for `flat_percentage` it is the discounted
cheapest configuration and the badge reads the percentage. It is a hint, not a quote —
`quote.read` is still what prices the actual cart.

## Tests
`services/catalog/src/pricing.test.ts`, plain `node:test` + `node:assert/strict`, run with
`tsx` exactly like `tests/registry-derive.test.ts`. Cover at minimum:
- flat rate ignores item prices, even when the parts cost more than the combo
- flat rate below the parts produces the exact savings
- flat percentage tracks a member item's price changing; flat rate does not
- rounding lands on the paise, half-up, for a percentage that does not divide evenly
- each of the six validation failures in rule 6
- quantity multiplies the whole combo, children included
- savings clamp at zero rather than going negative
Add the file to the `test` script in the root `package.json` — coordinate that with the
coordinator rather than editing it if another worker is also adding a test.
