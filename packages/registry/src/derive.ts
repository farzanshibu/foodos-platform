/**
 * SOT: derive, derived-registry, permissions, entitlements, subjects, nav, streams,
 *      plan-limits, feature-gate, client-mirror, role-rank, queue-groups,
 *      assignable-roles, role-normalisation, plan-catalog, feature-rows,
 *      over-plan, downgrade-blockers, yearly-savings, trial-offer,
 *      station-gate, station-rank-exemption, grant, station-normalisation,
 *      units-of, unit-count, bulk-units, counted-refusal
 * WHAT   Every view of the registry, computed from registry.ts by one pipeline.
 * WHY    Six things need the same facts - gateway, service, bus, browser, nav and billing.
 *        Computed here, they cannot disagree, and there is no parallel list to maintain.
 * HOW    Nothing in this file is written by hand. If you are about to type a value that
 *        could be computed from registry.ts, compute it here instead.
 * WHERE  index.ts, and through it every package in the platform
 * EDIT   Do not add data here. Data goes in registry.ts.
 */
import {
  DEFAULT_UNITS,
  fromKeys,
  keysOf,
  type Limit,
  type NavEntry,
  OPERATIONS,
  type Operation,
  type OperationRule,
  ORG_ROLES,
  type OrgRole,
  type ResourceDefinition,
  SERVICES,
  type ServiceName,
  STATIONS,
  type Station,
} from "./define";
import { DEFAULT_PLAN, PLANS, type PlanKey, RESOURCES, type ResourceKey } from "./registry";

/* ── Keys and guards ─────────────────────────────────────────────────────── */

export const PLAN_KEYS: readonly PlanKey[] = keysOf(PLANS);
export const RESOURCE_KEYS: readonly ResourceKey[] = keysOf(RESOURCES);

/** Operations a resource actually declared. An absent key cannot be called anywhere. */
export type OperationOf<K extends ResourceKey> = Extract<
  keyof (typeof RESOURCES)[K]["operations"],
  Operation
>;

export function isResourceKey(value: unknown): value is ResourceKey {
  return typeof value === "string" && RESOURCE_KEYS.some((key) => key === value);
}

export function isOperation(value: unknown): value is Operation {
  return typeof value === "string" && OPERATIONS.some((operation) => operation === value);
}

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.some((key) => key === value);
}

/** Narrows an untrusted operation string against the resource that must declare it. */
export function isOperationOf<K extends ResourceKey>(
  resource: K,
  value: unknown,
): value is OperationOf<K> {
  return typeof value === "string" && value in RESOURCES[resource].operations;
}

const OPERATION_INDEX: Readonly<Record<ResourceKey, readonly Operation[]>> = fromKeys(
  RESOURCE_KEYS,
  (resource) => OPERATIONS.filter((operation) => operation in RESOURCES[resource].operations),
);

export function operationsOf<K extends ResourceKey>(resource: K): readonly OperationOf<K>[] {
  return OPERATION_INDEX[resource].filter((operation): operation is OperationOf<K> =>
    isOperationOf(resource, operation),
  );
}

export function ruleFor<K extends ResourceKey>(
  resource: K,
  operation: OperationOf<K>,
): OperationRule {
  /**
   * Widened to the declared shape before indexing. Each resource literal only carries the
   * operations it declared, so indexing the union directly is an implicit `any`; naming the
   * supertype the registry already satisfies keeps the lookup honest without an assertion.
   */
  const declared: Readonly<Partial<Record<Operation, OperationRule>>> =
    RESOURCES[resource].operations;
  const rule = declared[operation];
  if (rule === undefined) {
    throw new Error(`Undeclared operation ${String(operation)} on resource ${resource}.`);
  }
  return rule;
}

export function resourcesOwnedBy(service: ServiceName): readonly ResourceKey[] {
  return RESOURCE_KEYS.filter((resource) => RESOURCES[resource].owner === service);
}

export const OWNERSHIP: Readonly<Record<ServiceName, readonly ResourceKey[]>> = fromKeys(
  SERVICES,
  resourcesOwnedBy,
);

/* ── Plans ───────────────────────────────────────────────────────────────── */

export const PLANS_ASCENDING: readonly PlanKey[] = [...PLAN_KEYS].sort(
  (a, b) => PLANS[a].rank - PLANS[b].rank,
);

export function planRank(plan: PlanKey): number {
  return PLANS[plan].rank;
}

export function isAtLeastPlan(current: PlanKey, required: PlanKey): boolean {
  return planRank(current) >= planRank(required);
}

export function nextPlanAfter(plan: PlanKey): PlanKey | null {
  const index = PLANS_ASCENDING.indexOf(plan);
  const next = index < 0 ? undefined : PLANS_ASCENDING[index + 1];
  return next ?? null;
}

export function planFromAutumnProductId(productId: string): PlanKey | null {
  return PLAN_KEYS.find((key) => PLANS[key].autumnProductId === productId) ?? null;
}

/* ── Permissions ─────────────────────────────────────────────────────────── */

export type Permission = { [K in ResourceKey]: `${K}:${OperationOf<K>}` }[ResourceKey];

export function toPermission<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
): `${K}:${O}` {
  return `${resource}:${operation}`;
}

export const PERMISSIONS: readonly Permission[] = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).map((operation) => toPermission(resource, operation)),
);

/**
 * `guest` sits below every staff role at rank 0, which is what makes `minRole: "guest"` mean
 * "anyone, including somebody at a table with no account" rather than "guests only": every
 * staff role clears it by roleAtLeast, so a guest-readable operation needs no second rule
 * for staff.
 */
export const ROLE_RANK: Readonly<Record<OrgRole, number>> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const ROLES_ASCENDING: readonly OrgRole[] = [...ORG_ROLES].sort(
  (a, b) => ROLE_RANK[a] - ROLE_RANK[b],
);

/**
 * The two ends of ROLE_RANK, reduced rather than indexed so `noUncheckedIndexedAccess` has
 * nothing to complain about and neither end is a role name typed by hand. LOWEST_ROLE is
 * what an unrecognised role degrades to; HIGHEST_ROLE is what the creator of an
 * organisation is given.
 */
export const LOWEST_ROLE: OrgRole = ROLES_ASCENDING.reduce(
  (lowest, role) => (ROLE_RANK[role] < ROLE_RANK[lowest] ? role : lowest),
  ORG_ROLES[0],
);

export const HIGHEST_ROLE: OrgRole = ROLES_ASCENDING.reduce(
  (highest, role) => (ROLE_RANK[role] > ROLE_RANK[highest] ? role : highest),
  ORG_ROLES[0],
);

export function roleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Every role an actor is allowed to hand out. Nobody may grant a role above their own, so
 * an admin cannot mint an owner and a role change is not a privilege escalation. Derived
 * from ROLE_RANK, so a role added to ORG_ROLES is covered the moment it is declared.
 *
 * The gate that consumes this belongs in the gateway block with the other checks, never in
 * a handler - see the `the-block` skill.
 */
export function assignableRoles(actor: OrgRole): readonly OrgRole[] {
  return INVITABLE_ROLES.filter((role) => roleAtLeast(actor, role));
}

/**
 * The roles somebody can actually be given a seat as. A guest is the principal behind a QR
 * session, not a membership row - nobody is invited as one and nobody's role is changed to
 * one - so it is filtered out here, once, rather than remembered at each call site.
 */
export const INVITABLE_ROLES: readonly OrgRole[] = ROLES_ASCENDING.filter(
  (role) => role !== "guest",
);

/**
 * What a staff role degrades to when the identity provider returns something unrecognised.
 * Deliberately not LOWEST_ROLE: LOWEST_ROLE is now `guest`, and degrading a real member to
 * a guest would take away reads their seat pays for. A membership row means staff, so the
 * floor is the lowest role a seat can be issued at.
 */
export const LOWEST_MEMBER_ROLE: OrgRole = INVITABLE_ROLES.reduce(
  (lowest, role) => (ROLE_RANK[role] < ROLE_RANK[lowest] ? role : lowest),
  HIGHEST_ROLE,
);

/* ── Stations: the lateral half of the grant ─────────────────────────────── */

/**
 * The one rank stations apply to, and it is derived rather than named.
 *
 * A station is a post on the floor, and only the people who work one post at a time are
 * assigned to one: LOWEST_MEMBER_ROLE is the lowest role a seat can be issued at, so it is
 * exactly the rank that means "staff, without authority over anybody". Everything above it
 * is supervisory and is never station-gated - a manager who cannot cover the pass during a
 * rush is not a manager - and `guest`, which is below it, is not a seat at all and is
 * refused by rank long before a station is asked about.
 *
 * Written this way rather than as the literal `"member"` so the ladder can move without a
 * role name being typed anywhere outside ORG_ROLES.
 */
export const STATION_GATED_ROLE: OrgRole = LOWEST_MEMBER_ROLE;

/** Whether this role is asked about stations at all. Every other role is exempt. */
export function isStationGated(role: OrgRole): boolean {
  return ROLE_RANK[role] === ROLE_RANK[STATION_GATED_ROLE];
}

/**
 * Everything the platform is allowed to know about the caller before entitlements: their
 * rank, and the posts they are rostered to. The two travel together because neither answers
 * the question on its own, and a call site that took only the role is a call site that
 * forgot the stations - which is why `permissionsForRole` no longer exists.
 */
export type Grant = {
  readonly role: OrgRole;
  readonly stations: readonly Station[];
};

/** A grant that holds nothing beyond its rank. What a guest has, and a member off shift. */
export function grantOf(role: OrgRole, stations: readonly Station[] = []): Grant {
  return { role, stations };
}

/**
 * The stations an operation demands. Empty means it demands none - the ordinary case, and
 * the reason every existing operation behaves exactly as it did before stations existed.
 *
 * Takes an unnarrowed `Operation` because the service half of the block reads the pair back
 * off a parsed envelope, where the compiler no longer knows the operation belongs to the
 * resource. Widened to the declared shape before indexing, the same way `ruleFor` does it.
 */
/**
 * The failure budget for a resource, or null when it declares none.
 *
 * Separate from `rateLimit` because the two are charged on different events: `rateLimit` per
 * call, this per proved-wrong attempt. Only meaningful where a wrong answer is evidence
 * rather than an accident - a resource whose input is a secret being guessed - so absent is
 * both the default and the common case, and absent means refusals cost nothing beyond the
 * ordinary limit.
 */
export function failureLimitFor(
  resource: ResourceKey,
): { readonly max: number; readonly windowSeconds: number } | null {
  /** Widened before reading, for the reason `ruleFor` states: the literals differ in shape. */
  const declared: ResourceDefinition = RESOURCES[resource];
  return declared.failureRateLimit ?? null;
}

export function stationsFor(resource: ResourceKey, operation: Operation): readonly Station[] {
  const declared: Readonly<Partial<Record<Operation, OperationRule>>> =
    RESOURCES[resource].operations;
  return declared[operation]?.stations ?? [];
}

/**
 * The one station question, asked identically by the gateway, the service, the nav and the
 * browser. Narrowing only: a grant that fails `roleAtLeast` is already refused before this
 * is reached, and this can never hand back a permission the rank did not already allow.
 */
export function stationAllows(grant: Grant, required: readonly Station[]): boolean {
  if (required.length === 0) return true;
  if (!isStationGated(grant.role)) return true;
  return grant.stations.some((held) => required.some((needed) => needed === held));
}

/**
 * Every station any of a resource's operations is worked from, in STATIONS order.
 *
 * This is what the nav gates on, rather than the station set of the one readable operation
 * `navAccess` picks. `order.read` is declared at `guest` - a diner watches their own order
 * arrive - so the operation the nav happens to test carries no station at all, and gating on
 * it would leave the Orders console in the sidebar of a line cook who cannot work a single
 * control on the page. The honest question for a whole surface is "is this a post you are
 * on", and that is the union.
 */
export const STATIONS_BY_RESOURCE: Readonly<Record<ResourceKey, readonly Station[]>> = fromKeys(
  RESOURCE_KEYS,
  (resource) =>
    STATIONS.filter((station) =>
      operationsOf(resource).some((operation) =>
        stationsFor(resource, operation).some((required) => required === station),
      ),
    ),
);

/**
 * What a station text column claims, reduced to stations that exist.
 *
 * The mirror of `normalizeRole`, and it degrades for the same reason: an unrecognised name
 * contributes nothing, so a typo, a renamed station or a hand-edited row can only ever take
 * a surface away. The result is in STATIONS order and free of duplicates by construction,
 * which is what lets two of these be compared and signed without sorting at each call site.
 */
export function normalizeStations(value: unknown): readonly Station[] {
  if (typeof value !== "string") return [];
  const claimed = value.split(",").map((entry) => entry.trim());
  return STATIONS.filter((station) => claimed.some((claim) => claim === station));
}

/**
 * The storage form. Reading and writing the column are two layers that must never disagree
 * about the format, so both go through here and `normalizeStations` rather than through a
 * `join` somebody writes twice.
 */
export function formatStations(stations: readonly Station[]): string {
  return normalizeStations(stations.join(",")).join(",");
}

/**
 * Declared stations that could never fire, refused while the module loads rather than left
 * to be discovered as a gate that quietly does nothing.
 *
 * Two mistakes are possible and both are silent. `stations` on an operation above
 * STATION_GATED_ROLE gates a rank that is exempt, so it is decoration. `stations` on one
 * BELOW it is worse than decoration: a guest would sail past a check that refuses a member,
 * which inverts the ladder. An empty list is the third - it reads as a gate and is not one.
 */
const STATION_DECLARATION_ERRORS: readonly string[] = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).flatMap((operation) => {
    const rule = ruleFor(resource, operation);
    const declared = rule.stations;
    const at = `${resource}.${String(operation)}`;
    if (declared === undefined) return [];
    if (declared.length === 0) return [`${at} declares an empty station list, which gates nothing`];
    if (!isStationGated(rule.minRole)) {
      return [`${at} declares stations but its minRole is '${rule.minRole}', which is not gated`];
    }
    return [];
  }),
);
if (STATION_DECLARATION_ERRORS.length > 0) {
  throw new Error(
    `Stations are declared where they cannot apply: ${STATION_DECLARATION_ERRORS.join("; ")}. ` +
      `Stations narrow the '${STATION_GATED_ROLE}' role only - see STATION_GATED_ROLE in ` +
      "packages/registry/src/derive.ts.",
  );
}

/* ── Permissions a grant holds ───────────────────────────────────────────── */

/**
 * Every permission a grant holds: rank first, then station. One function, so the gateway,
 * the service, the nav and the browser cannot each answer half of it.
 */
export function permissionsFor(grant: Grant): readonly Permission[] {
  return RESOURCE_KEYS.flatMap((resource) =>
    operationsOf(resource)
      .filter((operation) => {
        const rule = ruleFor(resource, operation);
        return roleAtLeast(grant.role, rule.minRole) && stationAllows(grant, rule.stations ?? []);
      })
      .map((operation) => toPermission(resource, operation)),
  );
}

/**
 * What a rank can reach with no station withheld - the ceiling, not the grant.
 *
 * Better Auth's role model has one role per membership row and no lateral dimension at all,
 * so its statements can only describe the rank. This is deliberately the widest reading:
 * narrowing it would tell Better Auth that `member` cannot work the pass, which is false for
 * every member who is on the kitchen station. Nothing in the request path authorises from
 * here - the gateway and the service both use `permissionsFor`, which knows the stations -
 * so the two are not rivals: this is the union of what a rank could hold, that is what one
 * caller does hold.
 */
export const PERMISSIONS_BY_ROLE: Readonly<Record<OrgRole, readonly Permission[]>> = fromKeys(
  ORG_ROLES,
  (role) => permissionsFor({ role, stations: STATIONS }),
);

/**
 * Takes the resource and operation rather than a pre-built string, so no call site has to
 * assert that a template literal is a member of the Permission union.
 */
export function can<K extends ResourceKey, O extends OperationOf<K>>(
  held: readonly Permission[],
  resource: K,
  operation: O,
): boolean {
  /**
   * Compared as a string rather than passed to `includes`. With K and O still generic the
   * compiler expands `${K}:${O}` to the full cross product, which contains pairs no resource
   * declared; the comparison asks the same question without asserting that it does not.
   */
  const permission: string = toPermission(resource, operation);
  return held.some((candidate) => candidate === permission);
}

/**
 * An unrecognised role from an identity provider degrades down, never up.
 *
 * `member.role` is an unconstrained `text` column and Better Auth writes multiple roles
 * into it comma-separated ("owner,admin"). Matching the whole column missed that and
 * dropped such a person to the lowest role on their next request, quietly taking billing,
 * audit and team management away from an owner. Every claimed role is read and the highest
 * recognised one wins; unknown names contribute nothing, so this can only ever degrade.
 */
export function normalizeRole(value: unknown): OrgRole {
  if (typeof value !== "string") return LOWEST_MEMBER_ROLE;
  return value.split(",").reduce<OrgRole>((best, claimed) => {
    const trimmed = claimed.trim();
    const known = INVITABLE_ROLES.find((role): boolean => role === trimmed);
    return known !== undefined && ROLE_RANK[known] > ROLE_RANK[best] ? known : best;
  }, LOWEST_MEMBER_ROLE);
}

/* ── Units: how many of a resource one call consumes ─────────────────────── */

/**
 * A count no finite limit can satisfy, which is what an input nobody can count is worth.
 *
 * The alternative was to fall back to one, and that is the shape of the bug this whole change
 * exists to remove: a call whose size could not be read would be gated as if it were small.
 * Refusing instead means the worst a broken or hostile reader can do is deny a request, never
 * admit one. It is MAX_SAFE_INTEGER rather than Infinity so the number stays an integer that
 * can be compared, signed and printed.
 */
export const UNCOUNTABLE_UNITS: number = Number.MAX_SAFE_INTEGER;

/**
 * How many units of the resource ONE call of this operation would consume, read from its
 * already-parsed input. The single answer the gateway gates on, the service re-asserts, the
 * meter bills and a button greys out on.
 *
 * Everything the declared reader may get wrong is corrected here, once, so no reader has to
 * be careful: a count is floored at DEFAULT_UNITS because a call that lands consumes at least
 * one, rounded UP because half a row is a whole row to whoever pays for it, capped so it stays
 * a safe integer, and an unreadable one is refused outright. An operation that declares no
 * reader answers exactly one, which is what every operation in this registry meant before
 * bulk create existed.
 *
 * Takes an unnarrowed `Operation` for the same reason `stationsFor` does: the service reads
 * the pair back off a parsed envelope, where the compiler no longer knows the operation
 * belongs to the resource.
 */
export function unitsOf(resource: ResourceKey, operation: Operation, input: unknown): number {
  const declared: Readonly<Partial<Record<Operation, OperationRule>>> =
    RESOURCES[resource].operations;
  const read = declared[operation]?.units;
  if (read === undefined) return DEFAULT_UNITS;
  const counted = read(input);
  if (!Number.isFinite(counted)) return UNCOUNTABLE_UNITS;
  return Math.min(Math.max(DEFAULT_UNITS, Math.ceil(counted)), UNCOUNTABLE_UNITS);
}

/* ── Entitlements: the client mirror ─────────────────────────────────────── */

export type UsageSnapshot = Readonly<Partial<Record<ResourceKey, number>>>;

export type Entitlements = {
  readonly plan: PlanKey;
  readonly usage: UsageSnapshot;
};

export const EMPTY_ENTITLEMENTS: Entitlements = { plan: DEFAULT_PLAN, usage: {} };

export type AccessDecision =
  | { readonly allowed: true; readonly limit: Limit; readonly remaining: number | "unlimited" }
  | {
      readonly allowed: false;
      readonly reason: "not_in_plan" | "limit_reached";
      readonly limit: Limit;
      readonly used: number;
      /**
       * How many were asked for, and how many were left. A refusal that carries neither can
       * only say "upgrade required", which is the wrong sentence for somebody who asked for
       * two hundred seats and has twenty: they do not need a bigger plan to create one, they
       * need to know the size of what they asked for. Both are computed here so the gateway's
       * message and the browser's preview cannot name different numbers - see `refusalMessage`.
       */
      readonly requested: number;
      readonly remaining: number;
      readonly nextPlan: PlanKey | null;
      readonly upgradeMessage: string;
    };

/** The refused half, named once so a caller can take it as an argument. */
export type AccessDenied = Extract<AccessDecision, { allowed: false }>;

export function limitFor(resource: ResourceKey, plan: PlanKey): Limit {
  return RESOURCES[resource].limits[plan] ?? false;
}

export function isInPlan(resource: ResourceKey, plan: PlanKey): boolean {
  return limitFor(resource, plan) !== false;
}

/**
 * The single gate. The gateway calls it to refuse; the browser calls it to render an
 * upgrade prompt. One implementation is the only reason the two cannot disagree.
 *
 * `requested` is how many units the call would create - `unitsOf` above answers that from the
 * input, and it defaults to one so every caller written before bulk operations existed keeps
 * asking exactly the question it always asked.
 */
export function checkResourceAccess(args: {
  resource: ResourceKey;
  entitlements: Entitlements;
  requested?: number;
}): AccessDecision {
  const { resource, entitlements } = args;
  const requested = args.requested ?? DEFAULT_UNITS;
  const limit = limitFor(resource, entitlements.plan);
  const used = entitlements.usage[resource] ?? 0;
  const nextPlan = nextPlanAfter(entitlements.plan);
  const upgradeMessage = RESOURCES[resource].upgrade(
    nextPlan === null ? null : PLANS[nextPlan].label,
  );

  if (limit === false) {
    /** Nothing is left of a resource the plan does not include, whatever the usage says. */
    const refused = { requested, remaining: 0, limit, used, nextPlan, upgradeMessage };
    return { allowed: false, reason: "not_in_plan", ...refused };
  }
  if (limit === "unlimited") {
    return { allowed: true, limit, remaining: "unlimited" };
  }
  const remaining = Math.max(0, limit - used);
  if (used + requested > limit) {
    const refused = { requested, remaining, limit, used, nextPlan, upgradeMessage };
    return { allowed: false, reason: "limit_reached", ...refused };
  }
  return { allowed: true, limit, remaining };
}

/**
 * What a refusal actually says. The registry's own upgrade copy for a call that asked for one
 * and could not have it, and the numbers for a call that asked for several.
 *
 * The two are different sentences because the plan's copy - "you have used every table on your
 * plan" - is simply false for somebody who has twenty left and asked for two hundred, and a
 * refusal that misdescribes the situation sends the reader to a checkout page that will not fix
 * it. When nothing is left the copy is true again and is used unchanged, which is also what
 * keeps every single-unit refusal in the platform worded exactly as it was.
 *
 * The upsell is not appended: `nextPlan` and `upgradeMessage` travel on the decision, which the
 * gateway attaches to the failure and `UpgradePrompt` renders, so the sales sentence is written
 * in one place and this is not it.
 */
export function refusalMessage(resource: ResourceKey, decision: AccessDenied): string {
  if (decision.reason === "not_in_plan") return decision.upgradeMessage;
  if (decision.requested <= DEFAULT_UNITS || decision.remaining === 0) {
    return decision.upgradeMessage;
  }
  const noun = RESOURCES[resource].label.toLowerCase();
  return `That would add ${decision.requested} ${noun}, and your plan has ${decision.remaining} left.`;
}

export function usageLabel(resource: ResourceKey, entitlements: Entitlements): string {
  const limit = limitFor(resource, entitlements.plan);
  const used = entitlements.usage[resource] ?? 0;
  if (limit === false) return "Not included";
  if (limit === "unlimited") return `${used} used`;
  return `${used} of ${limit}`;
}

/* ── The upgrade surface: catalog, comparison, over-plan state ───────────── */

/**
 * One row per gated resource, for the pricing page's comparison table.
 *
 * A resource whose every plan says "unlimited" is not a selling point - it is table
 * noise - so membership and billing never appear. Computed once from the registry, so
 * adding a capped resource to `RESOURCES` adds its row here with no edit anywhere.
 */
export type FeatureRow = {
  readonly resource: ResourceKey;
  readonly label: string;
  readonly limits: Readonly<Record<PlanKey, Limit>>;
};

const FEATURE_ROWS: readonly FeatureRow[] = RESOURCE_KEYS.flatMap((resource) => {
  const limits = fromKeys(PLAN_KEYS, (plan) => limitFor(resource, plan));
  const gated = PLAN_KEYS.some((plan) => limits[plan] !== "unlimited");
  return gated ? [{ resource, label: RESOURCES[resource].label, limits }] : [];
});

export function featureRows(): readonly FeatureRow[] {
  return FEATURE_ROWS;
}

/**
 * The resources worth putting on a usage screen for this plan, in the order the nav puts
 * them.
 *
 * The billing page listed every resource in the registry - forty rows, most of them
 * "0 used" against an unlimited allowance - which buries the two or three a customer is
 * actually near the ceiling of. A row earns its place if this plan caps it, or if the
 * organisation has used it at all: a capped resource is a number that can run out, and a
 * used one is a number somebody chose to look at. Everything else is table noise, and the
 * plan comparison below already says what the plan includes.
 */
export function usageRows(entitlements: Entitlements): readonly FeatureRow[] {
  return FEATURE_ROWS.filter((row) => {
    const limit = row.limits[entitlements.plan];
    return typeof limit === "number" || (entitlements.usage[row.resource] ?? 0) > 0;
  });
}

/** What a limit looks like on the wire and in a table cell. One formatter, no rivals. */
export function formatLimit(limit: Limit): string {
  if (limit === false) return "—";
  if (limit === "unlimited") return "Unlimited";
  return String(limit);
}

/**
 * Resources an organisation is running past its plan's cap.
 *
 * This can happen however it likes - usage recorded before a downgrade, a change made
 * directly in the billing provider - and the product's job is to say so on every page
 * until it is resolved, not to pretend the plan still fits. Empty means the tenant fits.
 */
export function planOverages(entitlements: Entitlements): readonly FeatureRow[] {
  return FEATURE_ROWS.filter((row) => {
    const limit = row.limits[entitlements.plan];
    return typeof limit === "number" && (entitlements.usage[row.resource] ?? 0) > limit;
  });
}

/**
 * What must come down before a switch to `target` may be allowed.
 *
 * Two ways a tenant does not fit: usage above the target's cap, or any usage at all of a
 * resource the target does not include. Both are disclosed as named resources, so the
 * refusal can say exactly what has to go rather than "not allowed".
 */
export function downgradeBlockers(
  entitlements: Entitlements,
  target: PlanKey,
): readonly FeatureRow[] {
  return FEATURE_ROWS.filter((row) => {
    const limit = row.limits[target];
    const used = entitlements.usage[row.resource] ?? 0;
    if (limit === false) return used > 0;
    return typeof limit === "number" && used > limit;
  });
}

/**
 * Dollars a year the yearly term saves against twelve monthly terms, or null when the
 * plan has no yearly price. Computed here so a component can never quote a number the
 * registry's two prices do not produce.
 */
export function yearlySavings(plan: PlanKey): number | null {
  const definition = PLANS[plan];
  if (definition.priceYearlyUsd === null) return null;
  return definition.priceMonthlyUsd * 12 - definition.priceYearlyUsd;
}

/**
 * The plan a trial would convert to, and how long it lasts. The next plan up is what a
 * customer is being sold; a trial that converts to something they did not see during it
 * is the dishonesty this exists to avoid. Null when there is nothing to trial - the top
 * plan, or a plan that declares no trial length.
 */
export function trialOffer(
  current: PlanKey,
): { readonly plan: PlanKey; readonly days: number } | null {
  const next = nextPlanAfter(current);
  if (next === null) return null;
  const days = PLANS[next].trialDays;
  return days === null ? null : { plan: next, days };
}

/* ── Subjects and streams ────────────────────────────────────────────────── */

export function rpcSubject<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
): `rpc.${K}.${O}` {
  return `rpc.${resource}.${operation}`;
}

export function commandSubject<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
): `cmd.${K}.${O}` {
  return `cmd.${resource}.${operation}`;
}

export function eventSubject<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
): `evt.${K}.${O}` {
  return `evt.${resource}.${operation}`;
}

/**
 * The change-notice subject for one row: `notice.<resource>.<id>`.
 *
 * Deliberately NOT a `evt.` subject. An event is a durable fact a consumer must not miss -
 * audit and metering are built on them, and JetStream redelivers until they are acked. A
 * notice is the opposite: core NATS, fire and forget, and a dropped one costs nothing because
 * the watcher re-reads the row anyway. Putting them on the same stream would make every
 * keystroke at a table a durable business fact.
 */
export function noticeSubject(resource: ResourceKey, id: string): `notice.${string}.${string}` {
  return `notice.${resource}.${id}`;
}

/** Every notice subject a resource can produce, for the bus ACLs. */
export function noticePattern(resource: ResourceKey): `notice.${string}.>` {
  return `notice.${resource}.>`;
}

/** The resources that broadcast change notices, derived from the registry's own flag. */
export const NOTIFIED_RESOURCES: readonly ResourceKey[] = keysOf(RESOURCES).filter((resource) => {
  const declared: ResourceDefinition = RESOURCES[resource];
  return declared.notify === true;
});

/**
 * The services that read the event stream, derived from the registry's own flag.
 *
 * Three do - the trail, the meter and the projector - and each needs JetStream consumer
 * permissions on EVT. The auth generator used to name two of them by hand and the third
 * crashed at every boot, so this is computed like everything else.
 */
export const EVENT_CONSUMER_SERVICES: readonly ServiceName[] = [
  ...new Set(
    keysOf(RESOURCES).flatMap((resource) => {
      const declared: ResourceDefinition = RESOURCES[resource];
      return declared.consumesEvents === true ? [declared.owner] : [];
    }),
  ),
];

/**
 * Every downstream call the registry permits: who may ask, and for which subject.
 *
 * A `serviceCall` is an ordinary publish, so without this the bus refuses it and the caller
 * sees `Nothing answered` - a 503 that blames the callee for the caller's missing permission.
 * The list is derived from `internalCallers` on the operation, so adding a downstream call
 * means declaring it, and a call nobody declared cannot be made.
 */
export type InternalCall = {
  readonly caller: ServiceName;
  readonly resource: ResourceKey;
  readonly operation: Operation;
  readonly subject: string;
};

export const INTERNAL_CALLS: readonly InternalCall[] = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).flatMap((operation) => {
    const rule = ruleFor(resource, operation);
    const callers = rule.internalCallers ?? [];
    return callers.map((caller) => ({
      caller,
      resource,
      operation,
      subject:
        rule.transport === "rpc"
          ? rpcSubject(resource, operation)
          : commandSubject(resource, operation),
    }));
  }),
);

/** The subjects one service is allowed to publish as a downstream call. */
export function internalCallSubjects(service: ServiceName): readonly string[] {
  return INTERNAL_CALLS.filter((call) => call.caller === service).map((call) => call.subject);
}

/** One queue group per service, so replicas share work instead of duplicating it. */
export function queueGroup(service: ServiceName): `qg.${ServiceName}` {
  return `qg.${service}`;
}

export type StreamConfig = {
  readonly name: string;
  readonly subjects: readonly string[];
  readonly description: string;
  readonly maxAgeDays: number;
};

export const STREAMS: readonly StreamConfig[] = [
  {
    name: "CMD",
    subjects: ["cmd.>"],
    description: "Durable commands the gateway accepted but has not executed yet.",
    maxAgeDays: 7,
  },
  {
    name: "EVT",
    subjects: ["evt.>"],
    description: "Facts emitted by services after a successful mutation.",
    maxAgeDays: 30,
  },
];

export type SubjectRoute = {
  readonly resource: ResourceKey;
  readonly operation: Operation;
  readonly subject: string;
  readonly transport: OperationRule["transport"];
  readonly owner: ServiceName;
  readonly audit: boolean;
  /**
   * The evt subject this operation emits on, or null when it is not audited. Computed here,
   * where the resource and operation are still narrowed to the pair that declared them, so
   * no consumer has to re-prove that relationship before it can name the subject.
   */
  readonly event: string | null;
  /**
   * The notice subject PATTERN this operation may publish on, or null when the resource
   * declares no `notify` or the operation changes nothing. A pattern rather than a subject
   * because the row's id is only known at run time; the service fills it in with
   * `noticeSubject`, and the bus ACL grants exactly this pattern.
   */
  readonly notify: string | null;
};

/** Every subject the platform may legally use. Printed by `pnpm subjects`. */
export const ROUTES: readonly SubjectRoute[] = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).map((operation) => {
    const rule = ruleFor(resource, operation);
    return {
      resource,
      operation,
      transport: rule.transport,
      owner: RESOURCES[resource].owner,
      audit: rule.audit,
      event: rule.audit ? eventSubject(resource, operation) : null,
      /** A query moves nothing, so it has nothing to announce. */
      notify:
        NOTIFIED_RESOURCES.includes(resource) && rule.kind === "mutation"
          ? noticePattern(resource)
          : null,
      subject:
        rule.transport === "rpc"
          ? rpcSubject(resource, operation)
          : commandSubject(resource, operation),
    };
  }),
);

/**
 * The longest budget any declared operation asks for. A verifier uses it to refuse an
 * envelope whose deadline is wider than anything the registry could have issued, which is
 * what stops a captured envelope being replayed with a hand-written century-long deadline.
 */
export const MAX_TIMEOUT_MS: number = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).map((operation) => ruleFor(resource, operation).timeoutMs),
).reduce((longest, timeoutMs) => Math.max(longest, timeoutMs), 0);

export function allSubjects(): readonly string[] {
  return ROUTES.flatMap((route) =>
    route.event === null ? [route.subject] : [route.subject, route.event],
  );
}

/* ── Navigation and the route guard ──────────────────────────────────────── */

export type NavItem = NavEntry & { readonly resource: ResourceKey };

export const NAV_ITEMS: readonly NavItem[] = RESOURCE_KEYS.flatMap((resource) => {
  const nav = RESOURCES[resource].nav;
  return nav === null ? [] : [{ ...nav, resource }];
}).sort((a, b) => a.order - b.order);

/**
 * Where the registry put billing. Derived once, because three client components were each
 * running this same `find` by hand - and a route written by hand three times is a route
 * that will be wrong in two of them the day it moves.
 */
export const BILLING_HREF: string | undefined = NAV_ITEMS.find(
  (item) => item.resource === "billing",
)?.href;

/** Longest-prefix match, so /projects/abc still resolves to the project resource. */
export function resourceForPath(pathname: string): ResourceKey | null {
  let match: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (match === null || item.href.length > match.href.length) match = item;
    }
  }
  return match === null ? null : match.resource;
}

/**
 * Every nav group, in the order its first item appears. The management sidebar is sectioned,
 * and a hand-written section list beside a derived nav is the second source of truth this
 * package exists to prevent. Ungrouped items are not represented here; they render loose.
 */
export const NAV_GROUPS: readonly string[] = NAV_ITEMS.reduce<string[]>((groups, item) => {
  const group = item.group;
  if (group !== undefined && !groups.includes(group)) groups.push(group);
  return groups;
}, []);

export type NavAccess = { readonly visible: boolean; readonly locked: boolean };

/**
 * `visible` answers permission, `locked` answers plan. A resource the grant may not read is
 * hidden; one the plan does not include is shown but locked, because a locked item is an
 * upgrade prompt and a hidden one is just confusing.
 *
 * Station is part of the permission half, not a third state: a post somebody is not on is
 * not a page to sell them, it is a page that is not theirs. It is asked over the resource's
 * whole station set - see STATIONS_BY_RESOURCE - so a surface disappears with the controls
 * on it rather than after them.
 */
export function navAccess(
  resource: ResourceKey,
  grant: Grant,
  entitlements: Entitlements,
): NavAccess {
  const readable = operationsOf(resource).find(
    (operation) => operation === "read" || operation === "manage",
  );
  if (readable === undefined) return { visible: false, locked: false };
  return {
    visible:
      roleAtLeast(grant.role, ruleFor(resource, readable).minRole) &&
      stationAllows(grant, STATIONS_BY_RESOURCE[resource]),
    locked: !isInPlan(resource, entitlements.plan),
  };
}

export function visibleNav(grant: Grant, entitlements: Entitlements): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => navAccess(item.resource, grant, entitlements).visible);
}

export type NavEntryAccess = NavItem & NavAccess;

/**
 * Every nav item the role may see, each still carrying whether the plan includes it.
 *
 * `visibleNav` computes `locked` and then throws it away, so the sidebar rendered a locked
 * item identically to an unlocked one: a free-plan admin saw "Audit log", clicked it, and
 * was redirected to billing with no explanation. The distinction the type already draws was
 * being discarded one line after it was made.
 */
export function navFor(grant: Grant, entitlements: Entitlements): readonly NavEntryAccess[] {
  return NAV_ITEMS.map((item) => ({
    ...item,
    ...navAccess(item.resource, grant, entitlements),
  })).filter((item) => item.visible);
}
