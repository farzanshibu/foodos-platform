/**
 * SOT: upgrade-modal-app, checkout-wiring, modal-mount
 * WHAT   The app's one upgrade modal, with checkout wired to the block.
 * WHY    The shell in packages/ui cannot see AppRouter, so the billing.checkout mutation -
 *        owner-only, audited, rate limited - is injected here and nowhere else. Mounting
 *        happens once, in the dashboard layout, which is why every denial in the product
 *        can open this without any feature importing it.
 * HOW    <AppUpgradeModal current={plan} /> inside ViewerProvider. Denial auto-opens it;
 *        features may also call useUpgradeModal().open("project") directly.
 * WHERE  apps/web/src/app/(dashboard)/layout.tsx, @foodos/ui/upgrade-modal
 */
"use client";

import type { PlanKey } from "@foodos/registry";
import { UpgradeModalProvider } from "@foodos/ui/upgrade-modal";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

export function AppUpgradeModal({ current }: { readonly current: PlanKey }) {
  const trpc = useTRPC();
  const checkout = useMutation(trpc.billing.checkout.mutationOptions());

  return (
    <UpgradeModalProvider
      current={current}
      onCheckout={(plan) => checkout.mutateAsync({ plan, successUrl: window.location.href })}
    >
      {null}
    </UpgradeModalProvider>
  );
}
