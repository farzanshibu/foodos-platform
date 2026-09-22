/**
 * SOT: public-routes-assertions
 * WHAT   Plain assertions for which paths the proxy lets through without a staff session.
 *        Run with `pnpm tsx tests/public-routes.test.ts` - no test runner, no config, no
 *        new dependency.
 * WHY    Two failures live here and neither is loud. Too narrow a list silently bricks a
 *        whole surface - the guest ordering flow shipped unreachable this way, redirected
 *        to a staff sign-in page a diner has no account for. Too loose a match leaks a
 *        staff page: `/t` written as a bare `startsWith` swallows `/team`.
 * WHERE  apps/web/src/public-routes.ts, apps/web/src/proxy.ts
 */
import assert from "node:assert/strict";

import { isPublicPath } from "../apps/web/src/public-routes";

type Check = { name: string; run: () => void };

const checks: Check[] = [
  /* ── the guest surface must be reachable with no account at all ───────── */
  {
    name: "a scanned code reaches the scan page",
    run: () => assert.equal(isPublicPath("/q/q_A1B2C3D4"), true),
  },
  {
    name: "the guest menu, basket, orders and requests are all reachable",
    run: () => {
      for (const path of ["/t", "/t/cart", "/t/orders", "/t/requests", "/t/review"]) {
        assert.equal(isPublicPath(path), true, path);
      }
    },
  },
  {
    name: "a guest's own gateway calls are reachable - they hold a ticket, never a session",
    run: () => assert.equal(isPublicPath("/api/trpc/cart.read"), true),
  },
  {
    name: "a payment provider holds no cookie, so its webhook must not be redirected",
    run: () => assert.equal(isPublicPath("/api/webhooks/payments"), true),
  },

  /* ── you cannot require a session to go and get one ───────────────────── */
  {
    name: "every route that mints or recovers a session is reachable without one",
    run: () => {
      for (const path of [
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/invite",
        "/api/auth/callback/google",
      ]) {
        assert.equal(isPublicPath(path), true, path);
      }
    },
  },
  { name: "the landing page is reachable", run: () => assert.equal(isPublicPath("/"), true) },

  /* ── the boundary: a prefix must not swallow a longer sibling ─────────── */
  {
    name: "/t does NOT swallow /team - the staff roster stays behind the check",
    run: () => assert.equal(isPublicPath("/team"), false),
  },
  {
    name: "/q does NOT swallow a longer path that merely starts with q",
    run: () => assert.equal(isPublicPath("/queue"), false),
  },
  {
    name: "/sign-in does NOT swallow /sign-in-as-somebody-else",
    run: () => assert.equal(isPublicPath("/sign-in-as-somebody-else"), false),
  },
  {
    name: "/api/trpc does NOT swallow /api/trpcadmin",
    run: () => assert.equal(isPublicPath("/api/trpcadmin"), false),
  },

  /* ── staff surfaces stay guarded ──────────────────────────────────────── */
  {
    name: "every management surface still requires a session cookie",
    run: () => {
      for (const path of [
        "/manage/orders",
        "/manage/kitchen",
        "/manage/places",
        "/manage/platform",
        "/billing",
        "/audit",
        "/projects",
        "/onboarding",
      ]) {
        assert.equal(isPublicPath(path), false, path);
      }
    },
  },
  {
    name: "the hosted card page is staff data and stays guarded",
    run: () => assert.equal(isPublicPath("/c/charger-tent-a1b2c3"), false),
  },
];

let failed = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${check.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exit(1);
