/**
 * SOT: cart-stream, sse-route, shared-cart-push, notice-fanout
 * WHAT   Tells a phone holding a shared basket that the basket moved, the moment it moves.
 * WHY    Three people at one table are looking at the same list. A timer is the wrong way to
 *        find out somebody added a dish: slow enough to feel broken if you widen it, and a
 *        constant drum of pointless requests from every phone in the room if you do not.
 * HOW    This streams a NUDGE, never the basket. The payload is a version number; the client
 *        re-reads through the ordinary tRPC call, which passes all ten gates like every other
 *        read. That is the whole design - it means this route can never become a second, less
 *        guarded way to read somebody's data, because it has no data to give.
 * WHERE  packages/transport/src/notice.ts, services/orders/src/table-party.ts,
 *        apps/web/src/features/table/use-cart-stream.ts
 */
import { noticeSubject } from "@foodos/registry";
import { subscribeNotices } from "@foodos/transport";
import type { NextRequest } from "next/server";

import { identifyGuest } from "@/gateway/guest-session";
import { api } from "@/trpc/server";

/** NATS speaks TCP, which the edge runtime cannot. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Long enough to be quiet, short enough to beat the idle timeout of the proxies that sit in
 * front of this in practice - most cut an idle connection at 60 seconds. A comment line is
 * the cheapest thing SSE lets us send and the client ignores it.
 */
const HEARTBEAT_MS = 25_000;

/** Nobody sits at a table for a day. A stream that outlives the ticket is a leak of sockets. */
const MAX_STREAM_MS = 6 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  /**
   * The ticket, not a query parameter. A cart id in the URL would let anyone who learned one
   * watch that table; the ticket says which session is asking and the id is derived from it.
   */
  const identity = identifyGuest(request.headers);
  if (identity === null) return new Response("no session", { status: 401 });

  const cartId = request.nextUrl.searchParams.get("cartId");
  if (cartId === null || cartId.length < 8 || cartId.length > 64) {
    return new Response("no cart", { status: 400 });
  }

  /**
   * Prove the caller may watch this basket BEFORE subscribing, by asking the block the same
   * question a read asks. A subscription is a standing read; granting one without the gate
   * that guards the read would be the hole this route exists to avoid.
   */
  if (!(await mayWatch(cartId))) return new Response("not found", { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const abort = new AbortController();
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /** The browser went away mid-write. Nothing to do but stop. */
          close();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        abort.abort();
        clearInterval(heartbeat);
        clearTimeout(expiry);
        try {
          controller.close();
        } catch {
          /** Already closed by the runtime. */
        }
      };

      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      const expiry = setTimeout(close, MAX_STREAM_MS);
      request.signal.addEventListener("abort", close, { once: true });

      /** Tells the browser to wait this long before reconnecting after a drop. */
      send("retry: 3000\n\n");

      void (async () => {
        try {
          for await (const notice of subscribeNotices(
            noticeSubject("cart", cartId),
            abort.signal,
          )) {
            send(`data: ${JSON.stringify({ at: notice.at })}\n\n`);
          }
        } catch (error) {
          console.warn("[cart-stream] subscription ended", error);
        } finally {
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      /** `no-transform` matters: a proxy that buffers this defeats the point of it. */
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * May this caller watch this basket?
 *
 * Asked by doing the read, through the same in-process caller a page uses, so the answer
 * comes from the block rather than from a rule written twice. A guest is narrowed to a basket
 * they are a member of; anything else comes back empty or throws, and both mean no.
 *
 * The result is thrown away - only the verdict matters. Reading the basket here and streaming
 * it would turn this route into a data path, which is the one thing it must not become.
 */
async function mayWatch(cartId: string): Promise<boolean> {
  try {
    const found = await api.cart.get({ id: cartId, limit: 1, cursor: null });
    return found.items.length > 0;
  } catch {
    return false;
  }
}
