/**
 * SOT: plan-table, pricing-table, checkout-ui, plan-picker
 * WHAT   The upgrade path, built from the registry and routed through the block.
 * WHY    This replaces Autumn's <PricingTable/>. That widget talked to the vendor's own
 *        endpoints, mounted under /api/auth/autumn/* by a better-auth plugin - no role
 *        gate, no per-org rate limit, no audit row, and a second way into the vendor
 *        beside the adapter. `billing.manage` already existed for this: owner-only,
 *        `audit: true`, rate limited per org, served straight into the same adapter. It
 *        had no caller. This is the caller.
 * WHY    The plans, their prices, their order and the current one all come from the
 *        registry, so adding a plan to `PLANS` puts a column here with no edit to this
 *        file - and no screen in the product can quote a price the registry disagrees with.
 * HOW    <PlanTable current={entitlements.plan} /> from the billing page.
 * WHERE  packages/registry/src/registry.ts, apps/web/src/gateway/routers/billing.router.ts
 */
"use client";

import { PLANS, PLANS_ASCENDING, type PlanKey, planRank } from "@foodos/registry";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "@/trpc/react";

/** Never formatted by hand twice: one place decides what "$29" and "Free" look like. */
function priceLabel(plan: PlanKey): string {
  const price = PLANS[plan].priceMonthlyUsd;
  return price === 0 ? "Free" : `$${String(price)}/mo`;
}

export function PlanTable({ current }: { current: PlanKey }) {
  const trpc = useTRPC();
  const [pending, setPending] = useState<PlanKey | null>(null);

  const checkout = useMutation(
    trpc.billing.checkout.mutationOptions({
      onSuccess: (result) => {
        // A null url means the plan changed without a payment step - nothing to visit.
        if (result.url !== null) window.location.assign(result.url);
        else window.location.reload();
      },
      onSettled: () => {
        setPending(null);
      },
    }),
  );

  return (
    <section className="space-y-3">
      <h2 className="font-medium text-base">Plans</h2>
      {/* Four plans, four equal columns. sm:grid-cols-3 left the fourth stranded on its own
          row looking like an afterthought, which is not how you show the top tier. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS_ASCENDING.map((plan) => {
          const isCurrent = plan === current;
          const isDowngrade = planRank(plan) < planRank(current);
          return (
            <Card
              key={plan}
              variant={isCurrent ? "elevated" : "default"}
              className={isCurrent ? "border-primary ring-1 ring-primary/25" : undefined}
            >
              <CardContent className="flex h-full flex-col gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-sm">{PLANS[plan].label}</h3>
                    {/* Not the border alone: the current plan says so in words too. */}
                    {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                  </div>
                  <p className="font-semibold text-2xl tabular-nums tracking-[-0.02em]">
                    {priceLabel(plan)}
                  </p>
                </div>
                <p className="flex-1 text-muted-foreground text-sm">{PLANS[plan].tagline}</p>
                <Button
                  className="w-full"
                  variant={isCurrent ? "outline" : isDowngrade ? "secondary" : "default"}
                  disabled={isCurrent || checkout.isPending}
                  loading={pending === plan && checkout.isPending}
                  onClick={() => {
                    setPending(plan);
                    checkout.mutate({ plan, successUrl: window.location.href });
                  }}
                >
                  {isCurrent ? "Current plan" : isDowngrade ? "Switch down" : "Upgrade"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {/* The structured refusal, not error.message painted red. A non-owner reaching this
          gets the gateway's PERMISSION_DENIED; a rate limit gets its retry seconds. */}
      <Denial error={checkout.error} resource="billing" />
    </section>
  );
}
