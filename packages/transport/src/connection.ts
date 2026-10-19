/**
 * SOT: nats, nats-connection, transport-connection, jetstream-client
 * WHAT   One NATS connection per process, plus the JetStream handles.
 * WHY    Connections are expensive and Next.js hot-reloads modules; a global keeps dev
 *        from opening a connection per edit.
 * HOW    nats.js v3 splits the client: `connect` from the node transport, `jetstream` and
 *        `jetstreamManager` from the JetStream module. This file is the only place that
 *        knows that. Swapping to another broker means rewriting this file and request.ts.
 * WHERE  @foodos/transport/*, services/*, scripts/bootstrap-streams.ts
 */
import "server-only";

import { env } from "@foodos/env";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  type JetStreamClient,
  type JetStreamManager,
  jetstream,
  jetstreamManager,
} from "@nats-io/jetstream";
import {
  connect,
  credsAuthenticator,
  type NatsConnection,
  nkeyAuthenticator,
} from "@nats-io/transport-node";

/**
 * Declared rather than asserted. Next.js re-evaluates modules on every hot reload, so
 * without this the dev server opens a new NATS connection per edit.
 */
declare global {
  var __foodosNats: Promise<NatsConnection> | undefined;
  var __foodosNatsScoped: Map<string, Promise<NatsConnection>> | undefined;
}

/**
 * Run code inside a scope and every `connection()` it makes - including from callbacks and
 * awaits it starts - opens its own named connection instead of sharing the process one.
 *
 * Why this exists: a hosted bus caps subscriptions per connection, and several services in
 * one process would otherwise pile all of theirs onto a single connection and silently lose
 * the ones past the cap. The cap is per connection, so a connection per service stays under it.
 */
export const connectionScope = new AsyncLocalStorage<string>();

export const natsUrl = env.natsUrl;

/**
 * Not `async`: it hands back the one shared promise rather than awaiting and re-wrapping it.
 * The seed is this process's identity on the bus; infra/nats/auth.conf says which subjects
 * that identity may use. `inboxPrefix` scopes replies to this process, so a compromised
 * service cannot subscribe to the gateway's inbox and read every answer crossing the bus.
 */
/**
 * How long the request-serving process keeps an unused connection. Each serverless instance
 * opens its own, and a free-tier bus caps them account-wide, so an idle one is given back
 * rather than held until the platform recycles the instance.
 */
const IDLE_CLOSE_MS = 15_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function closeWhenIdle(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const pending = globalThis.__foodosNats;
    globalThis.__foodosNats = undefined;
    void pending?.then((nc) => nc.drain()).catch(() => undefined);
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

export function connection(): Promise<NatsConnection> {
  const scope = connectionScope.getStore();
  if (scope === undefined) {
    closeWhenIdle();
    // A failed connect must not be cached, or every later request replays the same failure.
    globalThis.__foodosNats ??= open(env.natsUser()).catch((error: unknown) => {
      globalThis.__foodosNats = undefined;
      throw error;
    });
    return globalThis.__foodosNats;
  }
  const scoped = (globalThis.__foodosNatsScoped ??= new Map());
  let pending = scoped.get(scope);
  if (pending === undefined) {
    pending = open(`${env.natsUser()}-${scope}`, true).catch((error: unknown) => {
      scoped.delete(scope);
      throw error;
    });
    scoped.set(scope, pending);
  }
  return pending;
}

/**
 * One connect attempt per DNS answer, retried a few times. A hosted bus's name resolves to
 * several addresses and an occasional one fails the TLS name check (ERR_TLS_CERT_ALTNAME_INVALID),
 * so a single failed dial is not the bus being down; the next attempt draws another address.
 */
async function open(name: string, patient = false): Promise<NatsConnection> {
  const seed = env.natsNkeySeed();
  const creds = env.natsCreds();
  // exactOptionalPropertyTypes: an absent credential is an absent key, never `undefined`.
  const auth =
    creds !== null
      ? { authenticator: credsAuthenticator(new TextEncoder().encode(creds)) }
      : seed !== null
        ? { authenticator: nkeyAuthenticator(new TextEncoder().encode(seed)) }
        : {};
  const attempts = patient ? 60 : 6;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect({
        servers: natsUrl(),
        name,
        inboxPrefix: `_INBOX.${name}`,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 500,
        // Keep dialling the configured name rather than peers the bus advertises by address.
        ignoreClusterUpdates: true,
        timeout: 5_000,
        ...auth,
      });
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw last;
}

export async function js(): Promise<JetStreamClient> {
  return jetstream(await connection());
}

export async function jsm(): Promise<JetStreamManager> {
  return jetstreamManager(await connection());
}

export async function closeConnection(): Promise<void> {
  const all = [globalThis.__foodosNats, ...(globalThis.__foodosNatsScoped?.values() ?? [])];
  globalThis.__foodosNats = undefined;
  globalThis.__foodosNatsScoped = undefined;
  await Promise.all(all.map(async (pending) => (await pending)?.drain()));
}

export const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

export const decode = <T>(data: Uint8Array): T => JSON.parse(new TextDecoder().decode(data)) as T;
