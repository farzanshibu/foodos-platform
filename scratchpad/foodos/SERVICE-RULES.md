# Writing a service

Exemplar: `services/projects/` — read all of `src/` before you start. Your service's
`package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/db.ts` and `src/index.ts` are
already scaffolded and correct. **Do not change them.** You write:

```
services/<name>/src/schema.ts              the tables this service owns
services/<name>/src/<resource>.service.ts  queries only
services/<name>/src/<resource>.handlers.ts business rules only
services/<name>/src/handlers.ts            one flat array, re-exported as `handlers`
```

`src/index.ts` already does `import { handlers } from "./handlers"`, so that file must
exist and export a `handlers` array covering **every** operation the registry says this
service owns. `defineService` throws at boot if one is missing or if you handle a resource
you do not own — that is the check, not a comment.

## schema.ts
- Drizzle `pgTable`. Every tenant-owned table has `organizationId: text("organization_id").notNull()`.
- **`organization_id` is a plain column, never a foreign key** — the organisation lives in
  another service's schema. Cross-service referential integrity is done with events, not FKs.
- Foreign keys *within* this service are fine and encouraged.
- Index every table on `(organization_id, ...)` — an index that does not lead with the org
  id is an index a cross-tenant query could use.
- IDs are prefixed ULIDs generated in the service, e.g. `ord_01J...`. There is no shared id
  helper yet; write one small `id(prefix)` function in the service that owns it.
- Money: `numeric(12,2)`. Convert to and from integer paise at the edge of the service.
- Export `export type XRow = typeof x.$inferSelect;` — never hand-write a row type.

## <resource>.service.ts
- Opens with `import "server-only";`
- **Every function takes `organizationId` as an argument** and filters on it. There must be
  no function in the file capable of a cross-tenant query.
- Queries only. No business rules, no throwing `ServiceError`.

## <resource>.handlers.ts
- Opens with `import "server-only";`
- `handlerFor("<resource>", "<operation>", async ({ ctx, input }) => ...)`.
  **Never annotate `input` or the return type** — both are inferred from the contract, and
  annotating them is how they silently drift.
- `ctx.orgId` is the only tenant scope. Never read an org id from `input`.
- Throw `ServiceError` with a code from `@foodos/contracts`:
  `NOT_FOUND`, `CONFLICT`, `INVALID_INPUT`, `PERMISSION_DENIED`, `INTERNAL`, `UPGRADE_REQUIRED`.
- Do **not** write an auth check, a permission check, a rate limit, an audit row or a
  metering call. All five already happened; `audit: true` in the registry emits the event.
- A `command` handler must be **idempotent** — it will occasionally run twice. Use a unique
  column plus `onConflictDoNothing`, or check-then-skip on a natural key.

## Talking to another service
Never import it and never query its tables. Use:

```ts
import { serviceCall } from "@foodos/core";
const priced = await serviceCall({ ctx, resource: "quote", operation: "read", input, secret });
```

It inherits the org, user, role and deadline from `ctx`, so it cannot reach further than the
request that caused it.

## State machines
Put the status union and its transition map in the service, as `as const` objects, and go
through one `assertTransition(from, to)` function. Never set a status inline. An illegal
transition is a `CONFLICT`, not a silent write.

## Migrations
```
pnpm --filter @foodos/service-<name> db:generate
```
Do not run `db:migrate` — no database is running in this environment. Generating is enough;
the coordinator runs migrations at the end.

## Verify
```
pnpm --filter @foodos/service-<name> typecheck
pnpm exec biome check services/<name>
```
Fix everything. If an error comes from a file another worker owns, say so in your report
instead of editing their file.
