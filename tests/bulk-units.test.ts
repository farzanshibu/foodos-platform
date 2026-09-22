/**
 * SOT: bulk-units-assertions, unit-count-assertions, plan-limit-bypass-regression
 * WHAT   Plain assertions for the unit count: what the registry reads from an input, what the
 *        gateway gates on, what the envelope carries, and what the meter bills. Run with
 *        `pnpm tsx --conditions=react-server tests/bulk-units.test.ts` - no runner, no config.
 * WHY    One call used to mean one unit everywhere, and `place.create` broke that in both
 *        directions at once: the plan gate asked about one and let a body through that made
 *        four hundred, and the meter billed one for all four hundred. Both halves are
 *        arithmetic nobody can see failing, so they need assertions rather than a comment.
 * WHY    Most of what is below is REGRESSION, deliberately. `unitsOf` now sits in front of
 *        every consuming operation in the platform, so the claim that matters is not "a grid
 *        of 200 counts 200" - it is that every operation that declared nothing still counts
 *        exactly one, refuses with exactly the sentence it refused with before, and meters
 *        exactly what it metered before.
 * WHERE  packages/registry/src/derive.ts, packages/core/src/gateway.ts,
 *        packages/core/src/service.ts, packages/contracts/src/envelope.ts
 */
import assert from "node:assert/strict";
import { ServiceError } from "../packages/contracts/src/errors";
import {
  contractFor,
  eventPayload,
  type RequestMeta,
  signEvent,
  signRequest,
  verifyRequest,
} from "../packages/contracts/src/index";
import {
  defineConsumer,
  defineService,
  dispatch,
  type GatewayDeps,
  GatewayError,
  handlerFor,
} from "../packages/core/src/index";
import {
  checkResourceAccess,
  DEFAULT_UNITS,
  eventSubject,
  operationsOf,
  RESOURCE_KEYS,
  RESOURCES,
  refusalMessage,
  rpcSubject,
  ruleFor,
  UNCOUNTABLE_UNITS,
  unitsOf,
} from "../packages/registry/src/index";

const SECRET = "test-envelope-secret-not-a-real-one-000";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/** A grid the contract accepts, parsed exactly as the gateway parses it at step 5b. */
function grid(rows: readonly string[], columns: number): unknown {
  return contractFor("place", "create").input.parse({
    mode: "grid",
    branchId: "b_1",
    rows: [...rows],
    columns,
  });
}

function rowsUpTo(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

/** One place, the arm that has neither `rows` nor `columns`. */
const ONE_PLACE: unknown = contractFor("place", "create").input.parse({
  mode: "one",
  branchId: "b_1",
  label: "T12",
});

/** Every operation that declares a units reader, named so its blast radius is visible. */
const READERS: readonly string[] = RESOURCE_KEYS.flatMap((resource) =>
  operationsOf(resource).flatMap((operation) =>
    ruleFor(resource, operation).units === undefined ? [] : [`${resource}.${String(operation)}`],
  ),
);

/** Inputs a reader must survive: none of them may make a count negative, zero or unsafe. */
const HOSTILE: readonly unknown[] = [
  undefined,
  null,
  0,
  "grid",
  [],
  {},
  { mode: "grid" },
  { mode: "grid", rows: "ABCDEFGHIJ", columns: 20 },
  { mode: "grid", rows: ["A"], columns: -400 },
  { mode: "grid", rows: ["A", "B"], columns: 0 },
  { mode: "grid", rows: ["A"], columns: 1.5 },
  { mode: "grid", rows: rowsUpTo(26), columns: Number.NaN },
  { mode: "grid", rows: rowsUpTo(26), columns: Number.POSITIVE_INFINITY },
  { mode: "grid", rows: rowsUpTo(26), columns: Number.MAX_VALUE },
  { mode: "grid", rows: rowsUpTo(26), columns: "20" },
  JSON.parse('{"mode":"grid","__proto__":{"rows":["A"],"columns":400}}'),
];

/** Reads a field off an untyped failure payload without asserting its shape. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return new Map(Object.entries(value)).get(key);
}

/* ── The gateway, with the bus never reached ─────────────────────────────── */

/**
 * Deps that record the order they were asked in. Every check below that uses them refuses
 * before step 8, so nothing here ever touches NATS.
 */
function gatewayDeps(args: {
  calls: string[];
  usage: number;
  plan: "starter" | "growth" | "pro";
}): GatewayDeps {
  return {
    identify: () => {
      args.calls.push("identify");
      return Promise.resolve({ userId: "u_1", orgId: "org_1", role: "admin", stations: [] });
    },
    entitlements: () => {
      args.calls.push("entitlements");
      return Promise.resolve({ plan: args.plan, usage: { place: args.usage } });
    },
    rateLimit: () => {
      args.calls.push("rateLimit");
      return Promise.resolve({ ok: true, retryAfterSeconds: 0 });
    },
    secret: SECRET,
  };
}

async function refuse(args: { calls: string[]; usage: number; input: unknown }): Promise<unknown> {
  try {
    await dispatch({
      deps: gatewayDeps({ calls: args.calls, usage: args.usage, plan: "starter" }),
      headers: new Headers(),
      requestId: "req_00000001",
      ip: "127.0.0.1",
      resource: "place",
      operation: "create",
      input: args.input,
    });
  } catch (error) {
    return error;
  }
  throw new Error("dispatch did not refuse.");
}

/* ── The service half, with no database and no bus ───────────────────────── */

/**
 * A handler that refuses to be a handler. Every floor route needs one - `defineService`
 * proves at boot that the list covers exactly what the registry assigns to the service - and
 * a marker refusal is how a check below can tell "the block let this through" from "the block
 * refused it", without a database, a NATS connection or a single row.
 */
function marker<K extends "place" | "section" | "parameterDefinition">(
  resource: K,
  operation: Parameters<typeof ruleFor<K>>[1],
) {
  return handlerFor(
    resource,
    operation,
    (): Promise<never> => Promise.reject(new ServiceError("CONFLICT", "reached the handler")),
  );
}

const floorRuntime = defineService(
  "floor",
  [
    marker("place", "read"),
    marker("place", "create"),
    marker("place", "update"),
    marker("place", "delete"),
    marker("place", "manage"),
    marker("section", "read"),
    marker("section", "create"),
    marker("section", "update"),
    marker("section", "delete"),
    marker("parameterDefinition", "read"),
    marker("parameterDefinition", "create"),
    marker("parameterDefinition", "update"),
    marker("parameterDefinition", "delete"),
  ],
  { secret: SECRET },
);

function metaFor(units: number | undefined): RequestMeta {
  const issuedAt = Date.now();
  return {
    requestId: "req_00000002",
    orgId: "org_1",
    userId: "u_1",
    role: "admin",
    stations: [],
    permissions: ["place:create"],
    plan: "starter",
    resource: "place",
    operation: "create",
    issuedAt,
    deadlineAt: issuedAt + 5000,
    ...(units === undefined ? {} : { units }),
  };
}

function serviceReply(units: number | undefined, payload: unknown) {
  const meta = metaFor(units);
  return floorRuntime.handle(
    { meta, payload, signature: signRequest(meta, payload, SECRET) },
    rpcSubject("place", "create"),
  );
}

/* ── The meter, keyed the way Autumn's idempotency key keys it ───────────── */

type Metered = { readonly resource: string; readonly value: number };

function meterOver(recorded: Map<string, Metered>) {
  return defineConsumer({ secret: SECRET }, ({ meta, payload }) => {
    /**
     * `requestId` is what services/billing passes as Autumn's `idempotency_key`, so a second
     * delivery of the same request is dropped by the provider. Modelled with a Map keyed on
     * exactly that value: the consumer itself is deliberately not idempotent.
     */
    if (!recorded.has(meta.requestId)) {
      recorded.set(meta.requestId, { resource: meta.resource, value: payload.units });
    }
    return Promise.resolve();
  });
}

function eventEnvelope(requestId: string, body: unknown): unknown {
  const meta: RequestMeta = { ...metaFor(400), requestId };
  return { meta, payload: body, signature: signEvent(meta, body, SECRET) };
}

/* ── The checks ──────────────────────────────────────────────────────────── */

type Check = { name: string; run: () => void | Promise<void> };

const checks: Check[] = [
  /* ── The count itself ──────────────────────────────────────────────────── */
  {
    name: "REGRESSION: every operation that declares no reader counts exactly one, whatever arrives",
    run: () => {
      for (const resource of RESOURCE_KEYS) {
        for (const operation of operationsOf(resource)) {
          if (ruleFor(resource, operation).units !== undefined) continue;
          const at = `${resource}.${String(operation)}`;
          for (const input of [...HOSTILE, ONE_PLACE, grid(rowsUpTo(10), 20)]) {
            assert.equal(unitsOf(resource, operation, input), DEFAULT_UNITS, at);
          }
        }
      }
    },
  },
  {
    name: "REGRESSION: exactly one operation in the whole registry reads a count today",
    run: () => {
      // The blast radius, written down. A reader added anywhere else fails this check, which
      // is the moment to ask whether its resource's meter and gate agree with it.
      assert.deepEqual([...READERS], ["place.create"]);
    },
  },
  {
    name: "REGRESSION: every consuming resource still gates on one for a one-row create",
    run: () => {
      for (const resource of RESOURCE_KEYS) {
        for (const operation of operationsOf(resource)) {
          if (!ruleFor(resource, operation).consumes) continue;
          assert.ok(
            unitsOf(resource, operation, ONE_PLACE) >= DEFAULT_UNITS,
            `${resource}.${String(operation)} counted below one`,
          );
        }
      }
      // place.create is the only consuming operation whose count can exceed one, and only in
      // its grid arm - the single-place arm counts what it always counted.
      assert.equal(unitsOf("place", "create", ONE_PLACE), DEFAULT_UNITS);
    },
  },
  {
    name: "a grid of N counts N, at both ends of what one call may lay out",
    run: () => {
      assert.equal(unitsOf("place", "create", grid(rowsUpTo(10), 20)), 200);
      assert.equal(unitsOf("place", "create", grid(rowsUpTo(1), 1)), 1);
      assert.equal(unitsOf("place", "create", grid(rowsUpTo(40), 10)), 400);
      assert.equal(unitsOf("place", "create", grid(rowsUpTo(20), 3)), 60);
    },
  },
  {
    name: "a repeated row is counted once, because the service writes it once",
    run: () => {
      assert.equal(unitsOf("place", "create", grid(["A", "A", "B"], 10)), 20);
      assert.equal(unitsOf("place", "create", grid(["A", "A", "A"], 4)), 4);
    },
  },
  {
    name: "no input can make the count negative, zero, fractional or unsafe",
    run: () => {
      for (const input of HOSTILE) {
        const counted = unitsOf("place", "create", input);
        assert.ok(Number.isSafeInteger(counted), `${JSON.stringify(input)} -> ${counted}`);
        assert.ok(counted >= DEFAULT_UNITS, `${JSON.stringify(input)} -> ${counted}`);
      }
      // A count that overflows is not silently reduced to one - it is a refusal.
      const enormous = unitsOf("place", "create", {
        mode: "grid",
        rows: rowsUpTo(26),
        columns: Number.MAX_VALUE,
      });
      assert.equal(enormous, UNCOUNTABLE_UNITS);
      assert.equal(
        checkResourceAccess({
          resource: "place",
          entitlements: { plan: "growth", usage: {} },
          requested: enormous,
        }).allowed,
        false,
      );
    },
  },
  {
    name: "the contract's own ceiling bounds the count the gate ever sees",
    run: () => {
      // 40 rows x 60 columns is 2400, which the contract refuses before anything counts it.
      assert.throws(() => grid(rowsUpTo(40), 60));
      assert.ok(unitsOf("place", "create", grid(rowsUpTo(40), 10)) <= 400);
    },
  },

  /* ── The gate ──────────────────────────────────────────────────────────── */
  {
    name: "used + requested > limit refuses, and the boundary is exactly the limit",
    run: () => {
      const at = (usage: number, requested: number) =>
        checkResourceAccess({
          resource: "place",
          entitlements: { plan: "starter", usage: { place: usage } },
          requested,
        }).allowed;
      // starter allows 20 places.
      assert.equal(at(0, 20), true, "a full screen exactly at the cap must be allowed");
      assert.equal(at(0, 21), false, "one over the cap must not");
      assert.equal(at(19, 1), true);
      assert.equal(at(19, 2), false);
      assert.equal(at(20, 1), false);
    },
  },
  {
    name: "REGRESSION: an unstated `requested` is still one, so no existing gate moved",
    run: () => {
      const nineteen = { plan: "starter", usage: { place: 19 } } as const;
      assert.equal(
        checkResourceAccess({ resource: "place", entitlements: nineteen }).allowed,
        true,
      );
      assert.equal(
        checkResourceAccess({ resource: "place", entitlements: nineteen, requested: 1 }).allowed,
        true,
      );
      const full = { plan: "starter", usage: { place: 20 } } as const;
      assert.equal(checkResourceAccess({ resource: "place", entitlements: full }).allowed, false);
    },
  },
  {
    name: "an unlimited plan is not counted at all",
    run: () => {
      const decision = checkResourceAccess({
        resource: "place",
        entitlements: { plan: "pro", usage: { place: 5_000 } },
        requested: 400,
      });
      assert.equal(decision.allowed, true);
      if (!decision.allowed) throw new Error("unreachable");
      assert.equal(decision.remaining, "unlimited");
    },
  },
  {
    name: "a refusal names what was asked for and what was left",
    run: () => {
      const decision = checkResourceAccess({
        resource: "place",
        entitlements: { plan: "starter", usage: { place: 19 } },
        requested: 200,
      });
      assert.equal(decision.allowed, false);
      if (decision.allowed) throw new Error("unreachable");
      assert.equal(decision.requested, 200);
      assert.equal(decision.remaining, 1);
      const message = refusalMessage("place", decision);
      assert.ok(message.includes("200"), message);
      assert.ok(message.includes("1"), message);
      assert.ok(!message.includes("undefined"), message);
    },
  },
  {
    name: "REGRESSION: a single-unit refusal keeps the registry's own upgrade copy, verbatim",
    run: () => {
      for (const resource of RESOURCE_KEYS) {
        const decision = checkResourceAccess({
          resource,
          entitlements: { plan: "starter", usage: { [resource]: 10_000 } },
        });
        if (decision.allowed) continue;
        assert.equal(refusalMessage(resource, decision), decision.upgradeMessage, resource);
      }
      // And a bulk refusal with nothing left at all says the same thing, because then the
      // plan's sentence is true again.
      const spent = checkResourceAccess({
        resource: "place",
        entitlements: { plan: "starter", usage: { place: 20 } },
        requested: 200,
      });
      if (spent.allowed) throw new Error("unreachable");
      assert.equal(refusalMessage("place", spent), spent.upgradeMessage);
    },
  },

  /* ── The gateway: the bypass itself ────────────────────────────────────── */
  {
    name: "THE BUG: a grid of 200 against 20 places used 19 is refused before the bus",
    run: async () => {
      const calls: string[] = [];
      const error = await refuse({ calls, usage: 19, input: grid(rowsUpTo(10), 20) });
      assert.ok(error instanceof GatewayError, "the gateway did not refuse the grid");
      assert.equal(error.failure.code, "UPGRADE_REQUIRED");
      assert.ok(error.message.includes("200"), error.message);
      assert.ok(error.message.includes("1"), error.message);
      const decision = fieldOf(error.failure, "decision");
      assert.equal(fieldOf(decision, "requested"), 200);
      assert.equal(fieldOf(decision, "remaining"), 1);
      // It reached the plan gate, and never reached step 8.
      assert.deepEqual(calls, ["identify", "rateLimit", "entitlements"]);
    },
  },
  {
    name: "REGRESSION: the same tenant may still create the one place it has room for",
    run: () => {
      // The gate is asked about one and answers yes, so nothing below step 6 refuses. Proved
      // through the gate rather than through dispatch, because a call that passes step 6 goes
      // on to the bus and this test has none.
      assert.equal(
        checkResourceAccess({
          resource: "place",
          entitlements: { plan: "starter", usage: { place: 19 } },
          requested: unitsOf("place", "create", ONE_PLACE),
        }).allowed,
        true,
      );
    },
  },
  {
    name: "the parse now precedes the plan gate, and still follows every authorisation gate",
    run: async () => {
      const calls: string[] = [];
      // `rows: []` is refused by the contract. The gateway parses at 5b, so this never costs
      // a billing round trip - and identity, role, permission and the rate limiter all ran
      // first, so an unauthorised caller still cannot make the gateway parse anything.
      const error = await refuse({
        calls,
        usage: 0,
        input: { mode: "grid", branchId: "b_1", rows: [], columns: 10 },
      });
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof GatewayError), "a malformed body is not a gateway decision");
      assert.deepEqual(calls, ["identify", "rateLimit"]);
    },
  },
  {
    name: "a grid over the contract's ceiling is refused before entitlements are read",
    run: async () => {
      const calls: string[] = [];
      await refuse({
        calls,
        usage: 0,
        input: { mode: "grid", branchId: "b_1", rows: rowsUpTo(40), columns: 60 },
      });
      assert.deepEqual(calls, ["identify", "rateLimit"]);
    },
  },

  /* ── The envelope ──────────────────────────────────────────────────────── */
  {
    name: "the authorised count is inside the signature, so it cannot be raised on the bus",
    run: () => {
      const payload = grid(rowsUpTo(10), 20);
      const meta = metaFor(200);
      const signature = signRequest(meta, payload, SECRET);
      assert.ok(verifyRequest(meta, payload, signature, SECRET));
      assert.equal(verifyRequest({ ...meta, units: 400 }, payload, signature, SECRET), false);
      assert.equal(verifyRequest({ ...meta, units: 1 }, payload, signature, SECRET), false);
    },
  },
  {
    name: "an envelope that omits the count is the same claim as one that says one",
    run: () => {
      const payload = { mode: "one" };
      const absent = metaFor(undefined);
      const signature = signRequest(absent, payload, SECRET);
      // Fail-closed: a builder that predates bulk operations authorises exactly one unit.
      assert.ok(verifyRequest({ ...absent, units: DEFAULT_UNITS }, payload, signature, SECRET));
      assert.equal(verifyRequest({ ...absent, units: 2 }, payload, signature, SECRET), false);
    },
  },

  /* ── The service half ──────────────────────────────────────────────────── */
  {
    name: "the service refuses a body that asks for more than its envelope authorised",
    run: async () => {
      // What a gateway that forgot to count would sign: a grid of 200 authorised for one.
      const reply = await serviceReply(DEFAULT_UNITS, grid(rowsUpTo(10), 20));
      assert.equal(reply.ok, false);
      if (reply.ok) throw new Error("unreachable");
      assert.equal(reply.error.code, "UNTRUSTED_ENVELOPE");
      assert.ok(reply.error.message.includes("200"), reply.error.message);
      // And it refused before the handler ran, so no row was written.
      assert.ok(!reply.error.message.includes("reached the handler"));
    },
  },
  {
    name: "an envelope with no count at all authorises one, and a grid beside it is refused",
    run: async () => {
      const reply = await serviceReply(undefined, grid(rowsUpTo(2), 2));
      assert.equal(reply.ok, false);
      if (reply.ok) throw new Error("unreachable");
      assert.equal(reply.error.code, "UNTRUSTED_ENVELOPE");
    },
  },
  {
    name: "REGRESSION: an honest envelope reaches the handler, whatever its size",
    run: async () => {
      for (const [units, payload] of [
        [200, grid(rowsUpTo(10), 20)],
        [400, grid(rowsUpTo(40), 10)],
        // Authorised for more than it asks for: charged too much, never refused.
        [400, grid(rowsUpTo(10), 20)],
        [DEFAULT_UNITS, ONE_PLACE],
      ] as const) {
        const reply = await serviceReply(units, payload);
        assert.equal(reply.ok, false);
        if (reply.ok) throw new Error("unreachable");
        assert.equal(reply.error.message, "reached the handler", `units=${units}`);
      }
    },
  },

  /* ── The meter ─────────────────────────────────────────────────────────── */
  {
    name: "the event body carries the real count, and refuses one below a whole unit",
    run: () => {
      assert.equal(
        eventPayload.parse({ outcome: "success", entityId: null, units: 400 }).units,
        400,
      );
      assert.equal(eventPayload.safeParse({ outcome: "success", units: 0 }).success, false);
      assert.equal(eventPayload.safeParse({ outcome: "success", units: 1.5 }).success, false);
      assert.equal(eventPayload.safeParse({ outcome: "success", units: -5 }).success, false);
    },
  },
  {
    name: "REGRESSION: an event with no count meters exactly one, as every event did before",
    run: async () => {
      const recorded = new Map<string, Metered>();
      const consume = meterOver(recorded);
      await consume(
        eventEnvelope("req_old_build", { outcome: "success", entityId: "p_1" }),
        eventSubject("place", "create"),
      );
      assert.equal(recorded.get("req_old_build")?.value, DEFAULT_UNITS);
    },
  },
  {
    name: "400 seats meter 400, and a redelivery of the same request still meters once",
    run: async () => {
      const recorded = new Map<string, Metered>();
      const consume = meterOver(recorded);
      const body = { outcome: "success", entityId: null, units: 400 };
      const envelope = eventEnvelope("req_grid", body);
      const subject = eventSubject("place", "create");

      await consume(envelope, subject);
      // At-least-once: JetStream redelivers the identical bytes.
      await consume(envelope, subject);
      await consume(envelope, subject);

      assert.equal(recorded.size, 1);
      assert.equal(recorded.get("req_grid")?.value, 400);
      assert.equal(recorded.get("req_grid")?.resource, "place");

      // A different request is a different key, so a second real screen still meters.
      await consume(eventEnvelope("req_grid_2", body), subject);
      assert.equal(recorded.size, 2);
      assert.equal(recorded.get("req_grid_2")?.value, 400);
    },
  },
  {
    name: "a forged or misdelivered event meters nothing, count or no count",
    run: async () => {
      const recorded = new Map<string, Metered>();
      const consume = meterOver(recorded);
      const body = { outcome: "success", entityId: null, units: 400 };
      const meta: RequestMeta = { ...metaFor(400), requestId: "req_forged" };

      // Signed with the wrong secret.
      await consume(
        { meta, payload: body, signature: signEvent(meta, body, "another-secret-entirely-000000") },
        eventSubject("place", "create"),
      );
      // Correctly signed, delivered on a subject the registry does not route it to.
      await consume(
        { meta, payload: body, signature: signEvent(meta, body, SECRET) },
        eventSubject("place", "update"),
      );
      assert.equal(recorded.size, 0);
    },
  },
  {
    name: "the resource's own label is what a counted refusal names",
    run: () => {
      // Not a string typed here: the noun comes from the registry, so renaming the resource
      // renames the sentence.
      const decision = checkResourceAccess({
        resource: "place",
        entitlements: { plan: "starter", usage: { place: 5 } },
        requested: 100,
      });
      if (decision.allowed) throw new Error("unreachable");
      assert.ok(refusalMessage("place", decision).includes(RESOURCES.place.label.toLowerCase()));
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) process.exit(1);
