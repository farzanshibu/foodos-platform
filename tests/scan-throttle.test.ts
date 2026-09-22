/**
 * SOT: scan-throttle-assertions, caller-key-assertions
 * WHAT   Plain assertions for the two pieces of pure logic behind the QR scan limiter: how a
 *        caller with no identity is keyed, and when a bucket that is charged by one outcome
 *        and read by another refuses. Run with
 *        `RATE_LIMIT_DEV=on tsx --conditions=react-server tests/scan-throttle.test.ts` -
 *        no test runner, no config, no new dependency.
 * WHY    `publicCall` is the one call in the product that runs before any identity exists,
 *        so it skips the block and the block's rate limit with it. What replaces that limit
 *        rests entirely on the key: too coarse and the limiter itself denies service to
 *        every restaurant at once, too fine - a full IPv6 address, an unnormalised port, a
 *        leading zero - and any attacker steps around it for free by spelling their address
 *        differently. Neither failure is visible at runtime. Both are one assertion each.
 * HOW    RATE_LIMIT_DEV=on is set on the command line rather than written into this file,
 *        for two reasons: the limiter reads it once at module init, so a later assignment
 *        would be too late, and @foodos/env is the only place allowed to read
 *        process.env. Off by default, the limiter answers `ok` to everything and every
 *        assertion below about a refusal would be vacuous.
 *        Only the in-memory backend is exercised. The Upstash one is a network call and is
 *        not something a plain assertion file should be pretending to have - so the test
 *        script blanks UPSTASH_REDIS_REST_URL and _TOKEN rather than leaving the backend to
 *        whatever happens to be in the developer's .env. Against a persistent store these
 *        keys survive the run, and the second run starts with budgets the first spent.
 * WHERE  apps/web/src/gateway/ratelimit.ts, apps/web/src/gateway/public-call.ts
 */
import assert from "node:assert/strict";

import {
  callerKey,
  rateLimit,
  rateLimitStanding,
  UNATTRIBUTED_CALLER,
} from "../apps/web/src/gateway/ratelimit";

type Check = { name: string; run: () => void | Promise<void> };

/** The header the limiter trusts, and the only one it reads. */
function forwardedFor(value: string): Headers {
  return new Headers({ "x-forwarded-for": value });
}

/** A key nobody else in this file uses, so one check cannot spend another's budget. */
let counter = 0;
function freshKey(name: string): string {
  counter += 1;
  return `test:${name}:${counter}`;
}

const checks: Check[] = [
  /* ── the limiter has to actually be on, or nothing below means anything ── */
  {
    name: "the limiter is live for this run - RATE_LIMIT_DEV=on",
    run: async () => {
      const key = freshKey("live");
      await rateLimit({ key, max: 1, windowSeconds: 60 });
      const second = await rateLimit({ key, max: 1, windowSeconds: 60 });
      assert.equal(
        second.ok,
        false,
        "The limiter answered ok past its max, which means it is disabled. Run this file " +
          "with RATE_LIMIT_DEV=on - see the test script in the root package.json.",
      );
    },
  },

  /* ── the key: what is trusted ────────────────────────────────────────── */
  {
    name: "no forwarding header at all is unattributable, not an empty key",
    run: () => assert.equal(callerKey(new Headers()), UNATTRIBUTED_CALLER),
  },
  {
    name: "a header that is not an address is unattributable, never used verbatim",
    run: () => {
      for (const value of ["", "   ", "unknown", "localhost", "abcd", "1.2.3", "999.1.1.1"]) {
        assert.equal(callerKey(forwardedFor(value)), UNATTRIBUTED_CALLER, value);
      }
    },
  },
  {
    name: "an absurdly long header is refused rather than becoming a Redis key",
    run: () => assert.equal(callerKey(forwardedFor("1".repeat(200))), UNATTRIBUTED_CALLER),
  },
  {
    name: "the LEFTMOST entry is read - the address the edge saw, not the hops behind it",
    run: () => {
      assert.equal(callerKey(forwardedFor("1.2.3.4, 10.0.0.1, 10.0.0.2")), "1.2.3.4");
      assert.equal(callerKey(forwardedFor("  1.2.3.4  ,10.0.0.1")), "1.2.3.4");
    },
  },

  /* ── the key: one caller must not be able to spell itself two ways ────── */
  {
    name: "a port is stripped - it changes per connection and would be a fresh bucket each time",
    run: () => {
      assert.equal(callerKey(forwardedFor("1.2.3.4:51234")), "1.2.3.4");
      assert.equal(callerKey(forwardedFor("1.2.3.4:51234")), callerKey(forwardedFor("1.2.3.4")));
      assert.equal(
        callerKey(forwardedFor("[2001:db8::1]:443")),
        callerKey(forwardedFor("2001:db8::1")),
      );
    },
  },
  {
    name: "a padded octet is the same caller as an unpadded one",
    run: () => assert.equal(callerKey(forwardedFor("01.002.3.4")), "1.2.3.4"),
  },
  {
    name: "a compressed IPv6 address is the same caller as its written-out form",
    run: () =>
      assert.equal(
        callerKey(forwardedFor("2001:db8::1")),
        callerKey(forwardedFor("2001:0db8:0000:0000:0000:0000:0000:0001")),
      ),
  },
  {
    name: "case does not split a bucket",
    run: () =>
      assert.equal(callerKey(forwardedFor("2001:DB8::1")), callerKey(forwardedFor("2001:db8::1"))),
  },
  {
    name: "an IPv4-mapped address is keyed as the IPv4 caller it is",
    run: () => assert.equal(callerKey(forwardedFor("::ffff:1.2.3.4")), "1.2.3.4"),
  },
  {
    name: "a malformed IPv6 address is unattributable rather than its own bucket",
    run: () => {
      for (const value of ["2001:db8:::1", "2001:db8::1::2", "2001:zzzz::1", "2001:db8:1"]) {
        assert.equal(callerKey(forwardedFor(value)), UNATTRIBUTED_CALLER, value);
      }
    },
  },

  /* ── the key: an IPv6 caller is a /64, not an address ─────────────────── */
  {
    name: "every address in one /64 is one caller - a household holds 2^64 of them",
    run: () => {
      const first = callerKey(forwardedFor("2001:db8:abcd:1234::1"));
      const second = callerKey(forwardedFor("2001:db8:abcd:1234:ffff:ffff:ffff:ffff"));
      assert.equal(first, second);
      assert.equal(first, "2001:db8:abcd:1234::/64");
    },
  },
  {
    name: "a different /64 is a different caller - the block is not so coarse it merges strangers",
    run: () =>
      assert.notEqual(
        callerKey(forwardedFor("2001:db8:abcd:1234::1")),
        callerKey(forwardedFor("2001:db8:abcd:9999::1")),
      ),
  },
  {
    name: "the loopback and the unspecified address still key to something usable",
    run: () => {
      assert.equal(callerKey(forwardedFor("::1")), "0:0:0:0::/64");
      assert.equal(callerKey(forwardedFor("::")), "0:0:0:0::/64");
    },
  },

  /* ── the decision: charged by one outcome, read by another ────────────── */
  {
    name: "rateLimit allows exactly max charges and refuses the one after",
    run: async () => {
      const key = freshKey("volume");
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const verdict = await rateLimit({ key, max: 3, windowSeconds: 60 });
        assert.equal(verdict.ok, true, `charge ${attempt} of 3 should pass`);
      }
      const refused = await rateLimit({ key, max: 3, windowSeconds: 60 });
      assert.equal(refused.ok, false);
      assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60);
    },
  },
  {
    name: "rateLimitStanding refuses one charge EARLIER, because it has not charged",
    run: async () => {
      const key = freshKey("standing");
      for (let failure = 0; failure < 3; failure += 1) {
        await rateLimit({ key, max: 3, windowSeconds: 60 });
      }
      /**
       * Three failures recorded against a budget of three. `rateLimit` would still have said
       * ok on the third, because it counts the call it just made; this is asked BEFORE the
       * next failure, so the honest answer is that the budget is spent.
       */
      const verdict = await rateLimitStanding({ key, max: 3, windowSeconds: 60 });
      assert.equal(verdict.ok, false);
      assert.ok(verdict.retryAfterSeconds > 0);
    },
  },
  {
    name: "reading a bucket never spends from it - the whole reason the two limits stay apart",
    run: async () => {
      const key = freshKey("peek");
      for (let read = 0; read < 50; read += 1) {
        const verdict = await rateLimitStanding({ key, max: 2, windowSeconds: 60 });
        assert.equal(verdict.ok, true, "an untouched bucket must read as empty however often");
      }
      /** Fifty reads later the budget is untouched: two charges still pass. */
      assert.equal((await rateLimit({ key, max: 2, windowSeconds: 60 })).ok, true);
      assert.equal((await rateLimit({ key, max: 2, windowSeconds: 60 })).ok, true);
      assert.equal((await rateLimit({ key, max: 2, windowSeconds: 60 })).ok, false);
    },
  },

  /* ── the decision, as a scan sees it ──────────────────────────────────── */
  {
    name: "a table of six scanning the same code never touches the failure budget",
    run: async () => {
      const caller = "scan:1.2.3.4:qrSession:create";
      const failures = `${caller}:failed`;
      /** Six phones, then two reloads. Every one of them resolved, so none is charged. */
      for (let scan = 0; scan < 8; scan += 1) {
        const volume = await rateLimit({ key: caller, max: 240, windowSeconds: 60 });
        assert.equal(volume.ok, true, `scan ${scan + 1} is well inside the generous limit`);
        const standing = await rateLimitStanding({ key: failures, max: 20, windowSeconds: 600 });
        assert.equal(standing.ok, true, "a successful scan must never fill the failure budget");
      }
    },
  },
  {
    name: "twenty refused tokens from one caller close the surface to that caller",
    run: async () => {
      const failures = freshKey("guessing:failed");
      for (let guess = 0; guess < 20; guess += 1) {
        const standing = await rateLimitStanding({ key: failures, max: 20, windowSeconds: 600 });
        assert.equal(standing.ok, true, `guess ${guess + 1} is still inside the budget`);
        /** The token did not resolve, so the failure is charged - `chargeFailure` in public-call. */
        await rateLimit({ key: failures, max: 20, windowSeconds: 600 });
      }
      const refused = await rateLimitStanding({ key: failures, max: 20, windowSeconds: 600 });
      assert.equal(refused.ok, false, "the twenty-first guess must be refused before the bus");
    },
  },
  {
    name: "one caller exhausting its budget leaves every other caller untouched",
    run: async () => {
      const suffix = `${Date.now()}`;
      const guessing = `scan:198.51.100.7:qrSession:create:failed:${suffix}`;
      const innocent = `scan:203.0.113.9:qrSession:create:failed:${suffix}`;
      for (let guess = 0; guess < 25; guess += 1) {
        await rateLimit({ key: guessing, max: 20, windowSeconds: 600 });
      }
      assert.equal(
        (await rateLimitStanding({ key: guessing, max: 20, windowSeconds: 600 })).ok,
        false,
      );
      assert.equal(
        (await rateLimitStanding({ key: innocent, max: 20, windowSeconds: 600 })).ok,
        true,
        "a busy or hostile caller must not spend anybody else's allowance - that is the " +
          "denial of service the per-caller key exists to avoid",
      );
    },
  },
];

let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${check.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exit(1);
