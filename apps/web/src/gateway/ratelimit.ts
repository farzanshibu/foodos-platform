/**
 * SOT: rate-limit, ratelimit, throttle, ddos, caller-key, forwarded-for
 * WHAT   One limiter, two backends: Upstash in production, in-memory locally. Plus the one
 *        key the platform can build for a caller who has no identity yet.
 * WHY    Rate limiting belongs at the gateway, before a message reaches the bus. A limit
 *        enforced inside a service has already paid for the work it is refusing. A missing
 *        Upstash config in production must fail loud at boot, not degrade into one bucket
 *        map per replica - that silently turns a declared max of N into N x replicas.
 * HOW    The backend is selected once at module init, mirroring `required()` in
 *        `@foodos/env`: no Upstash config in production throws, unless
 *        `RATE_LIMIT_ALLOW_IN_MEMORY` opts a genuine single-instance deploy in (and warns
 *        on every boot when it does). That is a different failure class from a runtime
 *        Upstash outage, which still fails open in `UpstashStore.incr` exactly as before -
 *        an outage in a live backend must not take the product down, but a backend that was
 *        never configured is a deploy mistake the operator needs to see immediately.
 * WHERE  apps/web/src/gateway/deps.ts, apps/web/src/gateway/public-call.ts
 */
import "server-only";

import { env } from "@foodos/env";

export type Verdict = { ok: boolean; retryAfterSeconds: number };

/** One bucket as it stands right now. Both store reads answer in this shape. */
type Reading = { count: number; resetAt: number };

interface RateLimitStore {
  /** Adds one to the bucket and reports the total, creating the bucket if it is new. */
  incr(key: string, windowSeconds: number): Promise<Reading>;
  /** Reports the bucket WITHOUT adding to it. A bucket that does not exist reads as zero. */
  peek(key: string, windowSeconds: number): Promise<Reading>;
}

class InMemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  // No network I/O here, so no `await` - returning `Promise.resolve` directly (instead of
  // declaring this `async`) keeps it honest with the `useAwait` lint rule while still
  // satisfying the `RateLimitStore` interface, which is async for `UpstashStore`'s sake.
  incr(key: string, windowSeconds: number): Promise<Reading> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, fresh);
      return Promise.resolve(fresh);
    }
    bucket.count += 1;
    return Promise.resolve(bucket);
  }

  peek(key: string, windowSeconds: number): Promise<Reading> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      /** Not written back: a read must never be the thing that creates a bucket. */
      return Promise.resolve({ count: 0, resetAt: now + windowSeconds * 1000 });
    }
    /** Copied rather than handed out, so a caller cannot edit the bucket by accident. */
    return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
  }
}

class UpstashStore implements RateLimitStore {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  /**
   * The fixed window both reads share. Written once so `incr` and `peek` can never disagree
   * about which bucket they are talking about - two copies of this arithmetic drifting by a
   * millisecond would let a caller be charged in one window and read in the next.
   */
  private slot(key: string, windowSeconds: number): { redisKey: string; resetAt: number } {
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    return { redisKey: `rl:${key}:${window}`, resetAt: (window + 1) * windowSeconds * 1000 };
  }

  async incr(key: string, windowSeconds: number): Promise<Reading> {
    const { redisKey, resetAt } = this.slot(key, windowSeconds);
    try {
      const response = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        // Header names are case-insensitive per RFC 7230 3.2; lowercase satisfies the lint
        // rule for identifier-shaped object keys without changing what goes over the wire.
        headers: { authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", redisKey],
          ["EXPIRE", redisKey, String(windowSeconds)],
        ]),
        cache: "no-store",
      });
      if (!response.ok) return { count: 0, resetAt };
      const payload: unknown = await response.json();
      return { count: countOf(payload), resetAt };
    } catch {
      // Fail open: a live Upstash outage must never take the product down. This is the
      // other failure class from `selectStore` below - a backend that stops answering at
      // runtime is not the same problem as a backend that was never configured at boot, and
      // treating them the same would turn a transient network blip into an outage of the
      // entire gateway. Reporting count 0 here means the caller always sees `ok: true`.
      return { count: 0, resetAt };
    }
  }

  /**
   * Fails open on exactly the same reasoning as `incr`: an unreadable bucket reads as empty,
   * so an Upstash outage cannot lock a guest out of a restaurant. The bucket this reads is
   * the one `incr` writes, so a caller charged by one is seen by the other.
   */
  async peek(key: string, windowSeconds: number): Promise<Reading> {
    const { redisKey, resetAt } = this.slot(key, windowSeconds);
    try {
      const response = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["GET", redisKey]]),
        cache: "no-store",
      });
      if (!response.ok) return { count: 0, resetAt };
      const payload: unknown = await response.json();
      return { count: countOf(payload), resetAt };
    } catch {
      return { count: 0, resetAt };
    }
  }
}

/**
 * Reads `[{ result: "12" }]` out of a pipeline response without asserting its shape. Redis
 * returns a GET as a string, Upstash sometimes as a number, and a missing key as null; all
 * three are narrowed here rather than trusted, because this is a parse boundary and the
 * value decides whether somebody is refused.
 */
function countOf(payload: unknown): number {
  if (!Array.isArray(payload)) return 0;
  const entries: readonly unknown[] = payload;
  const first = entries[0];
  if (typeof first !== "object" || first === null || !("result" in first)) return 0;
  const result: unknown = first.result;
  const count = typeof result === "number" ? result : Number(result);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function selectStore(): RateLimitStore {
  const upstash = env.upstash();
  if (upstash !== null) return new UpstashStore(upstash.url, upstash.token);

  if (env.isProduction()) {
    if (env.rateLimitAllowInMemory()) {
      console.warn(
        "[ratelimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set in " +
          "production. Falling back to an in-memory limiter because " +
          "RATE_LIMIT_ALLOW_IN_MEMORY is set. This is only correct for a genuine " +
          "single-instance deployment: every replica enforces its own limit " +
          "independently, so N replicas would honour up to N x the declared max.",
      );
      return new InMemoryStore();
    }
    throw new Error(
      "Rate limiting is unconfigured in production. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN, or set RATE_LIMIT_ALLOW_IN_MEMORY=on for a genuine " +
        "single-instance deployment. Without one of these, each replica would enforce its " +
        "own limit independently, turning a declared max of N requests per window into " +
        "N x replicas.",
    );
  }

  return new InMemoryStore();
}

const store = selectStore();
const disabled = !env.isProduction() && !env.rateLimitInDev();

export async function rateLimit(args: {
  key: string;
  max: number;
  windowSeconds: number;
}): Promise<Verdict> {
  if (disabled) return { ok: true, retryAfterSeconds: 0 };

  const now = Date.now();
  const { count, resetAt } = await store.incr(args.key, args.windowSeconds);
  if (count > args.max) {
    return { ok: false, retryAfterSeconds: Math.ceil((resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * The verdict for a bucket this call is NOT spending from.
 *
 * `rateLimit` charges first and then asks "was that one too many", so it refuses at
 * `count > max`. This one has charged nothing, so the honest question is "would one more
 * charge be too many", which refuses at `count >= max`. The difference is not a rounding
 * choice: it is what lets a bucket be filled by one outcome and consulted by another.
 *
 * The one caller is the QR scan path, where the failure bucket is charged only when a token
 * did not resolve and must be read on every attempt. Charging it to read it would turn a
 * budget of "failures" into a budget of "attempts" and throttle the honest table of six that
 * the generous per-caller limit exists to allow.
 */
export async function rateLimitStanding(args: {
  key: string;
  max: number;
  windowSeconds: number;
}): Promise<Verdict> {
  if (disabled) return { ok: true, retryAfterSeconds: 0 };

  const now = Date.now();
  const { count, resetAt } = await store.peek(args.key, args.windowSeconds);
  if (count >= args.max) {
    return { ok: false, retryAfterSeconds: Math.ceil((resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/* ── Keying a caller who has no identity ─────────────────────────────────── */

/**
 * What this file calls a request it cannot attribute to anybody.
 *
 * Exported because the decision to fail CLOSED here - every unattributable request sharing
 * one bucket - is severe enough that the caller has to be able to see it and say so out
 * loud. See `warnUnattributed` in public-call.ts.
 */
export const UNATTRIBUTED_CALLER = "unattributed";

/**
 * The header, and why it is the only one trusted.
 *
 * `x-forwarded-for` is the single header this platform reads a caller address from; the
 * gateway's request context already reads the same one (`gateway/init.ts`), and having two
 * files disagree about who the caller is would mean two different answers to the same
 * question. Every other candidate - `x-real-ip`, `cf-connecting-ip`, `true-client-ip`,
 * `forwarded` - is exactly as forgeable as this one and adds nothing: what makes a value
 * here trustworthy is not its name, it is that the edge in front of this process OVERWRITES
 * it rather than appending to it.
 *
 * That is the deployment contract, and it is worth stating plainly because everything below
 * rests on it: the reverse proxy or CDN that terminates TLS must set
 * `x-forwarded-for` to the peer address it actually saw, discarding whatever the client
 * sent. Vercel, Cloudflare and an nginx with `proxy_set_header X-Forwarded-For $remote_addr`
 * all behave that way, which is why the LEFTMOST entry is the one read here.
 *
 * Two deployments break that, and both break it silently. If the edge APPENDS instead
 * (`$proxy_add_x_forwarded_for`), the leftmost entry is whatever the client typed. If this
 * process is reachable from the internet directly - no edge, or an edge that can be
 * bypassed by addressing the origin - the header is entirely client-supplied and Next hands
 * it straight through. Either way a caller can present a fresh address per request, which is
 * the same as having no limiter at all. Nothing inside this process can detect it: a forged
 * address is a well-formed address, and the warning below never fires because the header is
 * present. So the requirement is not "an edge exists" but "an overwriting edge is the only
 * route in", and it is written down here because it is a deployment fact that no amount of
 * code can check.
 *
 * Behind a proxy that sets NO forwarding header at all, and for a request that arrives with
 * one that is not an address, there is no caller to key on and every such request shares
 * `UNATTRIBUTED_CALLER`. That is deliberately the closed direction, matching this file's
 * existing policy: a runtime outage in a live backend fails open (`UpstashStore.incr`), but
 * a deployment that was never configured fails loud (`selectStore`). A missing forwarding
 * header in production is the second kind - the operator has one line of edge config to
 * write - and failing open there would restore the unthrottled guessing oracle this whole
 * key exists to close.
 */
const FORWARDED_FOR = "x-forwarded-for";

/**
 * Long enough for the longest textual IPv6 address (45 characters) with brackets and a port.
 * Anything longer is not an address, and an unbounded string must never become a Redis key.
 */
const MAX_ADDRESS_LENGTH = 64;

/** How many hextets of an IPv6 address make the /64 this keys on. */
const IPV6_PREFIX_GROUPS = 4;
const IPV6_GROUPS = 8;

/**
 * The caller a limiter can key on before any identity exists.
 *
 * Pure, and exported so the trust decision above is pinned by assertions rather than by
 * care - see tests/scan-throttle.test.ts.
 */
export function callerKey(requestHeaders: Headers): string {
  const header = requestHeaders.get(FORWARDED_FOR);
  if (header === null) return UNATTRIBUTED_CALLER;
  const leftmost = header.split(",")[0] ?? "";
  return normaliseAddress(leftmost.trim()) ?? UNATTRIBUTED_CALLER;
}

function normaliseAddress(value: string): string | null {
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;
  const bare = stripPort(value);
  return normaliseIpv4(bare) ?? normaliseIpv6Prefix(bare);
}

/**
 * `[2001:db8::1]:443` and `1.2.3.4:443` both name one caller, and a port that changes on
 * every connection would hand out a fresh bucket per request. A bare IPv6 address carries
 * more than one colon and is left alone.
 */
function stripPort(value: string): string {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close < 0 ? "" : value.slice(1, close);
  }
  const colon = value.indexOf(":");
  if (colon >= 0 && value.indexOf(":", colon + 1) < 0) return value.slice(0, colon);
  return value;
}

/**
 * Canonical, not merely valid: `01.2.3.4` and `1.2.3.4` are one host, and leaving both
 * spellings alive would be two buckets for one caller.
 */
function normaliseIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets.join(".");
}

/**
 * An IPv6 caller is keyed on its /64, never on the full address.
 *
 * A residential IPv6 allocation is a /64 at its smallest and frequently a /56 or /48, so
 * one household holds at least 18 quintillion addresses and can put every guess on a
 * different one. A per-address key would be a limiter that any IPv6 attacker steps around
 * for free. The /64 is the smallest block that is reliably one subscriber, and it is what
 * nginx and Cloudflare rate-limit on for the same reason.
 */
function normaliseIpv6Prefix(value: string): string | null {
  const lower = value.toLowerCase();
  /** `::ffff:1.2.3.4` is an IPv4 caller wearing an IPv6 coat. Key it as the IPv4 it is. */
  if (lower.startsWith("::ffff:")) {
    const mapped = normaliseIpv4(lower.slice("::ffff:".length));
    if (mapped !== null) return mapped;
  }

  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;
  const head = groupsOf(halves[0] ?? "");
  const tail = groupsOf(compressed ? (halves[1] ?? "") : "");
  if (head === null || tail === null) return null;

  const written = head.length + tail.length;
  /** Without `::` every group is written out; with it, `::` stands for at least one. */
  if (compressed ? written >= IPV6_GROUPS : written !== IPV6_GROUPS) return null;

  const zeros = new Array<string>(IPV6_GROUPS - written).fill("0");
  const groups = compressed ? [...head, ...zeros, ...tail] : head;
  return `${groups.slice(0, IPV6_PREFIX_GROUPS).join(":")}::/64`;
}

/** An empty side of a `::` is no groups at all, which is what a leading or trailing one has. */
function groupsOf(value: string): readonly string[] | null {
  if (value.length === 0) return [];
  const groups = value.split(":");
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
  }
  /** `0db8` and `db8` are one group; the key must not depend on how it was spelled. */
  return groups.map((group) => group.replace(/^0+(?=.)/, ""));
}
