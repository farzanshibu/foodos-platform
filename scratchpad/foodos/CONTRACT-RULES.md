# Writing a contract file

Exemplar: `packages/contracts/src/resources/project.contract.ts`
Command-operation exemplar (acceptance shape): `packages/contracts/src/resources/identity.contract.ts`

Shape:

```ts
import { z } from "zod";
import { wireDate } from "../wire";

export const thingDto = z.object({ id: z.string(), /* ... */ createdAt: wireDate });

export const thingContract = {
  read:   { input: z.object({ /* ... */ }), output: z.object({ items: z.array(thingDto), nextCursor: z.string().nullable() }) },
  create: { input: z.object({ /* ... */ }), output: thingDto },
  update: { input: z.object({ id: z.string(), /* ... */ }), output: thingDto },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;
```

Rules:
- **One `input` and one `output` per operation the registry declares — no more, no fewer.**
  Your task lists the exact operations. A missing one fails to compile; an extra one is dead.
- `wireDate` for every timestamp. Never `z.date()` directly on the wire.
- A `command` transport operation's output is the acceptance shape
  `z.object({ accepted: z.literal(true), requestId: z.string() })` — the work has not
  happened yet when the caller gets its answer. Check `identity.contract.ts` `member.create`.
- `manage` is the catch-all verb. Model it as a **discriminated union input** on an `action`
  field when it covers several distinct actions, so each action's payload is exact:
  ```ts
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({ action: z.literal("publish"), id: z.string() }),
      z.object({ action: z.literal("unpublish"), id: z.string() }),
    ]),
    output: thingDto,
  },
  ```
- **No org id**, and no `restaurantId`/`branchId` used *as a tenant scope*. Those two are
  fine as ordinary foreign keys naming which restaurant or branch a row belongs to — the
  tenant is the organisation, and that is what may never appear.
- Reads that can grow are cursor-paginated: `cursor: z.string().nullish()`,
  `limit: z.number().int().min(1).max(100).default(20)`, output `nextCursor: string | null`.
- Do **not** edit `packages/contracts/src/contracts.ts` or `packages/contracts/src/index.ts`.
  The coordinator stitches those; two workers editing them would collide.
