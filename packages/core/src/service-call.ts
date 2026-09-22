/**
 * SOT: service-call, service-to-service, internal-rpc, downstream-call
 * WHAT   One service asking another for something, over the bus, with the block intact.
 * WHY    Services own their tables and may not import or query each other, so an order that
 *        needs a price has to ask the catalogue rather than read the menu. Without a
 *        primitive for that, the alternative is six lines of signRequest inside a handler -
 *        an envelope naming any org and any role, which is precisely what the architecture
 *        check exists to stop.
 * HOW    Every field that could widen the call is taken from the inbound context instead of
 *        from the caller: the org id, the user and the role are the ones the gateway already
 *        signed, and the deadline can only shrink. The permission list is the single
 *        operation being called, and the call is refused before it is signed unless the
 *        inbound role already holds it. A downstream call therefore cannot reach further
 *        than the request that caused it, which is what makes this safe to import from a
 *        handler rather than gateway-only.
 * WHERE  services/orders (pricing a cart), packages/core/src/service.ts
 */
import "server-only";

import {
  contractFor,
  type Envelope,
  type InputOf,
  isErrorCode,
  type OutputOf,
  type ReplyEnvelope,
  type RequestMeta,
  ServiceError,
  signRequest,
  verifyReply,
} from "@foodos/contracts";
import {
  can,
  type OperationOf,
  permissionsFor,
  type ResourceKey,
  rpcSubject,
  ruleFor,
  toPermission,
} from "@foodos/registry";
import { rpcRequest } from "@foodos/transport";

import type { ServiceContext } from "./service";

/** Left for the caller to finish its own reply in. Never let a downstream call eat it all. */
const REPLY_BUDGET_MS = 250;

export type ServiceCallArgs<K extends ResourceKey, O extends OperationOf<K>> = {
  /** The inbound request's context. Everything authoritative is read from here. */
  readonly ctx: ServiceContext;
  readonly resource: K;
  readonly operation: O;
  readonly input: InputOf<K, O>;
  readonly secret: string;
};

export async function serviceCall<K extends ResourceKey, O extends OperationOf<K>>(
  args: ServiceCallArgs<K, O>,
): Promise<OutputOf<K, O>> {
  const { ctx, resource, operation } = args;
  const rule = ruleFor(resource, operation);

  if (rule.transport !== "rpc") {
    throw new ServiceError(
      "INTERNAL",
      `${resource}.${String(operation)} is a command; a downstream call cannot wait for one.`,
    );
  }

  /**
   * The escalation gate. A handler serving a guest cannot turn around and call an
   * admin-only operation, because the permission it would have to name is one the inbound
   * role does not hold. This is checked before anything is signed, so an over-reaching call
   * never becomes bytes on the bus.
   */
  const stations = ctx.stations ?? [];
  if (!can([...permissionsFor({ role: ctx.role, stations })], resource, operation)) {
    throw new ServiceError(
      "PERMISSION_DENIED",
      `A ${ctx.role} request cannot reach ${resource}.${String(operation)}.`,
    );
  }

  /** Shrink only: the downstream call must finish inside the deadline we were given. */
  const issuedAt = Date.now();
  const budget = Math.min(rule.timeoutMs, ctx.deadlineAt - issuedAt - REPLY_BUDGET_MS);
  if (budget <= 0) {
    throw new ServiceError("DEADLINE_EXCEEDED", "No time left to call downstream.");
  }

  const meta: RequestMeta = {
    requestId: crypto.randomUUID(),
    orgId: ctx.orgId,
    userId: ctx.userId,
    role: ctx.role,
    /** The inbound roster, never a wider one. A downstream call cannot change post. */
    stations: [...stations],
    /** Exactly one. A downstream envelope is not a general-purpose credential. */
    permissions: [toPermission(resource, operation)],
    plan: ctx.plan,
    resource,
    operation,
    issuedAt,
    deadlineAt: issuedAt + budget,
  };

  const contract = contractFor(resource, operation);
  const payload: InputOf<K, O> = contract.input.parse(args.input);
  const envelope: Envelope<InputOf<K, O>> = {
    meta,
    payload,
    signature: signRequest(meta, payload, args.secret),
  };

  let reply: ReplyEnvelope<unknown>;
  try {
    reply = await rpcRequest({
      subject: rpcSubject(resource, operation),
      envelope,
      timeoutMs: budget,
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      `Nothing answered for ${resource}.${String(operation)}.`,
    );
  }

  /** The same two proofs the gateway demands of a reply: whose answer, and is it ours. */
  if (reply.requestId !== meta.requestId) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply does not belong to this request.");
  }
  const answered = reply.ok ? reply.data : reply.error;
  if (
    !verifyReply(
      { requestId: meta.requestId, resource, operation, ok: reply.ok },
      answered,
      reply.signature,
      args.secret,
    )
  ) {
    throw new ServiceError("UNTRUSTED_ENVELOPE", "The reply signature is not valid.");
  }
  if (!reply.ok) {
    /**
     * The reply's code is a plain string until it is checked. Passing it straight through
     * would let a downstream service name a code this one does not know, and the caller
     * would map it to nothing. An unrecognised code becomes INTERNAL, which is what it is.
     */
    const code = isErrorCode(reply.error.code) ? reply.error.code : "INTERNAL";
    throw new ServiceError(code, reply.error.message, reply.error.data);
  }

  return contract.output.parse(reply.data);
}
