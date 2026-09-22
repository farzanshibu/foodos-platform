/**
 * SOT: registry, source-of-truth, resources, plans, limits, feature-gates, permissions-source,
 *      nav-source, rate-limits, service-ownership, operation-rules
 * WHAT   The declaration. Plans and resources, and nothing computed.
 * WHY    One file to edit, one shape to follow. Everything else in the platform - permission
 *        strings, TypeScript unions, Better Auth roles, NATS subjects, queue groups, nav,
 *        route guards, plan gates, timeouts, audit and metering - is derived from this file
 *        by derive.ts. Adding an entry here is the whole change.
 * HOW    Copy an existing entry. Run `pnpm typecheck`: the errors that appear are the work.
 * WHERE  derive.ts, access.ts, @foodos/contracts, @foodos/core
 * EDIT   This is the only file in the package you edit by hand.
 */
import {
  definePlan,
  defineResource,
  distinctField,
  numberField,
  op,
  type PlanDefinition,
  type ResourceDefinition,
} from "./define";

/* ── Plans ───────────────────────────────────────────────────────────────── */

export const PLANS = {
  starter: definePlan({
    label: "Starter",
    tagline: "One restaurant, one branch, QR ordering from day one.",
    autumnProductId: "starter",
    rank: 0,
    priceMonthlyUsd: 0,
    priceYearlyUsd: null,
    trialDays: null,
  }),
  growth: definePlan({
    label: "Growth",
    tagline: "A few branches, a CRM and loyalty behind them.",
    autumnProductId: "growth",
    rank: 1,
    priceMonthlyUsd: 29,
    priceYearlyUsd: 290,
    trialDays: 14,
  }),
  pro: definePlan({
    label: "Pro",
    tagline: "A chain, its API, and analytics that go back a year.",
    autumnProductId: "pro",
    rank: 2,
    priceMonthlyUsd: 99,
    priceYearlyUsd: 990,
    trialDays: 14,
  }),
  enterprise: definePlan({
    label: "Enterprise",
    tagline: "Unlimited everything, white-labelled.",
    autumnProductId: "enterprise",
    rank: 3,
    priceMonthlyUsd: 299,
    priceYearlyUsd: 2990,
    trialDays: 30,
  }),
} satisfies Record<string, PlanDefinition>;

export type PlanKey = keyof typeof PLANS;
export const DEFAULT_PLAN = "starter" satisfies PlanKey;

/**
 * The org id carried by the two operations that genuinely have no organisation yet:
 * resolving a QR token before anyone knows whose restaurant it belongs to, and searching
 * the published marketplace across tenants.
 *
 * It is a declared, impossible-to-collide value rather than an empty string because every
 * other handler scopes its query to `ctx.orgId`, and an org id that matches no row is the
 * behaviour we want if one of them is ever reached with it: nothing found, rather than
 * everything. The two handlers allowed to see it say so out loud and ignore it.
 */
export const PLATFORM_ORG_ID = "org:platform" as const;

const upgradeCopy =
  (noun: string) =>
  (nextPlanLabel: string | null): string =>
    nextPlanLabel === null
      ? `You have used every ${noun} on the highest plan. Talk to us about a custom limit.`
      : `You have used every ${noun} on your plan. ${nextPlanLabel} raises the limit.`;

/* ── Resources ───────────────────────────────────────────────────────────── */

export const RESOURCES = {
  /**
   * The tenant itself. Better Auth mounts HTTP endpoints for these at /api/auth, and every
   * one of them bypassed all eleven gates: no minRole, no permission, no rate limit keyed
   * on anything that exists, no plan gate, and no evt.* - so deleting an organisation left
   * no audit row. Declaring it here is what puts it back inside the block.
   *
   * `create` is deliberately not the endpoint a new user calls. A user's first workspace is
   * created server-side at signup, so it cannot be looped; this operation is the one that
   * makes a *second* one, which is why it is owner-only and counts against the plan. The
   * automatic first workspace is not metered, so `limits` counts workspaces beyond it.
   */
  organization: defineResource({
    label: "Organisations",
    description: "The tenant itself: its name, slug and lifecycle. The first one is free.",
    owner: "identity",
    featureId: "organizations",
    operations: {
      read: op({
        /** The projector names the organisation on its dimension rows. */
        internalCallers: ["insights"],
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: false, growth: 3, pro: 10, enterprise: "unlimited" },
    rateLimit: { max: 10, windowSeconds: 60 },
    nav: null,
    upgrade: (next) =>
      next === null
        ? "You have used every organisation on the highest plan. Talk to us about a custom limit."
        : `Your plan includes one organisation. ${next} lets you run several.`,
  }),

  /**
   * Leaving is not the same act as removing somebody, so it is not the same operation.
   * `member.delete` means "remove a person" and is owner-only; this means "remove myself"
   * and every member may do it. Folding the two together would have forced member.delete
   * down to minRole member and moved an "is this your own row" test into a handler - a gate
   * decided by feature code is the one thing the block exists to prevent.
   */
  membership: defineResource({
    label: "Membership",
    description: "The caller's own seat in the organisation.",
    owner: "identity",
    featureId: null,
    operations: {
      delete: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 5, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Leaving an organisation is available on every plan.",
  }),

  project: defineResource({
    label: "Projects",
    description: "The top-level container a customer organises work in.",
    owner: "projects",
    featureId: "projects",
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 2, growth: 25, pro: 100, enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/projects", label: "Projects", order: 99, group: "Workspace" },
    upgrade: upgradeCopy("project"),
  }),

  member: defineResource({
    label: "Team",
    description: "People with a seat in the organisation.",
    owner: "identity",
    featureId: "seats",
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      // A command: sending an invitation involves an email provider that can be slow.
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "command",
        consumes: true,
        audit: true,
        timeoutMs: 8000,
      }),
      /**
       * Changing somebody's role. Owner-only, because an admin who can grant `owner` is an
       * admin who can take the organisation: nothing compared the requested role to the
       * caller's, and Better Auth's own update-member-role endpoint carried no such check
       * either. The handler additionally refuses a role above the caller's own, so the gate
       * and the service agree rather than one trusting the other.
       */
      update: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /**
       * Rostering: which stations a seat works. Deliberately NOT folded into `update`, for
       * the same reason `membership.delete` is not `member.delete`: they are different acts.
       * `update` hands out rank and is owner-only because an admin who can grant `owner` can
       * take the organisation. A station grants no authority at all - it says which of the
       * restaurant's posts somebody is on tonight - so it is the shift manager's job, and
       * gating it at owner would mean nobody could staff the floor without the founder.
       * Audited, because who could see the till last Tuesday is a question worth answering.
       */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 3, growth: 15, pro: 50, enterprise: "unlimited" },
    rateLimit: { max: 30, windowSeconds: 60 },
    nav: { href: "/team", label: "Staff", order: 61, group: "Management" },
    upgrade: upgradeCopy("seat"),
  }),

  invitation: defineResource({
    label: "Invitations",
    description: "Pending invites to join the organisation.",
    owner: "identity",
    featureId: null,
    operations: {
      read: op({
        minRole: "admin",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 5, growth: "unlimited", pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 10, windowSeconds: 60 },
    nav: null,
    upgrade: upgradeCopy("invitation"),
  }),

  billing: defineResource({
    label: "Billing",
    description: "Plan, entitlements and checkout.",
    owner: "billing",
    featureId: null,
    /** The meter: every event carrying units is reported to Autumn from here. */
    consumesEvents: true,
    operations: {
      read: op({
        minRole: "admin",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      manage: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 8000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 20, windowSeconds: 60 },
    nav: { href: "/billing", label: "Subscription", order: 80, group: "Billing" },
    upgrade: () => "Billing is available on every plan.",
  }),

  auditLog: defineResource({
    label: "Audit log",
    description: "Immutable record of every mutation the gateway allowed.",
    owner: "audit",
    featureId: null,
    /** The trail: every event on EVT is written down here. */
    consumesEvents: true,
    operations: {
      read: op({
        minRole: "admin",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
    },
    limits: { starter: false, growth: 90, pro: 365, enterprise: "unlimited" },
    rateLimit: { max: 30, windowSeconds: 60 },
    nav: { href: "/audit", label: "Audit log", order: 66, group: "Management" },
    upgrade: (next) =>
      next === null
        ? "Audit retention is already unlimited."
        : `Audit history is not included in your plan. ${next} keeps it.`,
  }),
  /* ── FoodOS: catalog ─────────────────────────────────────────────────────
   * `minRole: "guest"` is not a weaker gate, it is a wider audience: guest is the lowest
   * rank, so every staff role passes the same check by roleAtLeast. It marks the reads a
   * person sitting at a table with a QR session is allowed to make. Their org is pinned by
   * that session, resolved server-side, so a guest still cannot see another tenant's menu.
   */
  restaurant: defineResource({
    label: "Restaurants",
    description: "A restaurant brand inside the organisation.",
    owner: "catalog",
    featureId: "restaurants",
    operations: {
      read: op({
        /** The projector names the restaurant; the scan resolves which one a code belongs to. */
        internalCallers: ["insights", "qr"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Publish or unpublish. A published restaurant is discoverable in the marketplace. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: false, growth: 1, pro: 5, enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/restaurants", label: "Restaurants", order: 60, group: "Management" },
    upgrade: upgradeCopy("restaurant"),
  }),

  branch: defineResource({
    label: "Branches",
    description: "A physical location of a restaurant, with its own tables, hours and orders.",
    owner: "catalog",
    featureId: "branches",
    operations: {
      read: op({
        /** An order asks which restaurant a branch belongs to; a scan resolves the branch. */
        internalCallers: ["orders", "qr"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Opening hours for the whole week, replaced as one set rather than seven endpoints. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 1, growth: 3, pro: 10, enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/branches", label: "Branches", order: 62, group: "Management" },
    upgrade: upgradeCopy("branch"),
  }),

  menu: defineResource({
    label: "Menus",
    description: "A named menu a branch serves. Master menus cascade to branches.",
    owner: "catalog",
    featureId: "menus",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 1, growth: 5, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/menus", label: "Menus", order: 20, group: "Catalog" },
    upgrade: upgradeCopy("menu"),
  }),

  menuCategory: defineResource({
    label: "Categories",
    description: "Sections within a menu: starters, mains, drinks.",
    owner: "catalog",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 10, growth: 50, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/categories", label: "Categories", order: 21, group: "Catalog" },
    upgrade: upgradeCopy("category"),
  }),

  menuItem: defineResource({
    label: "Items",
    description: "A dish: price, variants, allergens, availability.",
    owner: "catalog",
    featureId: "menu-items",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Bulk edit, availability scheduling, duplicate, import and export. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 8000,
      }),
    },
    limits: { starter: 50, growth: 500, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/items", label: "Items", order: 22, group: "Catalog" },
    upgrade: upgradeCopy("menu item"),
  }),

  menuModifier: defineResource({
    label: "Modifiers",
    description: "Add-on and variant groups with min/max selection rules.",
    owner: "catalog",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/modifiers", label: "Modifiers", order: 23, group: "Catalog" },
    upgrade: upgradeCopy("modifier"),
  }),

  combo: defineResource({
    label: "Combos",
    description:
      "A bundle sold as one unit, priced at a flat rate or a flat percentage off its parts.",
    owner: "catalog",
    featureId: "combos",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Availability. A deactivated combo leaves historical orders untouched. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 5, growth: 25, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/combos", label: "Combos", order: 24, group: "Catalog" },
    upgrade: upgradeCopy("combo"),
  }),

  /**
   * Pricing lives with the menu because that is where prices are. `orders` reaches it
   * over the bus with a signed system envelope; a client-supplied price is never read.
   */
  quote: defineResource({
    label: "Quotes",
    description: "Server-authoritative pricing for a cart, including combo maths and tax.",
    owner: "catalog",
    featureId: null,
    operations: {
      /** The only price anyone is allowed to believe. Orders calls this over the bus rather than importing the catalogue, and the browser only ever renders what comes back. */
      read: op({
        /** Pricing. Orders never reads the menu; it asks the catalogue for a total. */
        internalCallers: ["orders"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 240, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Pricing is available on every plan.",
  }),

  /* ── FoodOS: floor ───────────────────────────────────────────────────────── */
  place: defineResource({
    label: "Tables",
    description: "A table on the floor plan, its seats, its state and its custom parameters.",
    owner: "floor",
    featureId: "tables",
    operations: {
      read: op({
        /** A cart and an order resolve the seat; a scan resolves the place it names. */
        internalCallers: ["orders", "qr"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /**
       * The one operation in the platform where a single call creates more than one row.
       *
       * The grid arm lays out `rows` x `columns` places - a cinema screen - so the plan gate
       * has to be asked about that number and not about one. Rows are counted DISTINCT because
       * the service deduplicates a repeated row letter before it writes, and the `one` arm
       * carries neither field, so this reads 0 there and `unitsOf` floors it at one place.
       *
       * It over-counts in exactly one way, deliberately: a grid re-run against labels that
       * already exist is charged for all of them, because nothing at the edge can know which
       * ones the service will skip. The meter is not fooled by that - it counts what the
       * handler actually created - and a gate that guesses high refuses a screen that would
       * have fitted, which is the direction a limit is allowed to be wrong in.
       */
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
        units: (input) => distinctField(input, "rows") * numberField(input, "columns"),
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /**
       * State changes and layout moves - a waiter marking a table occupied is not an admin
       * action. It is a floor action though: seating, clearing and moving tables is what the
       * service post does all shift, and neither the pass nor the till ever touches it.
       */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
        stations: ["service"],
      }),
    },
    limits: { starter: 20, growth: 100, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/places", label: "Places", order: 12, group: "Operations" },
    upgrade: upgradeCopy("table"),
  }),

  section: defineResource({
    label: "Sections",
    description: "Floors and sections a table belongs to.",
    owner: "floor",
    featureId: null,
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: null,
    upgrade: upgradeCopy("section"),
  }),

  parameterDefinition: defineResource({
    label: "Table parameters",
    description: "Reusable custom attributes a restaurant defines once and assigns per table.",
    owner: "floor",
    featureId: "table-parameters",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 3, growth: 10, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: {
      href: "/manage/table-parameters",
      label: "Table parameters",
      order: 63,
      group: "Management",
    },
    upgrade: upgradeCopy("table parameter"),
  }),

  /* ── FoodOS: QR ──────────────────────────────────────────────────────────── */
  qrCode: defineResource({
    label: "QR codes",
    description:
      "A public token that resolves server-side to a restaurant, branch, table or request type.",
    owner: "qr",
    featureId: null,
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Rotate the token, revoke it, or render it for print. Rotating invalidates every card already printed, so it is audited. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 8000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/qr-codes", label: "QR codes", order: 64, group: "Management" },
    upgrade: () => "QR codes are included on every plan.",
  }),

  qrSession: defineResource({
    label: "QR sessions",
    description: "A scan in progress: which table, which guest, how often to poll.",
    owner: "qr",
    featureId: null,
    operations: {
      read: op({
        /** A shared cart and a service request read the seat off the scan session. */
        internalCallers: ["orders", "requests"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /** Established server-side by the scan page before any browser code runs; the token is resolved, never trusted. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      /** Heartbeat, attach guest contact details, or end the session. */
      manage: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 240, windowSeconds: 60 },
    /**
     * The one resource in the product whose input is a secret being guessed. Resolving a
     * scanned code runs before any identity exists, so possessing a valid token is the whole
     * of the guest surface's security - and unthrottled guessing is what makes that token's
     * entropy matter. Twenty failures in ten minutes is roughly a hundredth of the allowance
     * above: a mistyped code, a table tent reprinted last week or a dead link fails a handful
     * of times and stops, while a caller still failing twice a minute ten minutes later is
     * searching. The window bounds the collateral - a venue whose guests share one NAT
     * address recovers by itself, with nobody called out to fix it.
     */
    failureRateLimit: { max: 20, windowSeconds: 600 },
    nav: null,
    upgrade: () => "QR sessions are included on every plan.",
  }),

  cardDesign: defineResource({
    label: "Card designer",
    description: "Printable request and table cards: template, theme, embedded QR, downloads.",
    owner: "qr",
    featureId: "card-designs",
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Render to SVG, PNG or PDF. A command because rasterising at 300 DPI is slow enough to be worth doing off the request path. */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "command",
        consumes: false,
        audit: true,
        timeoutMs: 10000,
      }),
    },
    limits: { starter: 1, growth: 10, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/card-designer", label: "Card designer", order: 65, group: "Management" },
    upgrade: upgradeCopy("card design"),
  }),

  /* ── FoodOS: orders ──────────────────────────────────────────────────────── */
  cart: defineResource({
    label: "Carts",
    description: "A basket, shared by everyone sitting at one place.",
    owner: "orders",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      update: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      delete: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /**
       * Closing the basket a table is holding, when staff clear that table.
       *
       * Gated exactly like `place.manage`, which is the only thing that calls it: same rank,
       * same post. Clearing a table and closing what that table was holding are one action to
       * the person doing it, so two different answers about who may do it would mean a waiter
       * who can free table twelve but cannot finish freeing it.
       *
       * Audited where the rest of `cart` is not: every other operation here is a guest moving
       * their own dishes around, and this one is staff ending somebody else's basket.
       */
      manage: op({
        /** The floor service, clearing a place. No browser calls this. */
        internalCallers: ["floor"],
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 4000,
        stations: ["service"],
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 240, windowSeconds: 60 },
    /**
     * The one resource more than one person holds open at the same moment. Three phones at a
     * table share a basket, so a change on any of them has to reach the other two - and the
     * alternative to a nudge is every phone asking every few seconds whether anything
     * happened, which is slower, noisier, and still behind.
     */
    notify: true,
    nav: null,
    upgrade: () => "Carts are included on every plan.",
  }),

  order: defineResource({
    label: "Orders",
    description: "A placed order and its state machine, from created through to completed.",
    owner: "orders",
    featureId: "orders",
    operations: {
      read: op({
        /** The projector folds the order into its fact tables. */
        internalCallers: ["insights"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /** The metered unit of the product. Prices come from the catalogue, never from the caller. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 8000,
      }),
      /**
       * Amending a placed order - the order console. Worked from the floor and from the
       * counter, so both posts hold it; the line does not, because the kitchen's view of an
       * order is its ticket and its only verbs are accept, start and ready.
       */
      update: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
        stations: ["service", "till"],
      }),
      /** Every status transition. The legal set lives in the service, not in whoever calls this. */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
        stations: ["service", "till"],
      }),
    },
    limits: { starter: 500, growth: 3000, pro: 10000, enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/orders", label: "Orders", order: 10, group: "Operations" },
    upgrade: upgradeCopy("order"),
  }),

  kitchenTicket: defineResource({
    label: "Kitchen",
    description: "Tickets on the kitchen display, routed to stations.",
    owner: "orders",
    featureId: null,
    operations: {
      /**
       * The kitchen display itself. It was readable by every member, so the cashier at the
       * till and the waiter on the floor both had a live feed of the pass they have no part
       * in. `stations` is what makes the description above true of the permission as well:
       * a ticket is routed to a station, and now so is the screen showing it.
       */
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
        stations: ["kitchen"],
      }),
      /** Accept, start, mark ready. Kitchen staff hold no other permission. */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 4000,
        stations: ["kitchen"],
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 240, windowSeconds: 60 },
    nav: { href: "/manage/kitchen", label: "Kitchen", order: 11, group: "Operations" },
    upgrade: () => "The kitchen display is included on every plan.",
  }),

  payment: defineResource({
    label: "Payments",
    description: "Gateway payments and refunds. Confirmed only from a signature-verified webhook.",
    owner: "orders",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      /** Opens a payment with the provider. It does not mark anything paid. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 8000,
      }),
      /** Refunds, and the reconciliation the verified webhook triggers. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 10000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Payments are included on every plan.",
  }),

  /* ── FoodOS: service requests ────────────────────────────────────────────── */
  /**
   * The form a guest fills in is data, not code: the field list lives in a JSONB column
   * and is turned into a validator at request time. Adding \"request a charger\" is a
   * configuration change, so no client release is needed and no request key is hardcoded.
   */
  requestType: defineResource({
    label: "Request types",
    description: "Staff-configured request cards: label, icon, form fields, routing and SLA.",
    owner: "requests",
    featureId: "request-types",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 5, growth: 25, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/request-types", label: "Request types", order: 67, group: "Management" },
    upgrade: upgradeCopy("request type"),
  }),

  serviceRequest: defineResource({
    label: "Requests",
    description: "A guest asking for something, from submitted through to completed.",
    owner: "requests",
    featureId: null,
    operations: {
      read: op({
        /** The projector folds the request funnel into its fact tables. */
        internalCallers: ["insights"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /** Re-validated against the request type's current form schema, not the one the browser rendered. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Cancel, while nobody has acknowledged it yet. */
      update: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 4000,
      }),
      /**
       * Acknowledge, start, complete, reject or assign - the request console. A request is a
       * table asking for something at the table, and the person who walks to the table is
       * the service post. The till and the pass do not leave theirs; somebody who genuinely
       * does both is given both stations rather than a role invented for the pair.
       */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 4000,
        stations: ["service"],
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/requests", label: "Requests", order: 13, group: "Operations" },
    upgrade: () => "Service requests are included on every plan.",
  }),

  /* ── FoodOS: CRM and marketing ───────────────────────────────────────────── */
  customer: defineResource({
    label: "Customers",
    description: "Diners the restaurant knows: orders, spend, favourites, segment.",
    owner: "crm",
    featureId: "crm",
    operations: {
      read: op({
        minRole: "member",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /** A guest naming themselves at checkout. Not an admin creating a record. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 4000,
      }),
      update: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: false, growth: "unlimited", pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/customers", label: "Customers", order: 30, group: "Customers" },
    upgrade: upgradeCopy("customer"),
  }),

  review: defineResource({
    label: "Reviews",
    description: "Ratings of food, service, ambience and value, with restaurant replies.",
    owner: "crm",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** The restaurant's public reply. */
      update: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Flag or report. Platform moderation is a separate, audited surface. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/reviews", label: "Reviews", order: 31, group: "Customers" },
    upgrade: () => "Reviews are included on every plan.",
  }),

  favorite: defineResource({
    label: "Favourites",
    description: "Restaurants and dishes a diner saved.",
    owner: "crm",
    featureId: null,
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      delete: op({
        minRole: "guest",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 240, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Favourites are included on every plan.",
  }),

  promotion: defineResource({
    label: "Promotions",
    description: "Percentage, fixed, BOGO, happy hour and first-order offers with conditions.",
    owner: "crm",
    featureId: "promotions",
    operations: {
      read: op({
        /** The quote applies a promotion it does not own. */
        internalCallers: ["catalog"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 2, growth: 25, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/promotions", label: "Promotions", order: 40, group: "Marketing" },
    upgrade: upgradeCopy("promotion"),
  }),

  coupon: defineResource({
    label: "Coupons",
    description: "Redeemable codes attached to a promotion.",
    owner: "crm",
    featureId: null,
    operations: {
      read: op({
        /** The quote applies a coupon it does not own. */
        internalCallers: ["catalog"],
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: true,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      delete: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: 2, growth: 25, pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/coupons", label: "Coupons", order: 41, group: "Marketing" },
    upgrade: upgradeCopy("coupon"),
  }),

  loyalty: defineResource({
    label: "Loyalty",
    description: "Points, tiers and the ledger behind them.",
    owner: "crm",
    featureId: "loyalty",
    operations: {
      read: op({
        minRole: "guest",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 3000,
      }),
      /** Define the programme: earn rate, redemption rate, expiry. */
      create: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      update: op({
        minRole: "admin",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
      /** Adjust a diner's balance. Always a ledger entry, never a mutated total. */
      manage: op({
        minRole: "member",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 5000,
      }),
    },
    limits: { starter: false, growth: "unlimited", pro: "unlimited", enterprise: "unlimited" },
    rateLimit: { max: 120, windowSeconds: 60 },
    nav: { href: "/manage/loyalty", label: "Loyalty", order: 32, group: "Customers" },
    upgrade: upgradeCopy("loyalty programme"),
  }),

  /* ── FoodOS: insights ────────────────────────────────────────────────────── */
  analyticsEvent: defineResource({
    label: "Events",
    description: "The product's own event stream: scans, views, cart steps, request funnels.",
    owner: "insights",
    featureId: null,
    /** The projector: every event is folded into the insights fact tables here. */
    consumesEvents: true,
    operations: {
      /** Durable and at-least-once, deduplicated on the event id, so a browser retry cannot double-count a funnel step. */
      create: op({
        minRole: "guest",
        kind: "mutation",
        transport: "command",
        consumes: false,
        audit: false,
        timeoutMs: 5000,
      }),
      read: op({
        minRole: "admin",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 6000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 600, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Event tracking is included on every plan.",
  }),

  analytics: defineResource({
    label: "Analytics",
    description: "Sales, orders, customers, menu, QR and request reporting.",
    owner: "insights",
    featureId: "analytics",
    operations: {
      read: op({
        minRole: "admin",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 8000,
      }),
      /** Export. A command because a year of orders is not a request-path job. */
      manage: op({
        minRole: "admin",
        kind: "mutation",
        transport: "command",
        consumes: false,
        audit: true,
        timeoutMs: 15000,
      }),
    },
    limits: { starter: 7, growth: 90, pro: 365, enterprise: "unlimited" },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: { href: "/manage/analytics", label: "Analytics", order: 50, group: "Analytics" },
    upgrade: (next) =>
      next === null
        ? "Analytics history is already unlimited."
        : `Your plan keeps a shorter analytics history. ${next} keeps more of it.`,
  }),

  /**
   * Reachable only from the organisation named by the platform's own environment, asserted
   * inside the service rather than by the role gate: `owner` here means owner of that one
   * organisation. Every call is audited, because cross-tenant reads should be explainable.
   */
  platformAdmin: defineResource({
    label: "Platform",
    description: "Cross-tenant operations for whoever runs the SaaS itself.",
    owner: "insights",
    featureId: null,
    operations: {
      read: op({
        minRole: "owner",
        kind: "query",
        transport: "rpc",
        consumes: false,
        audit: false,
        timeoutMs: 8000,
      }),
      manage: op({
        minRole: "owner",
        kind: "mutation",
        transport: "rpc",
        consumes: false,
        audit: true,
        timeoutMs: 10000,
      }),
    },
    limits: {
      starter: "unlimited",
      growth: "unlimited",
      pro: "unlimited",
      enterprise: "unlimited",
    },
    rateLimit: { max: 60, windowSeconds: 60 },
    nav: null,
    upgrade: () => "Platform administration is not part of a customer plan.",
  }),
} satisfies Record<string, ResourceDefinition>;

export type ResourceKey = keyof typeof RESOURCES;
