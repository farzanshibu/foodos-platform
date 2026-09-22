/**
 * SOT: gateway, gateway-block, the-block, dispatch, authorisation, org-scoping, plan-gate,
 *      station-gate-gateway, unit-gate
 * WHAT   The half of the block that runs at the edge. Everything a request must survive
 *        before it is allowed onto the bus.
 * WHY    Authorisation belongs where identity lives - the gateway holds the session cookie,
 *        services never see it. The gateway decides, signs the decision into the envelope,
 *        and services enforce what was decided rather than deciding again.
 * HOW    Steps are numbered. A gateway route is one line because all of this is here.
 *        Step 5b parses, because step 6 gates on how many units the body would create.
 *        Step 7 signs the payload as well as the meta, and step 9 refuses a reply that is
 *        not signed by the same secret or does not name this request.
 * WHERE  apps/web/src/gateway/procedures.ts
 */
import "server-only";

import {
  contractFor,
  type Envelope,
  ERROR_HTTP_MAP,
  type ErrorCode,
  type InputOf,
  type OutputOf,
  type ReplyEnvelope,
  type RequestMeta,
  ServiceError,
  signRequest,
  verifyReply,
} from "@foodos/contracts";
import {
  can,
  checkResourceAccess,
  commandSubject,
  type Entitlements,
  type Grant,
  type OperationOf,
  type OrgRole,
  permissionsFor,
  RESOURCES,
  type ResourceKey,
  refusalMessage,
  roleAtLeast,
  rpcSubject,
  ruleFor,
  type Station,
  stationAllows,
  unitsOf,
} from "@foodos/registry";
import { publishCommand, rpcRequest } from "@foodos/transport";

import { refusedRole } from "./escalation";

export type GatewayIdentity = {
  readonly userId: string;
  readonly orgId: string;
  readonly role: OrgRole;
  /**
   * The posts this seat is rostered to, read from the membership row beside the role and
   * never from anything the caller sent. Empty is the ordinary state for everybody who is
   * not station-gated - an owner, an admin, a guest at a table - and for a member who has
   * not been rostered yet, which is why it refuses rather than waves through.
   */
  readonly stations: readonly Station[];
};

export type RateVerdict = { readonly ok: boolean; readonly retryAfterSeconds: number };

export type GatewayDeps = {
  /** Resolves the session. Swapping auth providers means changing only this function. */
  identify: (headers: Headers) => Promise<GatewayIdentity | null>;
  /** Plan and usage for the org. Cached at the edge; see apps/web/src/gateway/deps.ts. */
  entitlements: (orgId: string) => Promise<Entitlements>;
  rateLimit: (args: { key: string; max: number; windowSeconds: number }) => Promise<RateVerdict>;
  readonly secret: string;
};

export type GatewayFailure =
  | {
      readonly code: Exclude<
        ErrorCode,
        "UPGRADE_REQUIRED" | "RATE_LIMITED" | "PERMISSION_DENIED" | "DOWNGRADE_BLOCKED"
      >;
      readonly message: string;
    }
  | { readonly code: "PERMISSION_DENIED"; readonly message: string; readonly permission: string }
  | { readonly code: "RATE_LIMITED"; readonly message: string; readonly retryAfterSeconds: number }
  | { readonly code: "UPGRADE_REQUIRED"; readonly message: string; readonly decision: unknown }
  | {
      readonly code: "DOWNGRADE_BLOCKED";
      readonly message: string;
      readonly blockers: readonly string[];
    };

/**
 * `failure` is declared and assigned rather than written as a constructor parameter
 * property: `erasableSyntaxOnly` is on, and a parameter property is TypeScript that has to
 * be emitted rather than erased.
 */
export class GatewayError extends Error {
  readonly failure: GatewayFailure;

  constructor(failure: GatewayFailure) {
    super(failure.message);
    this.name = "GatewayError";
    this.failure = failure;
  }

  get trpcCode(): string {
    return ERROR_HTTP_MAP[this.failure.code];
  }
}

/**
 * Explicitly annotated so TypeScript narrows control flow after each call. That is what
 * removes every non-null assertion below - the compiler knows the request stopped here.
 */
const fail: (failure: GatewayFailure) => never = (failure) => {
  throw new GatewayError(failure);
};

export type DispatchArgs<K extends ResourceKey, O extends OperationOf<K>> = {
  readonly deps: GatewayDeps;
  readonly headers: Headers;
  readonly requestId: string;
  readonly ip: string;
  readonly resource: K;
  readonly operation: O;
  readonly input: unknown;
};

/**
 * The return type is the contract's output and nothing else. A command's contract already
 * declares the acceptance shape - member.create's output is `{accepted: true, requestId}` -
 * so widening every caller to a union just to describe the command branch made `.items`
 * unreachable on a query result three components deep in the UI.
 */
export async function dispatch<K extends ResourceKey, O extends OperationOf<K>>(
  args: DispatchArgs<K, O>,
): Promise<OutputOf<K, O>> {
  const { deps, resource, operation } = args;
  const definition = RESOURCES[resource];
  const rule = ruleFor(resource, operation);
  const permission = `${resource}:${String(operation)}`;

  // 1. Identity. The only place in the platform that reads a cookie.
  const identity = await deps.identify(args.headers);
  if (identity === null) fail({ code: "UNAUTHORIZED", message: "Sign in to continue." });

  // 2. Org scoping. From the session, never from input, and signed into the envelope so
  //    nothing downstream has to trust the caller for it.
  if (identity.orgId.length === 0) {
    fail({ code: "NO_ACTIVE_ORG", message: "Select an organisation to continue." });
  }

  // 3. Role gate.
  if (!roleAtLeast(identity.role, rule.minRole)) {
    fail({
      code: "PERMISSION_DENIED",
      message: `This action needs the ${rule.minRole} role.`,
      permission,
    });
  }

  // 3b. Station gate. The lateral half of the same question gate 3 asked: rank says how much
  //     authority, station says which post. Only the lowest seat role is asked - a manager
  //     covers any station - and an operation that declares none passes untouched, which is
  //     why every endpoint written before stations existed behaves exactly as it did.
  const grant: Grant = { role: identity.role, stations: identity.stations };
  const required = rule.stations ?? [];
  if (!stationAllows(grant, required)) {
    fail({
      code: "PERMISSION_DENIED",
      message: `This action belongs to the ${required.join(" or ")} station.`,
      permission,
    });
  }

  // 4. Permission gate, derived from the registry rather than written by hand. The list is
  //    computed from the whole grant, so what gets signed into the envelope below is what
  //    this caller actually holds - not what their rank could hold on some other shift.
  const permissions = permissionsFor(grant);
  if (!can(permissions, resource, operation)) {
    fail({
      code: "PERMISSION_DENIED",
      message: "You do not have permission to do that.",
      permission,
    });
  }

  // 4b. Privilege escalation. A role named in the body is a grant, and nobody may grant a
  //     role above their own. Derived from `assignableRoles`, so a role added to the
  //     registry is covered the moment it is declared - never compared by hand. Sits with
  //     the other authorisation gates, ahead of the rate limiter and the plan check.
  const refused = refusedRole(args.input, identity.role);
  if (refused !== null) {
    fail({
      code: "PERMISSION_DENIED",
      message: `Your ${identity.role} role cannot grant the ${refused} role.`,
      permission,
    });
  }

  // 5. Rate limit. Keyed per org so one tenant cannot starve another - except for a guest,
  //    who is keyed on their own QR session instead. A restaurant's guests share one org id,
  //    so an org-wide key would let a single phone at one table exhaust the allowance for
  //    every other table in the building.
  const principal =
    identity.role === "guest" ? `guest:${identity.userId}` : `org:${identity.orgId}`;
  const verdict = await deps.rateLimit({
    key: `${principal}:${resource}:${String(operation)}`,
    max: definition.rateLimit.max,
    windowSeconds: definition.rateLimit.windowSeconds,
  });
  if (!verdict.ok) {
    fail({
      code: "RATE_LIMITED",
      message: "Too many requests. Try again shortly.",
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }

  // 5b. Parse the input, which used to happen inside step 7 and now happens here.
  //
  //     It has to be ahead of the plan gate, because that gate now asks how many units this
  //     one call would create, and a count read off an unparsed body is a number the caller
  //     chose: `rows: "ABC"` is not a grid, and `columns: 1e400` is not a quantity. Only
  //     the contract can say what arrived.
  //
  //     What the old position was protecting is still protected. Every gate that decides WHO
  //     the caller is - identity, org, role, station, permission, escalation - and the rate
  //     limiter still run first, so an anonymous, unauthorised or flooding caller cannot make
  //     the gateway parse anything. All that moved ahead of the parse is the entitlements
  //     lookup, which is a network call to the billing provider: doing it after the parse
  //     means a malformed body no longer costs a billing round trip. And for every request
  //     that arrives through a tRPC procedure the input has ALREADY been parsed by this same
  //     contract schema before `dispatch` is entered - see gateway/procedures.ts - so for the
  //     whole product surface this is a re-parse whose position nothing can observe.
  const contract = contractFor(resource, operation);
  const payload: InputOf<K, O> = contract.input.parse(args.input);

  // 6. Entitlements, then the plan gate - the same pure function the browser uses, asked
  //    about the number of units this call would create rather than about one. It used to
  //    ask "may you create one more?" and then let a body through that created four hundred;
  //    the count is the registry's, from `units` on the operation, so this line does not know
  //    and cannot know what a grid is.
  const units = unitsOf(resource, operation, payload);
  const entitlements = await deps.entitlements(identity.orgId);
  if (rule.consumes) {
    const decision = checkResourceAccess({ resource, entitlements, requested: units });
    if (!decision.allowed) {
      fail({ code: "UPGRADE_REQUIRED", message: refusalMessage(resource, decision), decision });
    }
  }

  // 7. Build and sign. From here the decision travels with the request.
  const issuedAt = Date.now();
  const meta: RequestMeta = {
    requestId: args.requestId,
    orgId: identity.orgId,
    userId: identity.userId,
    role: identity.role,
    /** Signed, like the role. The service re-asks the station question against these. */
    stations: [...identity.stations],
    permissions: [...permissions],
    plan: entitlements.plan,
    resource,
    operation,
    /** What the plan gate above authorised. The service re-counts the body against it. */
    units,
    issuedAt,
    deadlineAt: issuedAt + rule.timeoutMs,
  };
  const envelope: Envelope<InputOf<K, O>> = {
    meta,
    payload,
    /** Over the payload as well as the meta, so the body cannot be swapped in flight. */
    signature: signRequest(meta, payload, deps.secret),
  };

  // 8. Dispatch. Commands are accepted durably; rpc waits for the service.
  if (rule.transport === "command") {
    await publishCommand({ subject: commandSubject(resource, operation), envelope });
    // Parsed through the same contract the service answers with, so the acceptance shape is
    // derived rather than asserted. A command whose contract declares something else fails
    // here, loudly, instead of handing the browser a shape it cannot use.
    return contract.output.parse({ accepted: true, requestId: meta.requestId });
  }

  let reply: ReplyEnvelope<unknown>;
  try {
    reply = await rpcRequest({
      subject: rpcSubject(resource, operation),
      envelope,
      timeoutMs: rule.timeoutMs,
    });
  } catch (error) {
    // A coded refusal from the transport - an unsigned or misaddressed reply - keeps its
    // code. Anything else is a timeout: say so plainly rather than leaking a transport error.
    if (error instanceof ServiceError) {
      return fail(toFailure({ code: error.code, message: error.message, data: error.data }));
    }
    return fail({
      code: "SERVICE_UNAVAILABLE",
      message: `The ${definition.owner} service did not respond. Try again shortly.`,
    });
  }

  // 9. Prove who answered. A queue group is not exclusivity: anything subscribed to the same
  //    subject can win the race, and a forged billing reply would sit in the entitlements
  //    cache for thirty seconds or hand an org owner an attacker's checkout URL. The
  //    request id is checked too, so a reply captured from one request cannot answer another.
  if (reply.requestId !== meta.requestId) {
    return fail({
      code: "UNTRUSTED_ENVELOPE",
      message: "The reply does not belong to this request.",
    });
  }
  const answered = reply.ok ? reply.data : reply.error;
  if (
    !verifyReply(
      /** Ours, not the reply's: the operation we asked for is the operation we accept. */
      {
        requestId: meta.requestId,
        resource: meta.resource,
        operation: meta.operation,
        ok: reply.ok,
      },
      answered,
      reply.signature,
      deps.secret,
    )
  ) {
    return fail({ code: "UNTRUSTED_ENVELOPE", message: "The reply signature is not valid." });
  }

  if (!reply.ok) {
    return fail(toFailure(reply.error));
  }

  // 10. Validate what came back. A service returning the wrong shape is a bug here, not a
  //     runtime surprise three components deep in the UI.
  return contract.output.parse(reply.data);
}

function toFailure(error: { code: string; message: string; data?: unknown }): GatewayFailure {
  switch (error.code) {
    case "UPGRADE_REQUIRED":
      return { code: "UPGRADE_REQUIRED", message: error.message, decision: error.data };
    case "DOWNGRADE_BLOCKED": {
      // The service names what must come down; the data is its own refusal's payload.
      const blockers =
        error.data !== null &&
        typeof error.data === "object" &&
        "blockers" in error.data &&
        Array.isArray(error.data.blockers)
          ? error.data.blockers.filter((row): row is string => typeof row === "string")
          : [];
      return { code: "DOWNGRADE_BLOCKED", message: error.message, blockers };
    }
    case "PERMISSION_DENIED":
      return { code: "PERMISSION_DENIED", message: error.message, permission: "" };
    case "NOT_FOUND":
    case "CONFLICT":
    case "INVALID_INPUT":
    case "DEADLINE_EXCEEDED":
    case "UNTRUSTED_ENVELOPE":
    case "UNAUTHORIZED":
    case "NO_ACTIVE_ORG":
    case "SERVICE_UNAVAILABLE":
      return { code: error.code, message: error.message };
    default:
      return { code: "INTERNAL", message: error.message };
  }
}
