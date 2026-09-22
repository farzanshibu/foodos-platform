# Writing the UI

Read `.claude/skills/client-mirror/SKILL.md` first. It is short and it is binding.

## The mirror
The browser and the gateway call the *same* pure functions. Never re-implement a limit
check, never hardcode a plan name, never write upgrade copy.

```tsx
<Gate resource="combo" operation="create" fallback={<UpgradePrompt decision={decision} />}>
  <Button>New combo</Button>
</Gate>
```

- Permission denied renders nothing. Plan denied renders the fallback — that is a sales
  moment, not an error.
- `useAccess(resource, operation)`, `usePermission`, `useRole`, `useResourceDecision`,
  `useUsageLabel` are the hooks. `useUsageLabel` is how a usage count is phrased — never
  format "3 of 10" by hand.
- Entitlements come from `ViewerProvider` in `app/(dashboard)/layout.tsx`. **Never fetch
  entitlements in a component.**

## Structure
- A feature's components live in `apps/web/src/features/<name>/`.
- A component used by two features moves to `packages/ui`.
- Pages are thin: they compose feature components and fetch through the tRPC client.
- shadcn components live in `packages/ui/src/components/ui/`. Add with `pnpm ui:add <name>`.

## Styling
- **Never hardcode a colour.** Token classes only: `bg-primary`, `text-muted-foreground`,
  `border-border`, `bg-card`. `apps/web/src/app/globals.css` owns the tokens and light/dark
  both follow from there.
- Every component takes `className` and merges it with `cn()`.
- Compose with slots (pass a node as a prop) rather than a boolean prop per variant.

## Errors
Denials arrive structured on `error.data.app`. Match on `code`: `UPGRADE_REQUIRED` gets an
upsell, `RATE_LIMITED` gets "try again shortly" with the retry seconds, everything else
shows the message as written. **Never regex an error message.**

## Responsiveness — this is a requirement, not a polish pass
The management app is used on a phone, one-handed, by a waiter who is walking.
- Desktop: left sidebar, grouped by the `group` field on each nav item (`NAV_GROUPS` in
  `@foodos/registry` gives the group order — do not write a section list by hand).
- Tablet: collapsible sidebar.
- Mobile: bottom navigation — Home, Orders, Tables, More. Critical actions reachable with a
  thumb. Do not simply shrink the desktop layout.

## The QR experience
`/q/[token]` must be fast — the target is under 1.5s to interactive on a mid-range phone on
a normal mobile connection. Server-render the menu. No heavy client bundle, no chart library,
no animation framework. It is a menu, a cart and a status card.

Request cards are **rendered from server config**. The client contains zero knowledge of any
specific request type: it receives a form schema and renders the fields generically. If you
find yourself writing `if (requestType.key === "charger")`, stop — that is the one thing this
whole feature exists to avoid.
