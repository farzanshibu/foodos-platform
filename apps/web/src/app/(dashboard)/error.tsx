"use client";

/**
 * SOT: dashboard-error-boundary, segment-error, error-recovery, cold-start-retry
 * WHAT   The segment boundary for every page under (dashboard).
 * WHY    Each page awaits a blocking server call in its component body - `api.project.list`,
 *        `api.billing.overview` - which reaches the gateway, the bus and a service. Any of
 *        those being unavailable throws during render, and without a boundary React unmounts
 *        the whole tree and Next.js serves a bare 500 with no navigation on it. A denial the
 *        platform has a vocabulary for (SERVICE_UNAVAILABLE, DEADLINE_EXCEEDED) should not
 *        look like a crash.
 * WHY    The commonest cause on a small deployment is a services host that went idle. So the
 *        boundary asks for it to be woken and retries by itself a few times, instead of
 *        leaving a person to press the button every ten seconds for a minute.
 * HOW    It sits inside (dashboard)/layout.tsx, so the sidebar, the viewer context and the
 *        route guard all survive: only the page area is replaced, and `reset()` re-renders
 *        it without a full navigation. A throw in the LAYOUT itself is above this boundary
 *        and is caught by app/global-error.tsx instead - the two are not interchangeable.
 * HOW    The message is deliberately not read off `error.message`. React replaces a server
 *        error with a generic one in production and keeps only `digest`, so anything parsed
 *        out of it here would be a string that exists in development and not in production.
 *        The digest is shown because it is the only thing that correlates this screen with
 *        the server log line.
 * WHERE  apps/web/src/app/global-error.tsx, apps/web/src/app/api/wake/route.ts
 */
import { Button } from "@foodos/ui/button";
import { useEffect, useRef, useState } from "react";

const RETRY_MS = 8_000;
const MAX_AUTO_RETRIES = 10;

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const woke = useRef(false);

  useEffect(() => {
    if (!woke.current) {
      woke.current = true;
      void fetch("/api/wake", { method: "POST" }).catch(() => undefined);
    }
    if (attempt >= MAX_AUTO_RETRIES) return;
    const timer = window.setTimeout(() => {
      setAttempt((n) => n + 1);
      reset();
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, reset]);

  const retrying = attempt < MAX_AUTO_RETRIES;

  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16" role="alert">
      <h1 className="text-xl font-semibold">
        {retrying ? "Waking the platform…" : "This page could not load"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {retrying
          ? "The services were idle and are starting up. This page will load by itself in about a minute."
          : "Something behind this screen did not answer. Your data is unaffected - nothing was written. Try again, and if it keeps happening the reference below identifies the request in our logs."}
      </p>
      {error.digest === undefined ? null : (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <Button
        onClick={() => {
          setAttempt(0);
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
