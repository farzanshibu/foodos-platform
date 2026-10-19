/**
 * SOT: rpc-request, request-reply, dispatch, publish-command, publish-event, reply-validation
 * WHAT   The three ways a message leaves a process.
 * WHY    Every call site uses these, so retries, timeouts, dedupe ids, reply validation and
 *        error decoding are decided once instead of per feature.
 * HOW    A reply is parsed against `replyEnvelope` rather than cast into shape, then checked
 *        against the request it claims to answer and the shared secret. The bytes come off a
 *        subject anything can publish on: a queue group is not exclusivity, and
 *        `decode<ReplyEnvelope<T>>` was a promise nobody kept - a malformed answer reached
 *        `reply.error` and threw a TypeError out of the gateway as a raw 500.
 *        The check lives here as well as in the gateway block because not every caller goes
 *        through `dispatch`: the entitlements cache asks billing directly, and a forged
 *        answer there pins an organisation to the wrong plan for the life of the cache.
 * WHERE  @foodos/core (gateway), apps/web/src/gateway/deps.ts, services/<name>
 */
import "server-only";

import {
  type Envelope,
  type ReplyEnvelope,
  replyEnvelope,
  ServiceError,
  verifyReply,
} from "@foodos/contracts";
import { env } from "@foodos/env";
import { z } from "zod";

import { connection, decode, encode, js } from "./connection";

/**
 * Over HTTPS to the process that holds the bus connections, when one is configured. The
 * envelope and reply are exactly what would have crossed NATS - signed by the same keys and
 * verified by the same checks below - so the bridge adds a hop, not a new trust boundary.
 * The shared token only stops strangers from using the bridge as a free relay.
 */
async function bridgePost(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const base = env.busBridgeUrl();
  const token = env.busBridgeToken();
  if (base === null || token === null) throw new Error("bus bridge is not configured");
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    // The host may be waking from idle, which a plain NATS timeout would never allow for.
    signal: AbortSignal.timeout(timeoutMs + 20_000),
  });
  if (!response.ok) throw new Error(`bus bridge answered ${String(response.status)}`);
  return response;
}

/** The bus half of an RPC, with no verification: raw reply bytes, decoded. */
export async function rpcRaw(subject: string, envelope: Envelope, timeoutMs: number): Promise<unknown> {
  if (env.busBridgeUrl() !== null) {
    return (await bridgePost("/bridge/rpc", { subject, envelope, timeoutMs }, timeoutMs)).json();
  }
  return rpcRawDirect(subject, envelope, timeoutMs);
}

/** Straight to NATS. What the bridge itself calls, and what everything uses without one. */
export async function rpcRawDirect(
  subject: string,
  envelope: Envelope,
  timeoutMs: number,
): Promise<unknown> {
  const nc = await connection();
  const message = await nc.request(subject, encode(envelope), { timeout: timeoutMs });
  return decode(message.data);
}

/** Synchronous call. Rejects on timeout so the gateway can map it to a clean error. */
export async function rpcRequest<TReply>(args: {
  subject: string;
  envelope: Envelope;
  timeoutMs: number;
}): Promise<ReplyEnvelope<TReply>> {
  const parsed = replyEnvelope.safeParse(await rpcRaw(args.subject, args.envelope, args.timeoutMs));
  if (!parsed.success) {
    throw new ServiceError(
      "UNTRUSTED_ENVELOPE",
      `The reply on ${args.subject} is not a reply envelope.`,
    );
  }
  const reply = parsed.data;

  // Bound to the request it answers, so a reply captured from one call cannot answer another.
  if (reply.requestId !== args.envelope.meta.requestId) {
    throw new ServiceError(
      "UNTRUSTED_ENVELOPE",
      `The reply on ${args.subject} answers a different request.`,
    );
  }

  const answered = reply.ok ? reply.data : reply.error;
  if (
    !verifyReply(
      /** From the envelope we sent, never from the reply we are checking. */
      {
        requestId: args.envelope.meta.requestId,
        resource: args.envelope.meta.resource,
        operation: args.envelope.meta.operation,
        ok: reply.ok,
      },
      answered,
      reply.signature,
      env.envelopeSecret(),
    )
  ) {
    throw new ServiceError(
      "UNTRUSTED_ENVELOPE",
      `The reply on ${args.subject} is not signed by the owning service.`,
    );
  }

  if (!reply.ok) {
    return {
      ok: false,
      requestId: reply.requestId,
      signature: reply.signature,
      error: reply.error,
    };
  }

  /**
   * The envelope is validated; `data` deliberately is not. The transport does not know the
   * contract, so it carries the caller's expectation rather than checking it - the gateway
   * re-parses this with `contract.output.parse` before anything reads it, and the reply
   * signature has already proved which process produced it.
   */
  return {
    ok: true,
    requestId: reply.requestId,
    signature: reply.signature,
    data: z.custom<TReply>().parse(reply.data),
  };
}

/**
 * Durable command. `msgID` is the request id, so a retried publish is deduped by the
 * server inside the stream's duplicate window rather than running twice.
 */
export async function publishCommand(args: { subject: string; envelope: Envelope }): Promise<void> {
  if (env.busBridgeUrl() !== null) {
    await bridgePost("/bridge/command", args, 5_000);
    return;
  }
  await publishCommandDirect(args);
}

export async function publishCommandDirect(args: {
  subject: string;
  envelope: Envelope;
}): Promise<void> {
  const stream = await js();
  await stream.publish(args.subject, encode(args.envelope), {
    msgID: args.envelope.meta.requestId,
  });
}

/** A fact that already happened. Fire and forget, but durable. */
export async function publishEvent(args: { subject: string; envelope: Envelope }): Promise<void> {
  const stream = await js();
  await stream.publish(args.subject, encode(args.envelope), {
    msgID: `${args.envelope.meta.requestId}:evt`,
  });
}
