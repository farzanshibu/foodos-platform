# Writing a gateway router

Exemplar: `apps/web/src/gateway/routers/project.router.ts`

A router file is a list of one-line routes and nothing else:

```ts
export const orderRouter = createTRPCRouter({
  list:   gatewayQuery("order", "read"),
  create: gatewayMutation("order", "create"),
  update: gatewayMutation("order", "update"),
  setStatus: gatewayMutation("order", "manage"),
});
```

- No conditionals. No database. No transformation. No `.use()`. `pnpm foodos` reads this
  file as text and refuses control flow in it, **comments included**.
- `gatewayQuery` for a registry `kind: "query"`, `gatewayMutation` for a mutation. Using the
  wrong one throws at module load with a message naming the right one.
- The input schema comes from the contract automatically. Never `.input(...)` here.
- Do **not** edit `apps/web/src/gateway/routers/_app.ts` — the coordinator stitches it.

## The public and guest surfaces

Two surfaces do **not** go through a tRPC router, and both are deliberate:

1. **The scan page**, `apps/web/src/app/q/[token]/page.tsx`. A guest has no identity yet, so
   there is nothing for `dispatch` to identify. The page is a server component: it resolves
   the public token by calling `qrSession.create` with `signedEnvelopeFor` (which is allowed
   only inside `apps/web/src/gateway`), using `PLATFORM_ORG_ID`, then mints a guest ticket
   with `signTicket` and sets it as an HttpOnly, SameSite=Lax, Secure cookie named by
   `GUEST_COOKIE` in `apps/web/src/gateway/guest-session.ts`. From that request onward the
   guest is a normal principal and every later call goes through the full block.
2. **Marketplace discovery**, for a visitor with no QR session at all. Same shape: a server
   component calling `discovery.read` with `PLATFORM_ORG_ID`. Published public profile data
   only.

Put the shared helper for both in `apps/web/src/gateway/public-call.ts` so
`signedEnvelopeFor` stays inside the gateway directory where the architecture check allows
it. A page must never import `signedEnvelopeFor`, `signRequest`, `rpcRequest` or
`publishCommand` directly.

## The payment webhook

`apps/web/src/app/api/webhooks/payments/route.ts`. Verify the provider signature **first**,
before parsing anything as meaningful, then call `payment.manage` through the same
gateway-internal path. A client-side "payment succeeded" screen confirms nothing; only a
signature-verified webhook may move an order to paid.

## The route-guard gap

Any page that renders without making an API call is not protected by the block. Every
management page must live under `apps/web/src/app/(dashboard)/`, whose layout maps the
pathname to a resource with `resourceForPath()` and applies the same permission and plan
rules. The guest pages under `/q/` and the public pages are outside it on purpose — they
have their own gate, described above.
