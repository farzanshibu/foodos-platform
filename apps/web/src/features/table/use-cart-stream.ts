/**
 * SOT: cart-stream-hook, sse-client, shared-cart-live, poll-fallback
 * WHAT   Keeps one phone's view of a shared basket current while other people change it.
 * WHY    Three people at a table are looking at the same list. Seeing somebody else's dish a
 *        second after they add it is the difference between "we are ordering together" and
 *        "we are each guessing what the others did".
 * HOW    An `EventSource` on a route that streams a nudge and never the basket, so a message
 *        arriving means "re-read", not "here is the data". The re-read goes through the
 *        ordinary gateway call with all its gates. If the stream cannot hold - a captive
 *        portal, a proxy that buffers, a browser that froze the tab - it falls back to asking
 *        on the interval the server suggested, which is slower but never wrong.
 * WHERE  apps/web/src/app/api/stream/cart/route.ts, use-table-cart.ts
 */
"use client";

import { useEffect, useRef, useState } from "react";

/** Two failures is a pattern, not a blip: the first is routine, the second means it will not hold. */
const FAILURES_BEFORE_FALLBACK = 2;

export type StreamState = "connecting" | "live" | "polling";

/**
 * Calls `onChange` whenever the basket moves, and reports how it is finding out.
 *
 * The state is returned because it is worth showing: a table told "live" believes what it
 * sees, and a table quietly on a fallback poll should not be told the same thing.
 */
export function useCartStream(args: {
  cartId: string | null;
  enabled: boolean;
  /** What the server suggested for polling, in seconds. Used only when the stream cannot hold. */
  pollSeconds: number;
  onChange: () => void;
}): StreamState {
  const [state, setState] = useState<StreamState>("connecting");

  /**
   * Held in a ref so a re-render with a new closure does not tear down a working stream.
   * Reconnecting on every render is how a live feature becomes a request storm.
   */
  const onChangeRef = useRef(args.onChange);
  onChangeRef.current = args.onChange;

  const { cartId, enabled, pollSeconds } = args;

  useEffect(() => {
    if (!enabled || cartId === null) return;

    let failures = 0;
    let disposed = false;
    let poller: ReturnType<typeof setInterval> | null = null;

    const source = new EventSource(`/api/stream/cart?cartId=${encodeURIComponent(cartId)}`);

    source.onopen = () => {
      if (disposed) return;
      failures = 0;
      stopPolling();
      setState("live");
    };

    source.onmessage = () => {
      if (disposed) return;
      onChangeRef.current();
    };

    /**
     * `EventSource` retries on its own, so this does not reconnect - it only decides when to
     * stop trusting the stream and start asking instead. Both can run at once for a while,
     * which is harmless: a re-read is idempotent.
     */
    source.onerror = () => {
      if (disposed) return;
      failures += 1;
      if (failures >= FAILURES_BEFORE_FALLBACK) startPolling();
    };

    function startPolling() {
      if (poller !== null) return;
      setState("polling");
      poller = setInterval(() => onChangeRef.current(), Math.max(2, pollSeconds) * 1000);
    }

    function stopPolling() {
      if (poller === null) return;
      clearInterval(poller);
      poller = null;
    }

    /**
     * Coming back from the lock screen. A phone that was asleep missed every nudge sent while
     * it was away, and the stream may or may not have survived - so re-read once on the way
     * back in rather than trusting either.
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") onChangeRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      stopPolling();
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cartId, enabled, pollSeconds]);

  return state;
}
