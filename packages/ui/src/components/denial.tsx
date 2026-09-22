/**
 * SOT: denial, denial-channel, error-to-denial, upgrade-required-ui, rate-limited-ui,
 *      downgrade-blocked-ui, modal-auto-open
 * WHAT   The consumer end of the gateway's structured refusal. Turns a failed mutation into
 *        the right conversation: an upsell, a wait, or an error.
 * WHY    The gateway has always computed a four-arm `GatewayFailure` carrying the plan
 *        decision, the retry seconds and the refused permission - and nothing read it. All
 *        four call sites printed `error.message` in destructive red, so a plan limit
 *        rendered the registry's sales copy as if the product had crashed, and the retry
 *        seconds the rate limiter computed were never shown to anyone. Matching on the
 *        message string instead would be worse: copy is registry data and changes.
 * HOW    <Denial error={create.error} resource="project" /> beside the control that failed.
 *        The payload is parsed with `denial` from @foodos/contracts - the same schema the
 *        gateway's error formatter is typed against - so the two ends cannot drift.
 * HOW    An UPGRADE_REQUIRED prefers the LOCAL mirror's decision, which carries the
 *        registry's own copy and its next plan. But it does not require it: the mirror reads
 *        a usage snapshot that is up to 30s stale and only advances after an event, so on a
 *        burst the gateway refuses a request the mirror still believes is allowed. That case
 *        falls back to the gateway's own message, styled as the upsell it is - never as a
 *        red error, which is the exact behaviour this component exists to remove.
 * WHERE  apps/web/src/features/*, apps/web/src/gateway/init.ts (the producer)
 */
"use client";

import { type Denial as DenialPayload, denial } from "@foodos/contracts/errors";
import { BILLING_HREF, type ResourceKey } from "@foodos/registry";
import { useEffect } from "react";

import { cn } from "../lib/utils";
import { useResourceDecision } from "./feature-gate";
import { Alert } from "./ui/alert";
import { buttonVariants } from "./ui/button";
import { useUpgradeModal } from "./upgrade-modal";
import { UpgradePrompt } from "./upgrade-prompt";

/**
 * Structurally what a tRPC client error is, spelled out rather than imported: packages/ui
 * cannot see AppRouter, and importing @trpc/client here would put the gateway's router type
 * in the dependency graph of every component. `data` names `undefined` explicitly because
 * tRPC types it as `Maybe<T>` and `exactOptionalPropertyTypes` treats absent and
 * present-but-undefined as different states.
 */
export type DenialError = {
  readonly message: string;
  readonly data?: { readonly app?: unknown } | null | undefined;
};

/**
 * The parse boundary, and a real one: `error.data.app` crossed a network as JSON, so it is
 * `unknown` until a schema proves otherwise. A code the vocabulary does not contain yields
 * `null`, which renders the plain message - a refusal the UI cannot interpret must never be
 * silently swallowed.
 */
export function denialOf(error: DenialError | null | undefined): DenialPayload | null {
  const parsed = denial.safeParse(error?.data?.app);
  return parsed.success ? parsed.data : null;
}

export function Denial({
  error,
  resource,
  className,
}: {
  readonly error: DenialError | null | undefined;
  /** Lets an UPGRADE_REQUIRED render this resource's own upsell from the local mirror. */
  readonly resource?: ResourceKey;
  readonly className?: string;
}) {
  // Called unconditionally - the rules of hooks are about the call, not the use. "billing"
  // is the stand-in when no resource was named: every plan includes it, so the decision it
  // produces is always `allowed` and is therefore never the branch that renders.
  const local = useResourceDecision(resource ?? "billing");
  const failure = denialOf(error);
  const modal = useUpgradeModal();

  const upgradeCode = failure !== null && failure.code === "UPGRADE_REQUIRED";
  useEffect(() => {
    // The server said no for plan reasons, so the pricing experience opens itself -
    // wherever the refusal surfaced, with the refused feature highlighted when known.
    if (upgradeCode) modal.open(resource);
  }, [upgradeCode, modal, resource]);

  if (!error) return null;

  if (failure === null) {
    return (
      <Alert tone="danger" className={className}>
        {error.message}
      </Alert>
    );
  }

  if (failure.code === "UPGRADE_REQUIRED") {
    // Preferred: the mirror's own decision, which carries the registry's copy and the plan
    // to sell. Requires `resource`, and requires the mirror to agree it is denied.
    if (resource !== undefined && !local.allowed) {
      return <UpgradePrompt decision={local} {...(className === undefined ? {} : { className })} />;
    }
    // Fallback: the mirror is stale or no resource was named. The gateway's message IS the
    // registry's upgrade copy - `checkResourceAccess` produced it and the gateway sent it -
    // so this is the same words, without the next plan's tagline.
    return BILLING_HREF === undefined ? (
      <p className={cn("text-muted-foreground text-sm", className)}>{failure.message}</p>
    ) : (
      <Alert tone="info" className={className}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1">{failure.message}</span>
          <a className={buttonVariants({ variant: "outline", size: "sm" })} href={BILLING_HREF}>
            View plans
          </a>
        </span>
      </Alert>
    );
  }

  if (failure.code === "RATE_LIMITED") {
    return (
      <Alert tone="warning" className={className}>
        {failure.retryAfterSeconds === undefined
          ? "Too many requests. Try again shortly."
          : `Too many requests. Try again in ${String(failure.retryAfterSeconds)}s.`}
      </Alert>
    );
  }

  if (failure.code === "DOWNGRADE_BLOCKED") {
    // Disclosed, not just blocked: the named resources are what must come down first.
    return (
      <Alert tone="warning" className={className} title={failure.message}>
        {failure.blockers === undefined ? null : (
          <ul className="list-inside list-disc">
            {failure.blockers.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        )}
      </Alert>
    );
  }

  return (
    <Alert tone="danger" className={className}>
      {failure.message}
    </Alert>
  );
}
