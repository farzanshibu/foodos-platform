/**
 * SOT: service-guard, define-service, define-consumer, handler-for, service-block,
 *      envelope-verification, subject-binding, idempotency, station-gate-service,
 *      unit-reassertion, units-created
 * WHAT   The half of the block that runs inside a service.
 * WHY    A service must never trust the wire. Verification, subject binding, freshness, org
 *        scoping, input parsing, output validation, event emission and error mapping are
 *        wired here, so a handler is a pure function of (ctx, input) and cannot skip a check.
 * HOW    Handlers are a flat list built with `handlerFor`, which infers input and output
 *        from the contract. Subjects are never built from a template literal: each handler
 *        is matched against the registry's own `ROUTES`, which is also what proves at boot
 *        that this service is allowed to answer for the resource at all.
 * WHERE  services/<name>/src/*.handlers.ts, services/<name>/src/index.ts
 */
import "server-only";

import {
  checkFreshness,
  contractFor,
  type EventPayload,
  envelope as envelopeSchema,
  eventPayload as eventPayloadSchema,
  type InputOf,
  type OutputOf,
  type ReplyBinding,
  type ReplyEnvelope,
  type RequestMeta,
  ServiceError,
  signEvent,
  signReply,
  type Transport,
  verifyEvent,
  verifyRequest,
} from "@foodos/contracts";
import {
  DEFAULT_UNITS,
  noticeSubject,
  type Operation,
  type OperationOf,
  type ResourceKey,
  ROUTES,
  type ServiceName,
  stationAllows,
  stationsFor,
  unitsOf,
} from "@foodos/registry";
import { publishEvent, publishNotice } from "@foodos/transport";

import { refusedRole } from "./escalation";

/** What a handler receives. There is no way to widen it beyond one organisation. */
export type ServiceContext = {
  readonly requestId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly role: RequestMeta["role"];
  /**
   * The posts the caller is rostered to, from the signed envelope.
   *
   * Required, so that every context states its roster rather than defaulting into one. It
   * was briefly optional only because the insights projector builds a context from an event
   * and could not be edited at the time; it now says `stations: []` explicitly, which is the
   * honest reading - an event carries no roster, and that context runs as `owner`, which is
   * never station-gated. Required matters because `serviceCall` propagates whatever is here
   * into the downstream envelope: an omitted set would be a silent narrowing that reads as
   * an oversight, and a future context running below `owner` would be refused with no clue
   * why. An empty set is still the fail-closed value - it just has to be typed out.
   */
  readonly stations: RequestMeta["stations"];
  readonly plan: RequestMeta["plan"];
  readonly deadlineAt: number;
};

/**
 * A handler after registration. `unknown` here is honest: `execute` sits at the wire
 * boundary and narrows by parsing in the same function, which is the only place `unknown`
 * is allowed in this codebase.
 */
export type HandlerEntry = {
  readonly resource: ResourceKey;
  readonly operation: Operation;
  execute(ctx: ServiceContext, raw: unknown): Promise<unknown>;
};

/** Input and output are inferred from the contract - never annotated by the caller. */
export function handlerFor<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
  run: (args: { ctx: ServiceContext; input: InputOf<K, O> }) => Promise<OutputOf<K, O>>,
): HandlerEntry {
  const contract = contractFor(resource, operation);
  return {
    resource,
    operation,
    async execute(ctx, raw) {
      const parsed = contract.input.safeParse(raw);
      if (!parsed.success) {
        throw new ServiceError(
          "INVALID_INPUT",
          "Input does not match the contract.",
          parsed.error.flatten(),
        );
      }
      const output = await run({ ctx, input: parsed.data });
      return contract.output.parse(output);
    },
  };
}

export type ServiceRoute = {
  readonly resource: ResourceKey;
  readonly operation: Operation;
  readonly subject: string;
  readonly transport: Transport;
  /** The evt subject this operation emits on, or null when the registry does not audit it. */
  readonly event: string | null;
  /**
   * The notice pattern this operation may nudge on, or null when the resource declares no
   * `notify`. Carried here for the same reason `event` is: the block publishes it, never a
   * handler, so the decision stays in the registry.
   */
  readonly notify: string | null;
};

export type ServiceRuntime = {
  readonly service: ServiceName;
  readonly routes: readonly ServiceRoute[];
  /**
   * `subject` is the subject the message actually arrived on. Without it a valid rpc
   * envelope published onto the CMD stream becomes a durable command, and the intent the
   * gateway signed is not the intent that runs.
   */
  handle(rawEnvelope: unknown, subject: string): Promise<ReplyEnvelope<unknown>>;
  /** Pre-signed refusal for bytes the transport could not turn into a reply at all. */
  readonly unreadable: ReplyEnvelope<never>;
};

type Binding = { readonly route: ServiceRoute; readonly entry: HandlerEntry };

/** Everything a reply is bound to except its outcome, which `reject` and the success path
 * each know for themselves. `RequestMeta` satisfies it structurally, so a refusal that has
 * a verified meta simply hands it over. */
type ReplyRoute = Omit<ReplyBinding, "ok">;

/**
 * The two refusals that happen before any meta can be trusted: bytes that are not an envelope
 * at all, and the pre-signed `unreadable`. Neither can name an operation, and neither needs
 * to - both verifiers compare the request id BEFORE they check the signature, and "unknown"
 * matches no request, so these are refused for answering the wrong request and never reach
 * the reply MAC at all.
 */
const UNROUTED: ReplyRoute = {
  requestId: "unknown",
  resource: "unknown",
  operation: "unknown",
};

/**
 * The id of whatever the handler just returned, when it returned one thing with an id. Read
 * off the output rather than the input because an id is often minted inside the handler, and
 * a create event that named nothing was the reason read models could not be built at all.
 * Anything else - a page, a count, a command acknowledgement - names no single row and is
 * honestly null.
 */
function entityIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const fields: ReadonlyMap<string, unknown> = new Map(Object.entries(data));
  const id = fields.get("id");
  return typeof id === "string" ? id : null;
}

/**
 * How many units of the resource the handler actually created, read off the output for
 * exactly the reason `entityIdOf` is: only the handler knows what it wrote.
 *
 * The request is not evidence. A grid asking for four hundred seats against a screen that
 * already has three hundred and eighty of them creates twenty, and metering the request would
 * bill a customer for work the service deliberately skipped. So the reader answers the same
 * question `entityIdOf` does, in the plural: an output that names one row is one unit, and an
 * output that lists rows is as many units as it names.
 *
 * Floored at DEFAULT_UNITS, which is what makes this safe to switch on for every audited
 * operation at once: everything that returns a page, a count or an acknowledgement names no
 * row, and answering zero for those would silently stop metering operations that meter one
 * today. It can only ever count up from the behaviour it replaces.
 */
function unitsCreated(data: unknown): number {
  if (entityIdOf(data) !== null) return DEFAULT_UNITS;
  if (typeof data !== "object" || data === null) return DEFAULT_UNITS;
  let named = 0;
  for (const value of new Map(Object.entries(data)).values()) {
    if (!Array.isArray(value)) continue;
    const entries: readonly unknown[] = value;
    named += entries.filter((entry) => entityIdOf(entry) !== null).length;
  }
  return Math.max(DEFAULT_UNITS, named);
}

export function defineService(
  service: ServiceName,
  handlers: readonly HandlerEntry[],
  options: { secret: string },
): ServiceRuntime {
  /**
   * Boot-time wiring, from the registry's own route table rather than from a template
   * literal built here. Two mistakes fail on `make dev` instead of at 3am: an operation no
   * resource declares, and a service answering for a resource the registry gives to
   * somebody else.
   */
  const bindings: readonly Binding[] = handlers.map((entry) => {
    const route = ROUTES.find(
      (candidate) =>
        candidate.resource === entry.resource && candidate.operation === entry.operation,
    );
    if (route === undefined) {
      throw new Error(
        `Service '${service}' handles '${entry.resource}.${entry.operation}', which the registry does not declare. There is no subject for it.`,
      );
    }
    if (route.owner !== service) {
      throw new Error(
        `Service '${service}' handles '${entry.resource}', which the registry says '${route.owner}' owns.`,
      );
    }
    return {
      entry,
      route: {
        resource: route.resource,
        operation: route.operation,
        subject: route.subject,
        transport: route.transport,
        event: route.event,
        notify: route.notify,
      },
    };
  });

  /**
   * The reverse of the two checks above, and the one that was missing.
   *
   * Those prove no handler answers for something it should not. This proves nothing the
   * registry assigned goes unanswered - and without it a missing handler is not an error at
   * all, because `routes` below is built FROM the handler list, so the subject is simply
   * never subscribed. The gateway then publishes to `rpc.project.update`, nobody answers,
   * the request hangs to its timeout, and the caller is told "the projects service did not
   * respond" while that service is up, healthy, and logging the subjects it does serve
   * three lines above. The bus ACLs even grant the subscription, because they are generated
   * from the same registry.
   */
  const unimplemented = ROUTES.filter(
    (route) =>
      route.owner === service &&
      !bindings.some(
        (binding) =>
          binding.route.resource === route.resource && binding.route.operation === route.operation,
      ),
  );
  if (unimplemented.length > 0) {
    throw new Error(
      `Service '${service}' does not implement ${unimplemented
        .map((route) => `${route.resource}.${route.operation}`)
        .join(", ")}, which the registry assigns to it. The gateway will publish to ${unimplemented
        .map((route) => route.subject)
        .join(", ")} and nothing will answer.`,
    );
  }

  const routes: readonly ServiceRoute[] = bindings.map((binding) => binding.route);

  function reject(
    route: ReplyRoute,
    code: string,
    message: string,
    data?: unknown,
  ): ReplyEnvelope<never> {
    const error = data === undefined ? { code, message } : { code, message, data };
    return {
      ok: false,
      requestId: route.requestId,
      signature: signReply({ ...route, ok: false }, error, options.secret),
      error,
    };
  }

  /**
   * Gates 5, 5b and 5c: everything the envelope claims about its caller, re-checked here
   * rather than taken on the gateway's word. Kept together and out of `handle` so the
   * block still reads as a flat list of refusals, and so none can be reordered away
   * from the others.
   */
  function reassertAuthority(meta: RequestMeta, payload: unknown): ReplyEnvelope<never> | null {
    // 5. Re-assert the permission the gateway claims to have checked. Cheap, and it means
    //    a gateway bug cannot become a data breach.
    if (!meta.permissions.includes(`${meta.resource}:${meta.operation}`)) {
      return reject(meta, "PERMISSION_DENIED", "Envelope does not carry this permission.");
    }

    // 5c. Re-assert the station, against the registry's own declaration and the roster the
    //     envelope carries - not against `meta.permissions`, which is the gateway's answer
    //     to this same question. Asking the source again is the whole reason the block is
    //     split: a permission list is a claim, and one gateway bug that widened it would
    //     otherwise put the pass on the cashier's screen with a valid signature over it.
    const required = stationsFor(meta.resource, meta.operation);
    if (!stationAllows({ role: meta.role, stations: meta.stations }, required)) {
      return reject(
        meta,
        "PERMISSION_DENIED",
        `${meta.resource}.${meta.operation} belongs to the ${required.join(" or ")} station.`,
      );
    }

    // 5b. Privilege escalation, the mirror of gateway 4b. `meta.role` is the caller's own
    //     role, signed; the body beside it is whatever arrived. The gateway deciding this
    //     correctly is not enough - a gate that only ever runs at the edge means one
    //     gateway bug is an escalation, which is the reason the block is split at all.
    const refused = refusedRole(payload, meta.role);
    if (refused !== null) {
      return reject(
        meta,
        "PERMISSION_DENIED",
        `Your ${meta.role} role cannot grant the ${refused} role.`,
      );
    }

    // 5d. Re-count the body against the count the envelope was authorised for.
    //
    //     The plan gate itself cannot be re-run here and should not be. Its other input is
    //     usage, which lives in the billing provider: a service reaching for it would be a
    //     cross-service call the architecture forbids and a billing round trip inside every
    //     mutation, and answering from the service's OWN row count instead would be a second
    //     number for the one question the gateway and the browser already answer together -
    //     it counts rows this service soft-deleted, and it is not what the meter bills.
    //
    //     What is re-assertable without asking anybody is the arithmetic, and that is where
    //     the bug was: the gate asked about one unit and a body arrived that made four
    //     hundred. So the same registry reader is run again, here, over the body that
    //     actually arrived, and a payload that asks for more than the meta authorises is
    //     refused. The signature covers both halves, so this only ever fires on a gateway
    //     that miscounted - which is precisely the reason the block is split in two, and the
    //     same reason gate 5 re-asks about a permission the envelope already carries.
    const authorised = meta.units ?? DEFAULT_UNITS;
    const asked = unitsOf(meta.resource, meta.operation, payload);
    if (asked > authorised) {
      return reject(
        meta,
        "UNTRUSTED_ENVELOPE",
        `${meta.resource}.${meta.operation} was authorised for ${authorised} but its payload asks for ${asked}.`,
      );
    }

    return null;
  }

  const unreadable = reject(
    UNROUTED,
    "UNTRUSTED_ENVELOPE",
    "The service could not read this message.",
  );

  async function handle(rawEnvelope: unknown, subject: string): Promise<ReplyEnvelope<unknown>> {
    const parsed = envelopeSchema.safeParse(rawEnvelope);
    if (!parsed.success) {
      return reject(UNROUTED, "UNTRUSTED_ENVELOPE", "Malformed envelope.");
    }
    const { meta, payload, signature } = parsed.data;

    // 1. Signature, over the meta and the body together. Over the meta alone, orgId is
    //    authorised but the payload beside it is whatever the last publisher swapped in.
    if (!verifyRequest(meta, payload, signature, options.secret)) {
      return reject(meta, "UNTRUSTED_ENVELOPE", "Envelope signature is not valid.");
    }

    // 2. Route. meta.resource and meta.operation are already narrowed by the schema.
    const binding = bindings.find(
      (candidate) =>
        candidate.route.resource === meta.resource && candidate.route.operation === meta.operation,
    );
    if (binding === undefined) {
      return reject(meta, "NOT_FOUND", `No handler for ${meta.resource}.${meta.operation}.`);
    }

    // 3. Subject. The signed intent names one transport; this is where it arrived. A valid
    //    rpc envelope replayed onto the CMD stream would otherwise become durable.
    if (subject !== binding.route.subject) {
      return reject(
        meta,
        "UNTRUSTED_ENVELOPE",
        `Envelope for ${binding.route.subject} arrived on ${subject}.`,
      );
    }

    // 4. Freshness. The deadline applies to rpc only; a command is durable by design.
    const freshness = checkFreshness(meta, binding.route.transport);
    if (!freshness.fresh) {
      return reject(meta, freshness.code, freshness.message);
    }

    const refusal = reassertAuthority(meta, payload);
    if (refusal !== null) return refusal;

    const ctx: ServiceContext = {
      requestId: meta.requestId,
      orgId: meta.orgId,
      userId: meta.userId,
      role: meta.role,
      stations: meta.stations,
      plan: meta.plan,
      deadlineAt: meta.deadlineAt,
    };

    try {
      const data = await binding.entry.execute(ctx, payload);

      // 6. Emit the fact. Audit and metering are consumers, not code in the request path,
      //    so a slow audit write can never slow a customer's request. The event is signed
      //    over its own body: the request signature covers the request's payload, and
      //    reusing it here would hand every consumer a signature that verifies nothing.
      if (binding.route.event !== null) {
        const event: EventPayload = {
          outcome: "success",
          entityId: entityIdOf(data),
          /** What the handler created, not what the request asked for. The meter bills this. */
          units: unitsCreated(data),
        };
        await publishEvent({
          subject: binding.route.event,
          envelope: { meta, payload: event, signature: signEvent(meta, event, options.secret) },
        });
      }

      // 6b. Nudge whoever is watching this row. Declared in the registry with `notify`, so a
      //     handler never publishes one by hand - same reason audit is a consumer and not a
      //     line of feature code. Read-only operations move nothing, so they notify nothing.
      if (binding.route.notify !== null) {
        const changed = entityIdOf(data);
        if (changed !== null) await publishNotice(noticeSubject(meta.resource, changed));
      }

      return {
        ok: true,
        requestId: meta.requestId,
        signature: signReply(
          {
            requestId: meta.requestId,
            resource: meta.resource,
            operation: meta.operation,
            ok: true,
          },
          data,
          options.secret,
        ),
        data,
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        return reject(meta, error.code, error.message, error.data);
      }
      console.error(`[${service}] ${meta.resource}.${meta.operation}`, error);
      return reject(meta, "INTERNAL", "The service failed to handle this request.");
    }
  }

  return { service, routes, handle, unreadable };
}

/**
 * The consumer half of the block. An evt.* consumer that only checks the shape of an
 * envelope trusts `meta.orgId` from whoever published it: forged events meter a victim org
 * without limit, and because `audit_log.requestId` is unique with `onConflictDoNothing`, a
 * forged event racing a real one silently suppresses the genuine audit row.
 *
 * A message that fails any check here is dropped rather than thrown, so JetStream acks it
 * instead of redelivering forged bytes five times.
 */
export function defineConsumer(
  options: { secret: string },
  run: (args: { meta: RequestMeta; payload: EventPayload; subject: string }) => Promise<void>,
): (raw: unknown, subject: string) => Promise<void> {
  return async (raw, subject) => {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[consumer] dropped a malformed envelope on ${subject}`);
      return;
    }
    const { meta, payload, signature } = parsed.data;

    if (!verifyEvent(meta, payload, signature, options.secret)) {
      console.error(
        `[consumer] dropped an unsigned ${meta.resource}.${meta.operation} on ${subject}`,
      );
      return;
    }

    const body = eventPayloadSchema.safeParse(payload);
    if (!body.success) {
      console.error(`[consumer] dropped ${meta.resource}.${meta.operation}: not an event body`);
      return;
    }

    const route = ROUTES.find(
      (candidate) => candidate.resource === meta.resource && candidate.operation === meta.operation,
    );
    if (route === undefined || route.event !== subject) {
      console.error(
        `[consumer] dropped ${meta.resource}.${meta.operation} delivered on ${subject}`,
      );
      return;
    }

    await run({ meta, payload: body.data, subject });
  };
}
