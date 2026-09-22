# FoodOS build — shared brief (read before writing anything)

We are building FoodOS, a food-discovery + restaurant-management SaaS, **on this platform's
existing architecture**. The FoodOS spec's stack suggestions (tRPC modules, Prisma, a single
`db/schema.sql`, hand-written `perm()`) are **not** what we build. This repo's `CLAUDE.md`
and `.claude/skills/` are binding.

## Read first
- `.claude/skills/mindset/SKILL.md`
- `.claude/skills/add-feature/SKILL.md`
- `.claude/skills/typescript-lockin/SKILL.md`
- `.claude/skills/context-discipline/SKILL.md`
- the exemplar for whatever you are writing (named in your task)

## Non-negotiable
1. `packages/registry/src/registry.ts` is already done. **Do not edit it**, or `derive.ts`,
   or `define.ts`. The resources, operations, roles, limits and subjects all exist.
2. **No organisation id anywhere in a contract input or output.** It arrives as `ctx.orgId`
   from the signed envelope. `pnpm foodos` fails the build if a contract asks for one,
   and it is a cross-tenant leak, not a style preference.
3. No `any`, no `unknown` outside a parse boundary, no `as`, no `!`.
   `exactOptionalPropertyTypes` is on: build objects conditionally
   (`...(v === undefined ? {} : { x: v })`), never pass `undefined`.
   `noUncheckedIndexedAccess` is on: `rows[0]` is `T | undefined`.
   `verbatimModuleSyntax` is on: type-only imports must say `import type`.
   No enums (`erasableSyntaxOnly`); use `as const` objects.
4. Every file opens with the `SOT:` header block: `SOT:` keywords, then
   `WHAT / WHY / HOW / WHERE`. Copy the shape from the exemplar. There is no `docs/` folder.
5. Never write a NATS subject as a string literal — not even inside a comment. Subjects come
   from `rpcSubject()` / `commandSubject()` / `eventSubject()`.
6. Do not run any git command.
7. Only touch the files your task names. Another worker owns the rest.

## New platform facts you need (added in wave 0)
- **`guest` is a real org role**, ranked below `member`. `minRole: "guest"` means "anyone,
  including a person at a table with no account" — every staff role clears it too.
  A guest's org id comes from a signed ticket the server minted when the QR token was
  resolved (`packages/contracts/src/ticket.ts`), never from the browser.
- **Plans are `starter | growth | pro | enterprise`.**
- **`PLATFORM_ORG_ID`** (`packages/registry/src/registry.ts`) is carried by the only two
  operations that legitimately have no organisation yet: `qrSession.create` (resolving a
  public QR token) and `discovery.read` (searching published restaurants across tenants).
  Every other handler scopes to `ctx.orgId` and would find nothing with it.
- **`serviceCall()`** (`packages/core/src/service-call.ts`) is how one service asks
  another for something over the bus. It takes the inbound `ctx`, so it can never reach
  further than the request that caused it. `orders` uses it to price a cart against
  `quote.read` in `catalog`. Services still may not import or query each other.

## Money
All money maths is in **integer paise**. Store `numeric(12,2)` in Postgres, convert at the
boundary. Currency is INR. Never do float arithmetic on a price.

## Verify before you report
```
pnpm exec biome check <the files you wrote>
```
Plus whatever your task names. Report honestly: if something does not compile and you could
not fix it inside your own files, say so in your `worker_done` body rather than claiming
success.
