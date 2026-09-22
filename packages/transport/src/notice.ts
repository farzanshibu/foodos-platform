/**
 * SOT: notice-channel, change-notice, core-publish, notice-subscribe
 * WHAT   The fire-and-forget nudge channel: "this row changed", to whoever already watches it.
 * WHY    Some rows are looked at by more than one person at once - a basket shared by three
 *        phones at one table - and a timer is the wrong way to find out. A notice lets a
 *        watcher re-read the moment something happens, through the ordinary block, instead of
 *        asking every few seconds whether anything has.
 * HOW    Core NATS, not JetStream, and that is the whole design. An `evt.` message is a
 *        durable business fact: audit and metering are built on them and the stream redelivers
 *        until they are acked. A notice is disposable - if it is dropped, the watcher re-reads
 *        on its next reconnect and nothing is lost, because the notice never carried the
 *        change in the first place. Putting these on a stream would turn every tap on a menu
 *        into a durable fact somebody has to store and ack.
 * WHERE  packages/registry/src/derive.ts builds the subjects, packages/core/src/service.ts
 *        publishes after a mutation, apps/web/src/app/api/stream reads them out to a browser.
 */
import "server-only";

import { connection, decode, encode } from "./connection";

/**
 * What a notice carries, and deliberately all it carries.
 *
 * No tenant, no row, no field - a subscriber learns only that the row named in the SUBJECT
 * moved, and it had to be told that id by an authorised read to be subscribed at all. Keeping
 * the body this thin is what stops the channel becoming a second way to read data: there is
 * nothing here to leak, and the re-read it triggers goes through every gate as usual.
 *
 * `at` exists so a watcher can drop a notice older than what it already holds, which happens
 * routinely when a reconnect and a live message race.
 */
export type Notice = { readonly at: number };

/**
 * Publish is best-effort on purpose. A bus hiccup must never fail the mutation that already
 * succeeded - the row is written, and the watcher's next re-read will show it regardless. The
 * failure is logged rather than thrown for exactly that reason.
 */
export async function publishNotice(subject: string): Promise<void> {
  try {
    const nc = await connection();
    nc.publish(subject, encode({ at: Date.now() } satisfies Notice));
  } catch (error) {
    console.warn(`[notice] could not publish ${subject}`, error);
  }
}

/**
 * Subscribe until the caller's signal aborts.
 *
 * Ephemeral and unqueued: every watcher of a basket wants every notice, so a queue group -
 * which hands each message to exactly one member - would be precisely wrong here. The
 * subscription is torn down on abort, which is what a browser closing a tab looks like.
 */
export async function* subscribeNotices(
  subject: string,
  signal: AbortSignal,
): AsyncGenerator<Notice> {
  const nc = await connection();
  const subscription = nc.subscribe(subject);
  const stop = () => {
    subscription.unsubscribe();
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    for await (const message of subscription) {
      if (signal.aborted) return;
      yield decode<Notice>(message.data);
    }
  } finally {
    signal.removeEventListener("abort", stop);
    subscription.unsubscribe();
  }
}
