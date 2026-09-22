/**
 * SOT: registry-derive-assertions, station-gate-assertions
 * WHAT   Plain assertions for the registry's role-normalisation, station and access-decision
 *        logic. Run with `pnpm tsx tests/registry-derive.test.ts` - no test runner, no
 *        config, no new dependency.
 * WHY    normalizeRole and checkResourceAccess are the two functions a browser and the
 *        gateway must never disagree on; this pins their contract without a DOM.
 * WHY    The station block below is mostly REGRESSION coverage, deliberately. Stations
 *        narrow the one function every gate in the platform asks, so the claim that matters
 *        is not "a kitchen member can work the pass" - it is that nothing else moved: every
 *        unstationed operation answers exactly what it answered before, a guest holds the
 *        same set it always held, and an admin is not gated at all.
 * WHERE  packages/registry/src/derive.ts
 */
import assert from "node:assert/strict";

import {
  assignableRoles,
  can,
  checkResourceAccess,
  downgradeBlockers,
  featureRows,
  type Grant,
  isStationGated,
  navAccess,
  normalizeRole,
  normalizeStations,
  ORG_ROLES,
  type OrgRole,
  operationsOf,
  PERMISSIONS_BY_ROLE,
  type Permission,
  permissionsFor,
  planOverages,
  RESOURCE_KEYS,
  roleAtLeast,
  ruleFor,
  STATION_GATED_ROLE,
  STATIONS,
  stationsFor,
  toPermission,
  trialOffer,
  yearlySavings,
} from "../packages/registry/src/index";

type Check = { name: string; run: () => void };

/* ── Station fixtures ────────────────────────────────────────────────────── */

const STARTER = { plan: "starter", usage: {} } as const;

function grant(role: OrgRole, ...stations: readonly string[]): Grant {
  return { role, stations: normalizeStations(stations.join(",")) };
}

/** Whether a grant holds a permission, asked the way the gateway asks it. */
function holds(subject: Grant, permission: Permission): boolean {
  return permissionsFor(subject).some((held) => held === permission);
}

/**
 * Every operation that declares no station, paired with the roles that should hold it. This
 * is the "nothing moved" fixture: it is computed from minRole alone, exactly as the registry
 * behaved before stations existed, and compared against what the station-aware function now
 * returns for a grant with an EMPTY roster - the worst case for a regression.
 */
function unstationedPermissionsOf(role: OrgRole): readonly Permission[] {
  return RESOURCE_KEYS.flatMap((resource) =>
    operationsOf(resource)
      .filter(
        (operation) =>
          roleAtLeast(role, ruleFor(resource, operation).minRole) &&
          stationsFor(resource, operation).length === 0,
      )
      .map((operation) => toPermission(resource, operation)),
  );
}

const checks: Check[] = [
  {
    name: "normalizeRole('owner,admin') -> owner",
    run: () => assert.equal(normalizeRole("owner,admin"), "owner"),
  },
  {
    name: "normalizeRole('admin,owner') -> owner",
    run: () => assert.equal(normalizeRole("admin,owner"), "owner"),
  },
  {
    name: "normalizeRole('root') -> member (unrecognised degrades to lowest)",
    run: () => assert.equal(normalizeRole("root"), "member"),
  },
  {
    name: "normalizeRole(null) -> member (never escalates)",
    run: () => assert.equal(normalizeRole(null), "member"),
  },
  {
    name: "assignableRoles('admin') excludes owner, and never offers guest",
    run: () => assert.deepEqual(assignableRoles("admin"), ["member", "admin"]),
  },
  {
    name: "assignableRoles('owner') includes every seat role but not guest",
    run: () => assert.deepEqual(assignableRoles("owner"), ["member", "admin", "owner"]),
  },
  {
    name: "checkResourceAccess: auditLog on starter (not in plan at all) -> reason 'not_in_plan'",
    run: () => {
      const decision = checkResourceAccess({
        resource: "auditLog",
        entitlements: { plan: "starter", usage: {} },
      });
      assert.equal(decision.allowed, false);
      if (decision.allowed) throw new Error("unreachable");
      assert.equal(decision.reason, "not_in_plan");
    },
  },
  {
    name: "checkResourceAccess: project on growth at its cap of 25 -> reason 'limit_reached'",
    run: () => {
      const decision = checkResourceAccess({
        resource: "project",
        entitlements: { plan: "growth", usage: { project: 25 } },
      });
      assert.equal(decision.allowed, false);
      if (decision.allowed) throw new Error("unreachable");
      assert.equal(decision.reason, "limit_reached");
    },
  },
  {
    name: "featureRows excludes resources unlimited on every plan (membership, billing)",
    run: () => {
      const resources = featureRows().map((row) => row.resource);
      assert.ok(resources.includes("project"));
      assert.ok(!resources.includes("membership"));
      assert.ok(!resources.includes("billing"));
    },
  },
  {
    name: "planOverages names a resource past its cap and nothing else",
    run: () => {
      const over = planOverages({ plan: "starter", usage: { project: 3 } });
      assert.deepEqual(
        over.map((row) => row.resource),
        ["project"],
      );
      assert.deepEqual(planOverages({ plan: "starter", usage: { project: 2 } }), []);
    },
  },
  {
    name: "downgradeBlockers: usage above the target cap blocks; unused not-in-plan resource does not",
    run: () => {
      // 3 projects cannot come down to starter's cap of 2.
      const blockers = downgradeBlockers({ plan: "growth", usage: { project: 3 } }, "starter");
      assert.deepEqual(
        blockers.map((row) => row.resource),
        ["project"],
      );
      // auditLog is not in the starter plan at all, but with no usage there is nothing to lose.
      const clean = downgradeBlockers({ plan: "pro", usage: {} }, "starter");
      assert.deepEqual(clean, []);
    },
  },
  {
    name: "yearlySavings(growth) is 12x monthly minus yearly; yearlySavings(starter) is null",
    run: () => {
      assert.equal(yearlySavings("growth"), 29 * 12 - 290);
      assert.equal(yearlySavings("starter"), null);
    },
  },
  {
    name: "trialOffer(starter) offers growth for its declared days; trialOffer(enterprise) is null",
    run: () => {
      const offer = trialOffer("starter");
      assert.ok(offer !== null);
      assert.equal(offer.plan, "growth");
      assert.equal(offer.days, 14);
      assert.equal(trialOffer("enterprise"), null);
    },
  },

  /* ── Stations: what the new dimension does ─────────────────────────────── */
  {
    name: "a member on the kitchen station may work the pass",
    run: () => {
      const cook = grant("member", "kitchen");
      assert.ok(holds(cook, "kitchenTicket:read"));
      assert.ok(holds(cook, "kitchenTicket:manage"));
      assert.ok(can(permissionsFor(cook), "kitchenTicket", "manage"));
    },
  },
  {
    name: "a member NOT on the kitchen station is refused the pass, rank notwithstanding",
    run: () => {
      const cashier = grant("member", "till");
      // The rank clears kitchenTicket's minRole. The station is the only thing refusing.
      assert.ok(roleAtLeast("member", ruleFor("kitchenTicket", "manage").minRole));
      assert.equal(holds(cashier, "kitchenTicket:read"), false);
      assert.equal(holds(cashier, "kitchenTicket:manage"), false);
    },
  },
  {
    name: "a rostered member with no stations at all holds no station-gated operation",
    run: () => {
      const unrostered = grant("member");
      for (const permission of ["kitchenTicket:read", "order:manage", "place:manage"] as const) {
        assert.equal(holds(unrostered, permission), false, permission);
      }
    },
  },
  {
    name: "the order console is worked from the floor and the counter, never the line",
    run: () => {
      assert.ok(holds(grant("member", "service"), "order:manage"));
      assert.ok(holds(grant("member", "till"), "order:manage"));
      assert.equal(holds(grant("member", "kitchen"), "order:manage"), false);
    },
  },
  {
    name: "two stations on one seat grant the union, never more",
    run: () => {
      const both = grant("member", "kitchen", "till");
      assert.ok(holds(both, "kitchenTicket:manage"));
      assert.ok(holds(both, "order:manage"));
      // service-only surfaces stay out of reach: a station set is a union, not a promotion.
      assert.equal(holds(both, "place:manage"), false);
      assert.equal(holds(both, "serviceRequest:manage"), false);
    },
  },
  {
    name: "admin and owner are never station-gated - a manager covers any post",
    run: () => {
      for (const role of ["admin", "owner"] as const) {
        assert.equal(isStationGated(role), false, role);
        const manager = grant(role);
        assert.ok(holds(manager, "kitchenTicket:manage"), role);
        assert.ok(holds(manager, "order:manage"), role);
        assert.ok(holds(manager, "place:manage"), role);
      }
    },
  },
  {
    name: "only the lowest seat role is station-gated, and it is derived not typed",
    run: () => {
      assert.equal(STATION_GATED_ROLE, "member");
      assert.ok(isStationGated("member"));
      // A guest is below the gated rank: stations never widen, so they cannot reach it.
      assert.equal(isStationGated("guest"), false);
    },
  },
  {
    name: "every declared station gate sits on a station-gated role, and none is empty",
    run: () => {
      for (const resource of RESOURCE_KEYS) {
        for (const operation of operationsOf(resource)) {
          const required = stationsFor(resource, operation);
          if (required.length === 0) continue;
          assert.ok(
            isStationGated(ruleFor(resource, operation).minRole),
            `${resource}.${operation} gates a rank that is exempt`,
          );
          assert.ok(
            required.every((station) => STATIONS.some((known) => known === station)),
            `${resource}.${operation} names a station the registry does not declare`,
          );
        }
      }
    },
  },
  {
    name: "normalizeStations degrades: unknown names contribute nothing, order is the registry's",
    run: () => {
      assert.deepEqual(normalizeStations("till,kitchen"), ["kitchen", "till"]);
      assert.deepEqual(normalizeStations("kitchen,bar,sommelier"), ["kitchen"]);
      assert.deepEqual(normalizeStations("kitchen,kitchen"), ["kitchen"]);
      assert.deepEqual(normalizeStations(null), []);
      assert.deepEqual(normalizeStations(""), []);
    },
  },
  {
    name: "nav: the kitchen display and the order console are on different sidebars",
    run: () => {
      const cook = grant("member", "kitchen");
      const cashier = grant("member", "till");
      assert.equal(navAccess("kitchenTicket", cook, STARTER).visible, true);
      assert.equal(navAccess("kitchenTicket", cashier, STARTER).visible, false);
      // order.read is declared at guest - a diner watches their own order - so the nav has
      // to gate on the resource's whole station set or the console stays on every sidebar.
      assert.equal(navAccess("order", cashier, STARTER).visible, true);
      assert.equal(navAccess("order", cook, STARTER).visible, false);
      // A manager sees both, because a manager is not station-gated.
      assert.equal(navAccess("kitchenTicket", grant("admin"), STARTER).visible, true);
      assert.equal(navAccess("order", grant("admin"), STARTER).visible, true);
    },
  },

  /* ── Stations: the regression half, which matters more ─────────────────── */
  {
    name: "REGRESSION: every unstationed operation is unchanged for every role, empty roster",
    run: () => {
      for (const role of ORG_ROLES) {
        const held = new Set<string>(permissionsFor({ role, stations: [] }));
        for (const permission of unstationedPermissionsOf(role)) {
          assert.ok(held.has(permission), `${role} lost ${permission}`);
        }
      }
    },
  },
  {
    name: "REGRESSION: a grant never holds a permission its rank did not already allow",
    run: () => {
      for (const role of ORG_ROLES) {
        const ceiling = new Set<string>(PERMISSIONS_BY_ROLE[role]);
        for (const permission of permissionsFor({ role, stations: [...STATIONS] })) {
          assert.ok(ceiling.has(permission), `${role} gained ${permission}`);
        }
      }
    },
  },
  {
    name: "REGRESSION: a guest holds exactly what it held before stations existed",
    run: () => {
      const before = new Set<string>(unstationedPermissionsOf("guest"));
      const after = new Set<string>(permissionsFor({ role: "guest", stations: [] }));
      assert.deepEqual([...after].sort(), [...before].sort());
      // And nothing a guest holds is station-gated, which is what keeps that true.
      for (const resource of RESOURCE_KEYS) {
        for (const operation of operationsOf(resource)) {
          if (ruleFor(resource, operation).minRole !== "guest") continue;
          assert.deepEqual(stationsFor(resource, operation), []);
        }
      }
    },
  },
  {
    name: "REGRESSION: a station set makes no difference to a role that is not gated",
    run: () => {
      for (const role of ["guest", "admin", "owner"] as const) {
        const bare = [...permissionsFor({ role, stations: [] })].sort();
        const rostered = [...permissionsFor({ role, stations: [...STATIONS] })].sort();
        assert.deepEqual(rostered, bare, role);
      }
    },
  },
  {
    name: "REGRESSION: PERMISSIONS_BY_ROLE is still the rank's ceiling, for Better Auth",
    run: () => {
      // access.ts derives Better Auth's statements from this. A member on every station is
      // exactly what its `member` role has always described, so those statements are unmoved.
      for (const role of ORG_ROLES) {
        assert.deepEqual(
          [...PERMISSIONS_BY_ROLE[role]].sort(),
          [...permissionsFor({ role, stations: [...STATIONS] })].sort(),
          role,
        );
      }
      assert.deepEqual([...PERMISSIONS_BY_ROLE.guest], [...permissionsFor(grant("guest"))]);
    },
  },
  {
    name: "REGRESSION: stationsFor is empty for an operation nobody station-gated",
    run: () => {
      assert.deepEqual(stationsFor("project", "read"), []);
      assert.deepEqual(stationsFor("member", "manage"), []);
      assert.deepEqual(stationsFor("payment", "manage"), []);
      // And for a pair that does not exist at all, rather than throwing at the wire boundary.
      assert.deepEqual(stationsFor("project", "manage"), []);
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) process.exit(1);
