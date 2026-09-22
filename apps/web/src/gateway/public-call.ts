/**
 * SOT: public-call, platform-envelope, scan-bootstrap, system-call, scan-throttle
 * WHAT   The one call the product has to make before anybody has an identity.
 * WHY    The block starts with an identity and an organisation. Resolving a QR token has
 *        neither - that call is what FINDS the organisation. Rather than letting a page reach
 *        for a signing primitive, it lives here, behind one named function, inside the one
 *        directory the architecture check allows those primitives in.
 * HOW    It carries PLATFORM_ORG_ID, which matches no tenant's rows: a handler reached with it
 *        by mistake finds nothing rather than everything. The one handler allowed to see it
 *        says so out loud, and it does not scope a query by it.
 *        Because it skips the block, it also skips the block's fifth gate, so the limiter the
 *        gateway would have applied is applied here by hand - the only place in the platform
 *        that is true of. See "Throttling the one call that runs before an identity" below.
 * WHERE  apps/web/src/app/q/[token], apps/web/src/gateway/ratelimit.ts, services/qr
 */
import "server-only";

import {
  contractFor,
  type Envelope,
  type InputOf,
  type OutputOf,
  type ReplyEnvelope,
  type RequestMeta,
  ServiceError,
  signRequest,
  verifyReply,
} from "@foodos/contracts";
import { env } from "@foodos/env";
import {
  DEFAULT_PLAN,
  failureLimitFor,
  type OperationOf,
  PLATFORM_ORG_ID,
  RESOURCES,
  type ResourceKey,
  rpcSubject,
  ruleFor,
  toPermission,
} from "@foodos/registry";
import { rpcRequest } from "@foodos/transport";
import { headers } from "next/headers";
import { callerKey, rateLimit, rateLimitStanding, UNATTRIBUTED_CALLER } from "./ratelimit";

/** Short by design: nobody retries a public call, and a wide deadline is a wide replay. */
const PUBLIC_TIMEOUT_MS = 5_000;

/**
 * The allow-list. Exactly ONE operation legitimately runs without a tenant - resolving a
 * scanned code, which is the call that finds the tenant. It is named here rather than passed
 * in, so this cannot become a general-purpose back door: adding a second is a deliberate edit
 * to this line and nothing less.
 */
const PUBLIC_OPERATIONS = new Set(["qrSession:create"]);

/* ── Throttling the one call that runs before an identity ────────────────── */

/**
 * Why this is not simply the gateway's gate 5.
 *
 * Every other limit in the product is keyed per organisation - `org:<orgId>:...` in
 * `packages/core/src/gateway.ts` - and that is impossible here, because finding the
 * organisation is what this call DOES. Keying on PLATFORM_ORG_ID would put every scan on
 * the platform in one bucket, so the busiest restaurant in the estate would spend the
 * allowance of every other one: a denial of service delivered by the limiter itself.
 *
 * So the key is the caller, derived in `ratelimit.ts` from the one header this platform
 * trusts, with the deployment contract that makes it trustworthy written out there.
 *
 * A limit matters here more than anywhere else in the product. A QR token is `q_` plus ten
 * characters of CSPRNG output from a 31-character alphabet, and possessing one mints a
 * signed guest ticket for somebody's table - to order on their tab and read their session.
 * Entropy is the whole of that defence, and entropy only means anything against a bounded
 * number of guesses. Unlimited guessing is what turns "astronomically unlikely" into
 * "eventually".
 */

/**
 * `scan:` is its own bucket space, so a caller keyed here can never collide with the
 * `org:` and `guest:` principals gate 5 keys on.
 */
function scanKey(caller: string, resource: string, operation: string): string {
  return `scan:${caller}:${resource}:${operation}`;
}

let unattributedWarned = false;

/**
 * Once per process, and only in production. An unattributable request means the edge in
 * front of this process is not setting `x-forwarded-for`, which collapses every scan on the
 * platform into one shared bucket - correct, because the alternative is no limit at all,
 * but an outage waiting to happen and one line of edge configuration to fix. Silence would
 * make it look like an application bug for as long as it took somebody to find this file.
 * Locally it says nothing: `next dev` sets no forwarding header and the limiter is off there
 * anyway.
 */
function warnUnattributed(): void {
  if (unattributedWarned || !env.isProduction()) return;
  unattributedWarned = true;
  console.warn(
    "[public-call] A public scan arrived with no usable x-forwarded-for, so it cannot be " +
      "attributed to a caller and shares one rate-limit bucket with every other such " +
      "request on the platform. Configure the edge in front of this process to overwrite " +
      "x-forwarded-for with the peer address it saw - see callerKey in gateway/ratelimit.ts.",
  );
}

/**
 * The refusal, carrying nothing.
 *
 * Gate 5 attaches `retryAfterSeconds` to its own RATE_LIMITED failure, and that is right
 * there: it answers an authenticated caller through tRPC, where telling a known client when
 * to come back is a courtesy. Here it would be the tell. `q/[token]/page.tsx` renders one
 * screen for every failure on purpose - a revoked code and a typo are the same screen - and
 * a refusal that arrived with a retry hint, a different status or different copy would be a
 * NEW outcome, one that says "your guess was too fast" rather than "your guess was wrong".
 * That is precisely what an attacker needs to tune a slow, patient search that never trips
 * anything. So this throws the same shape as every other failure on this path, is caught by
 * the same `catch`, and renders the same notice. What remains is timing - the refusal
 * returns without a bus round trip - and that is left alone deliberately: closing it means
 * holding a connection open on the cheapest path in the product, which hands an attacker a
 * resource-exhaustion lever in exchange for a signal that only ever says "you are being
 * throttled", never "that token exists".
 */
function refusal(): ServiceError {
  return new ServiceError("RATE_LIMITED", "Too many scans from this caller.");
}

/** Who is asking, when nothing about the request can say who. */
async function scanCaller(): Promise<string> {
  const caller = callerKey(await headers());
  if (caller === UNATTRIBUTED_CALLER) warnUnattributed();
  return caller;
}

/**
 * Two limits, because the two things being refused are not the same thing.
 *
 * The generous one is volume, and it is the resource's own declared `rateLimit` - the same
 * number gate 5 applies to a guest calling the same resource, so changing it in the registry
 * changes it in both places at once. It has to be generous: a table of six all scan the same
 * code within a minute, a diner reloads, and a whole venue can share one NAT address.
 *
 * The tight one is failures, and only failures - it is charged in `chargeFailure` when a
 * token did not resolve, never merely because somebody scanned. That is what lets it be a
 * hundredth of the other without throttling the table of six: a caller whose scans succeed
 * never touches it.
 */
async function refuseIfThrottled(
  caller: string,
  resource: ResourceKey,
  operation: string,
): Promise<void> {
  const key = scanKey(caller, resource, operation);

  const volume = await rateLimit({ key, ...RESOURCES[resource].rateLimit });
  if (!volume.ok) throw refusal();

  /**
   * Both budgets are declared on the resource - `rateLimit` charged per call, `failureRateLimit`
   * per proved-wrong attempt - so moving either is a registry edit and nothing else. They
   * cannot be one number: set it low enough to stop a search and it refuses a table of six
   * scanning the same code; set it high enough for the table and it does not stop a search.
   * A resource declaring no failure budget gets none, which is right - a wrong answer is only
   * evidence where the input is a secret, and `qrSession` is the one place it is.
   */
  const budget = failureLimitFor(resource);
  if (budget === null) return;

  /**
   * Read, not charged. `rateLimitStanding` exists for exactly this: spending from the
   * failure bucket to find out how full it is would make it a second attempt limit.
   */
  const failures = await rateLimitStanding({ key: `${key}:failed`, ...budget });
  if (!failures.ok) throw refusal();
}

/**
 * One failed resolution, recorded.
 *
 * The verdict is deliberately ignored: this call is already answering a failure, and the
 * refusal it earns belongs to the caller's NEXT attempt, where `refuseIfThrottled` reads it.
 * Refusing here as well would mean two different failures for one attempt.
 *
 * Charged at the two places a token is proved not to be a token - it did not parse, or the
 * qr service said no - and nowhere else. A timeout, an unreachable service or an unsigned
 * reply is the platform faltering, not somebody guessing, and charging those would let a
 * qr-service outage lock every guest in the estate out for ten minutes after it recovered.
 */
async function chargeFailure(
  caller: string,
  resource: ResourceKey,
  operation: string,
): Promise<void> {
  const budget = failureLimitFor(resource);
  if (budget === null) return;

  const key = `${scanKey(caller, resource, operation)}:failed`;
  await rateLimit({ key, ...budget });
}

async function publicCall<K extends ResourceKey, O extends OperationOf<K>>(args: {
  resource: K;
  operation: O;
  input: InputOf<K, O>;
}): Promise<OutputOf<K, O>> {
  const permission = toPermission(args.resource, args.operation);
  if (!PUBLIC_OPERATIONS.has(permission)) {
    throw new ServiceError("PERMISSION_DENIED", `${permission} is not a public operation.`);
  }

  const caller = await scanCaller();
  const operation = String(args.operation);
  await refuseIfThrottled(caller, args.resource, operation);

  const rule = ruleFor(args.resource, args.operation);
  const issuedAt = Date.now();
  const meta: RequestMeta = {
    requestId: crypto.randomUUID(),
    orgId: PLATFORM_ORG_ID,
    userId: "system:public",
    /** One permission. This envelope is not a credential for anything else. */
    role: "guest",
    /** A guest ticket the server minted for nobody in particular. No seat, no post. */
    stations: [],
    permissions: [permission],
    plan: DEFAULT_PLAN,
    resource: args.resource,
    operation: args.operation,
    issuedAt,
    deadlineAt: issuedAt + PUBLIC_TIMEOUT_MS,
  };

  const contract = contractFor(args.resource, args.operation);
  /**
   * A token that is not even shaped like a token is still a guess, and it is the cheapest
   * one to send in volume - it never reaches the bus, so nothing downstream would ever
   * count it. Charged here so that the failure budget means "tokens that did not resolve"
   * rather than "tokens the qr service happened to see".
   */
  let payload: InputOf<K, O>;
  try {
    payload = contract.input.parse(args.input);
  } catch (error) {
    await chargeFailure(caller, args.resource, operation);
    throw error;
  }
  const envelope: Envelope<InputOf<K, O>> = {
    meta,
    payload,
    signature: signRequest(meta, payload, env.envelopeSecret()),
  };

  let reply: ReplyEnvelope<unknown>;
  try {
    reply = await rpcRequest({
      subject: rpcSubject(args.resource, args.operation),
      envelope,
      timeoutMs: rule.timeoutMs,
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("SERVICE_UNAVAILABLE", "Nothing answered. Try again shortly.");
  }

  /** The same two proofs the gateway demands of a reply: whose answer, and is it ours. */
  if (reply.requestId !== meta.requestId) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply does not belong to this request.");
  }
  const answered = reply.ok ? reply.data : reply.error;
  if (
    !verifyReply(
      {
        requestId: meta.requestId,
        resource: args.resource,
        operation: args.operation,
        ok: reply.ok,
      },
      answered,
      reply.signature,
      env.envelopeSecret(),
    )
  ) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply signature is not valid.");
  }
  if (!reply.ok) {
    /** The qr service looked and said no. That is a guess that missed - charge it. */
    await chargeFailure(caller, args.resource, operation);
    throw new ServiceError("NOT_FOUND", reply.error.message);
  }

  return contract.output.parse(reply.data);
}

/** Resolves a scanned code. The only call in the product that runs before an organisation. */
export function resolveScan(token: string, anonymousId?: string) {
  return publicCall({
    resource: "qrSession",
    operation: "create",
    input: { token, ...(anonymousId === undefined ? {} : { anonymousId }) },
  });
}

/* ── The system half ─────────────────────────────────────────────────────── */

/**
 * The other kind of call with no user behind it: one the gateway makes on the platform's own
 * behalf, for an organisation it has already proved. Separated from `publicCall` because the
 * two differ in exactly the way that matters - this one carries a real organisation and an
 * elevated role, so it gets its own, shorter allow-list.
 */
const SYSTEM_OPERATIONS = new Set(["payment:manage"]);

/**
 * Deliberately NOT rate limited, unlike `publicCall`. Written down because the asymmetry
 * looks like an oversight and is not.
 *
 * `publicCall` needs a limit because its input is a SECRET being guessed: a QR token is
 * unguessable only for as long as the number of guesses is bounded, and there is nothing
 * else in front of it. This one is reached from exactly one caller,
 * `app/api/webhooks/payments/route.ts`, and only after `verifySignature` has proved an
 * HMAC-SHA256 over the raw body in constant time against a secret that is not in the
 * request. Nothing about that improves with repetition - a caller either holds the webhook
 * secret or does not, and volume never converts one into the other. A limiter here would
 * only ever throttle a caller who already passed, which in practice means the payment
 * provider itself.
 *
 * And throttling the provider is the harm, not the protection. There is no safe key: per
 * organisation refuses a busy restaurant's own settlements exactly on the Friday night when
 * the most money is moving; platform-wide lets one busy tenant starve every other tenant's
 * payments. A refused webhook is not a refused read - the money already moved, and the route
 * answers 500 so the provider retries, so a limit that stays tripped turns retries into
 * permanently unsettled orders.
 *
 * The residual risk is an unauthenticated flood spending CPU on signature verification. That
 * is a real concern and it is not this function's: it belongs in front of the route, at the
 * edge or in the route itself, where the bytes arrive - by the time control is here the
 * signature has already been checked, so a limit at this point protects nothing that was not
 * already protected.
 */

async function systemCall<K extends ResourceKey, O extends OperationOf<K>>(args: {
  organizationId: string;
  resource: K;
  operation: O;
  input: InputOf<K, O>;
}): Promise<OutputOf<K, O>> {
  const permission = toPermission(args.resource, args.operation);
  if (!SYSTEM_OPERATIONS.has(permission)) {
    throw new ServiceError("PERMISSION_DENIED", `${permission} is not a system operation.`);
  }

  const rule = ruleFor(args.resource, args.operation);
  const issuedAt = Date.now();
  const meta: RequestMeta = {
    requestId: crypto.randomUUID(),
    orgId: args.organizationId,
    userId: "system:webhook",
    role: "owner",
    /** Empty because `owner` is not station-gated, not because stations are optional. */
    stations: [],
    permissions: [permission],
    plan: DEFAULT_PLAN,
    resource: args.resource,
    operation: args.operation,
    issuedAt,
    deadlineAt: issuedAt + rule.timeoutMs,
  };

  const contract = contractFor(args.resource, args.operation);
  const payload: InputOf<K, O> = contract.input.parse(args.input);
  const envelope: Envelope<InputOf<K, O>> = {
    meta,
    payload,
    signature: signRequest(meta, payload, env.envelopeSecret()),
  };

  const reply = await rpcRequest({
    subject: rpcSubject(args.resource, args.operation),
    envelope,
    timeoutMs: rule.timeoutMs,
  });

  if (reply.requestId !== meta.requestId) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply does not belong to this request.");
  }
  const answered = reply.ok ? reply.data : reply.error;
  if (
    !verifyReply(
      {
        requestId: meta.requestId,
        resource: args.resource,
        operation: args.operation,
        ok: reply.ok,
      },
      answered,
      reply.signature,
      env.envelopeSecret(),
    )
  ) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply signature is not valid.");
  }
  if (!reply.ok) throw new ServiceError("INTERNAL", reply.error.message);

  return contract.output.parse(reply.data);
}

/**
 * Settles a payment from a webhook whose signature has already been verified. The
 * organisation comes from the provider notes we put there ourselves, and the orders service
 * still checks the amount against the order before it moves anything.
 */
export function reconcilePayment(args: {
  organizationId: string;
  providerPaymentId: string;
  providerOrderId: string;
  outcome: "captured" | "failed";
  amountPaise: number;
  method?: "upi" | "card" | "netbanking" | "wallet" | "cash" | undefined;
}) {
  return systemCall({
    organizationId: args.organizationId,
    resource: "payment",
    operation: "manage",
    input: {
      action: "reconcile",
      providerPaymentId: args.providerPaymentId,
      providerOrderId: args.providerOrderId,
      outcome: args.outcome,
      amountPaise: args.amountPaise,
      ...(args.method === undefined ? {} : { method: args.method }),
    },
  });
}
