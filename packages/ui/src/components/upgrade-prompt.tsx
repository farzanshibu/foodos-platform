/**
 * SOT: upgrade-prompt, upsell, upsell-copy, sales-moment
 * WHAT   The one upsell in the UI, rendered from the denial the registry produced.
 * WHY    A plan denial is a sales moment, and the words for it are written once - next to
 *        the limit that caused them. A component that invents its own copy, or names a
 *        plan, becomes a second source of truth for pricing that nobody updates.
 * WHY    It looks like an offer, not an error: a tinted note with the accent, a lock, and a
 *        real button to the place that resolves it. The previous underlined sentence read as
 *        a broken link at every size.
 * HOW    <UpgradePrompt decision={decision} /> - the default fallback of FeatureGate and
 *        PriceGate, and usable directly wherever a denial is already in hand.
 * WHERE  ./feature-gate, ./price-gate, apps/web/src/features/*
 */
"use client";

import { type AccessDecision, BILLING_HREF, PLANS } from "@foodos/registry";
import { Lock } from "lucide-react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./ui/button";

/** The refused half of a decision - the only half that carries copy worth showing. */
export type AccessDenial = Extract<AccessDecision, { allowed: false }>;

export function UpgradePrompt({
  decision,
  className,
}: {
  decision: AccessDenial;
  className?: string;
}) {
  const next = decision.nextPlan;

  // Top of the ladder: there is nothing left to sell, so do not offer a way to buy it.
  if (next === null || BILLING_HREF === undefined) {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>{decision.upgradeMessage}</p>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent bg-accent/60 px-3.5 py-3 text-sm",
        className,
      )}
    >
      <Lock className="size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-accent-foreground">{decision.upgradeMessage}</p>
      <a
        className={buttonVariants({ variant: "default", size: "sm" })}
        href={BILLING_HREF}
        title={PLANS[next].tagline}
      >
        See {PLANS[next].label}
      </a>
    </div>
  );
}
