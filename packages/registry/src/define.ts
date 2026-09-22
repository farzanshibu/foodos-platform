/**
 * SOT: define, registry-pattern, defineResource, fromKeys, registry-primitives, stations,
 *      org-roles, units, unit-reader, default-units
 * WHAT   The pattern every registry entry follows, and the one type assertion in the package.
 * WHY    Seven files with three different shapes was three patterns to learn. Everything is
 *        now declared with `defineResource` / `definePlan` and derived by one pipeline.
 * HOW    `const` type parameters preserve literal types without `as const`, so a resource
 *        is written as plain data and still produces exact unions.
 * WHERE  registry.ts (declaration), derive.ts (everything computed from it)
 * NOTE   Client-safe. No server-only import may ever be added to this package.
 */

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

export const OPERATIONS = ["create", "read", "update", "delete", "manage"] as const;
export type Operation = (typeof OPERATIONS)[number];

/**
 * `guest` is the principal behind a QR session: somebody sitting at a table who has no
 * account and no membership row. It exists here rather than as a parallel "public" concept
 * so the derived permission set, the role gate and the nav all cover it automatically -
 * a guest may call exactly the operations declared `minRole: "guest"` and nothing else.
 * It is deliberately not invitable; see INVITABLE_ROLES in derive.ts.
 */
export const ORG_ROLES = ["guest", "member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * The second, LATERAL dimension: which of the restaurant's posts a seat works.
 *
 * ORG_ROLES is a rank ladder and answers "how much authority". It cannot answer "which
 * screen", because a cashier is not more or less than a line cook - they are beside each
 * other. Adding `waiter`, `kitchen` and `cashier` to ORG_ROLES would force an ordering that
 * does not exist, and every ordering invented for them silently grants one post the other's
 * surfaces: `roleAtLeast(cashier, waiter)` is a question with no true answer.
 *
 * So stations are a separate axis, unordered by construction - there is no STATION_RANK and
 * there must never be one. A membership holds a SET of them, which is what lets one person
 * cover two posts in a small restaurant without inventing a combined role.
 *
 * The three are the posts the registry's own operations already divide into: the kitchen
 * display (`kitchenTicket`), the floor - tables and the guests on them (`place`,
 * `serviceRequest`) - and the order console, which is worked from both the floor and the
 * counter (`order`). They are not a guess at what a restaurant might want; each one is the
 * set of surfaces some declared operation belongs to.
 *
 * @see derive.ts - STATION_GATED_ROLE, stationAllows, permissionsFor
 */
export const STATIONS = ["kitchen", "service", "till"] as const;
export type Station = (typeof STATIONS)[number];

/** The deployable units. A resource names the one service allowed to answer for it. */
export const SERVICES = [
  "projects",
  "identity",
  "billing",
  "audit",
  "catalog",
  "floor",
  "qr",
  "orders",
  "requests",
  "crm",
  "insights",
] as const;
export type ServiceName = (typeof SERVICES)[number];

/** `false` means the resource is not in that plan at all. */
export type Limit = number | "unlimited" | false;

/* ── Units: how much of a resource one call consumes ─────────────────────── */

/**
 * What one call consumes when its operation declares no `units` reader: exactly one.
 *
 * The platform's oldest unwritten assumption, finally written down. Every gate, every meter
 * and every limit in this repo was built on "one call creates one row", and bulk operations
 * are the first thing to break it - so the assumption becomes a named default rather than a
 * `1` typed into the gateway, the service and the billing consumer separately.
 */
export const DEFAULT_UNITS = 1;

/**
 * How many units of the resource one call of an operation would create, read from its
 * ALREADY-PARSED input.
 *
 * `unknown` is honest here and is not a fourth hand-narrowing site: the shape belongs to
 * `@foodos/contracts`, which is keyed on this package and therefore cannot be imported
 * back into it, so the registry has no type for the thing it is counting. What makes that
 * safe is that the value has already crossed the contract's own parse - the gateway counts
 * after `contract.input.parse`, the service after `verifyRequest` over the same bytes - and
 * that the two readers below are total: they narrow before they touch anything, and they
 * answer 0 rather than throwing for a shape that is not what the operation declared.
 *
 * A reader may over-count and may never under-count. `unitsOf` in derive.ts floors the
 * answer at DEFAULT_UNITS and refuses one it cannot count, so no reader has to remember to.
 */
export type UnitsReader = (input: unknown) => number;

/** One field of an already-parsed input, or undefined. Total: never throws, never widens. */
function fieldOf(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  /** Read through a Map rather than an index, which `noPropertyAccessFromIndexSignature`
   *  refuses and a `__proto__` key would otherwise answer. */
  const fields: ReadonlyMap<string, unknown> = new Map(Object.entries(input));
  return fields.get(key);
}

/** A finite number field, or 0 when it is absent, not a number, or NaN/Infinity. */
export function numberField(input: unknown, key: string): number {
  const value = fieldOf(input, key);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * How many DISTINCT entries an array field holds, or 0 when it is not an array.
 *
 * Distinct rather than `length` because the things a bulk operation is counted by are the
 * things it may not create twice - a row list that repeats a letter asks for the same seat
 * again, and the service deduplicates it before it writes. Counting the raw length would
 * refuse a call the service was going to satisfy. Set semantics compare two objects by
 * reference, so a list of objects can only ever be counted as MORE distinct entries than it
 * holds, which is the safe direction.
 */
export function distinctField(input: unknown, key: string): number {
  const value = fieldOf(input, key);
  if (!Array.isArray(value)) return 0;
  /** Annotated to erase the `any[]` `Array.isArray` narrows an `unknown` to. */
  const entries: readonly unknown[] = value;
  return new Set(entries).size;
}

/* ── The single assertion ────────────────────────────────────────────────── */

/**
 * Builds an exhaustive `Record<K, V>` by visiting every key exactly once.
 *
 * This is the ONLY type assertion in the registry, and it is provably total: the loop
 * iterates the same key list the return type is keyed on. Every other derived value in
 * the package is built with this, so there is one place to audit rather than a cast at
 * each call site.
 */
export function fromKeys<K extends string, V>(
  keys: readonly K[],
  map: (key: K) => V,
): Record<K, V> {
  const out: Partial<Record<K, V>> = {};
  for (const key of keys) out[key] = map(key);
  return out as Record<K, V>;
}

/** Object.keys with the key type kept. Safe because the object literal is closed. */
export function keysOf<T extends object>(value: T): ReadonlyArray<Extract<keyof T, string>> {
  return Object.keys(value) as Array<Extract<keyof T, string>>;
}

/* ── Plans ───────────────────────────────────────────────────────────────── */

export type PlanDefinition = {
  readonly label: string;
  readonly tagline: string;
  /** Autumn product id. Autumn is downstream of the registry, never the other way round. */
  readonly autumnProductId: string;
  /** Higher rank means more entitlements. Drives upgrade prompts and plan comparison. */
  readonly rank: number;
  readonly priceMonthlyUsd: number;
  /**
   * The yearly price, or null when the plan has no yearly term - so no savings line may
   * be computed for it anywhere.
   */
  readonly priceYearlyUsd: number | null;
  /**
   * Days a customer may trial this plan, or null when it cannot be trialled. Eligibility
   * is a billing fact (has this org ever held a paid product?); the length of the trial
   * is a declaration, so it lives here and nowhere else.
   */
  readonly trialDays: number | null;
};

export function definePlan<const T extends PlanDefinition>(plan: T): T {
  return plan;
}

/* ── Resources ───────────────────────────────────────────────────────────── */

export type OperationRule = {
  /** Minimum org role. Enforced at the gateway, asserted again at the service. */
  readonly minRole: OrgRole;
  /**
   * The stations allowed to work this operation. Absent - the normal case - means the
   * operation belongs to no particular post and any seat that clears `minRole` may call it.
   *
   * Present, it narrows and only ever narrows: the seat still has to clear `minRole` first,
   * and then it has to hold one of these. Only the lowest seat role is asked - see
   * STATION_GATED_ROLE in derive.ts - because a manager who could not cover a post is not a
   * manager. Declaring stations on an operation whose `minRole` is anything else is refused
   * at import time rather than left as a gate that never fires.
   */
  readonly stations?: readonly Station[];
  /** query -> tRPC .query and a NATS request. mutation -> .mutation. */
  readonly kind: "query" | "mutation";
  /** rpc: caller waits. command: durable JetStream, executed at least once later. */
  readonly transport: "rpc" | "command";
  /** Counts against the plan limit. The gateway refuses before the bus is touched. */
  readonly consumes: boolean;
  /**
   * How many units ONE call of this operation consumes, read from its input. Absent - the
   * normal case - means one, which is what every operation written before bulk create meant
   * and what `unitsOf` answers for them without any of them being touched.
   *
   * It lives here rather than in the gateway because both halves of the block and the browser
   * have to agree about the number: the gateway gates on it, the service re-asserts it, the
   * meter bills it and a button greys out on it. A count derived by hand at any one of those
   * four is a fourth answer to one question - see the `globalization` skill.
   *
   * Declaring it on an operation the registry does not mark `consumes` is allowed and inert:
   * the count still travels in the envelope so the service can re-assert it, and no plan gate
   * asks about it. Refusing that would be a rule with nothing behind it.
   */
  readonly units?: UnitsReader;
  /**
   * The services, other than this resource's owner, allowed to call this operation over the
   * bus with `serviceCall`.
   *
   * A downstream call is an ordinary NATS publish, so the caller needs publish permission on
   * `rpc.<resource>.<operation>` in `infra/nats/auth.conf` - and a service's ACL is otherwise
   * only its own subjects. Every existing `serviceCall` was therefore refused by the bus and
   * surfaced as `Nothing answered for <resource>.<operation>`: a 503 that reads like the
   * other service is down when it is in fact the caller that was never allowed to ask. The
   * envelope still carries the caller's own role and org, so this widens who may ask, never
   * what the answer contains.
   *
   * Per operation rather than per resource, so a service that needs to read a place does not
   * also get the right to delete one.
   */
  readonly internalCallers?: readonly ServiceName[];
  /** Emit evt.<resource>.<operation> on success. Audit and metering consume it. */
  readonly audit: boolean;
  /** How long the gateway waits before giving up on the service. */
  readonly timeoutMs: number;
};

export function op<const T extends OperationRule>(rule: T): T {
  return rule;
}

/**
 * `group` exists because the management app's sidebar is sectioned (Operations, Catalog,
 * Customers, ...) and a hand-maintained section list beside a derived nav is exactly the
 * second source of truth this package exists to prevent. Absent means ungrouped.
 */
export type NavEntry = {
  readonly href: string;
  readonly label: string;
  readonly order: number;
  readonly group?: string;
};

export type ResourceDefinition = {
  readonly label: string;
  readonly description: string;
  readonly owner: ServiceName;
  /** Autumn feature id, or null when the resource is not metered. */
  readonly featureId: string | null;
  /** Declared operations. A key absent here cannot be called from anywhere. */
  readonly operations: Readonly<Partial<Record<Operation, OperationRule>>>;
  readonly limits: Readonly<Record<string, Limit>>;
  readonly rateLimit: { readonly max: number; readonly windowSeconds: number };
  /**
   * A second budget, charged per FAILED attempt rather than per call.
   *
   * `rateLimit` above is charged per call and cannot express this: a resource whose input is
   * a secret being guessed needs a generous allowance for the legitimate repeats (a table of
   * six all scanning the same code, a diner reloading) and a far tighter one for attempts
   * that are proved wrong. One number cannot be both - set it low enough to stop a search
   * and it refuses a full table; set it high enough for the table and it does not stop a
   * search.
   *
   * Only meaningful where a wrong answer is evidence rather than an accident, so it is
   * optional and absent almost everywhere. Absent means no failure budget: refusals cost the
   * caller nothing beyond the ordinary per-call limit.
   */
  readonly failureRateLimit?: { readonly max: number; readonly windowSeconds: number };
  /**
   * Whether a mutation of this resource broadcasts a change notice on `notice.<resource>.<id>`.
   *
   * A notice is a nudge, never data: it says "this row changed" to whoever is already
   * authorised to look at it, so a watcher can re-read through the ordinary block instead of
   * polling on a timer. That is why the payload carries no tenant anything - the subject
   * carries an id the subscriber had to be told, and the re-read is gated like every other.
   *
   * Declared here rather than switched on everywhere because it costs a bus publish per
   * mutation and a subscribe permission in `infra/nats/auth.conf`, both of which are derived
   * from this flag. Absent means no notice, which is right for everything nobody watches.
   */
  readonly notify?: boolean;
  /**
   * Whether this resource's owner reads the event stream rather than only writing to it.
   *
   * Three services do: the audit trail, the Autumn meter, and the analytics projector. Each
   * one needs JetStream consumer permissions on EVT in `infra/nats/auth.conf`, and a service
   * that does not get them dies at boot with `Permissions Violation for Publish to
   * "$JS.API.CONSUMER.INFO.EVT.<durable>"`. That list used to be written out by hand in the
   * auth generator, naming two of the three - so the third crashed on every start, and the
   * generator reported the file was in sync while it was not. Declared here so a fourth
   * consumer is a flag rather than a discovery.
   */
  readonly consumesEvents?: boolean;
  readonly nav: NavEntry | null;
  readonly upgrade: (nextPlanLabel: string | null) => string;
};

export function defineResource<const T extends ResourceDefinition>(resource: T): T {
  return resource;
}
