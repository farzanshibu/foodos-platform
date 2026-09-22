/**
 * SOT: upgrade-modal, fullscreen-upgrade, useUpgradeModal, feature-comparison-table,
 *      plan-cards, sales-moment
 * WHAT   The one upgrade surface, mounted once for the whole app: plan cards, a feature
 *        comparison, and checkout - opened from anywhere.
 * WHY    Every gate refusal is a sales moment, and each feature inventing its own prompt
 *        meant N places to style, word and wire checkout. One modal means a feature added
 *        tomorrow gets the full pricing experience for free: it names only its resource,
 *        and this file does the rest from the registry.
 * HOW    <UpgradeModalProvider current={plan} onCheckout={...}> around the app; any
 *        component calls useUpgradeModal().open("project") and the modal opens with that
 *        resource's row highlighted. Plans, prices, order and copy come from PLANS and
 *        featureRows() - never typed here - so no screen can quote what the gates refuse.
 * HOW    Checkout is injected as `onCheckout` because packages/ui cannot see AppRouter;
 *        apps/web wires the billing.checkout mutation in one file (see features/billing).
 * WHERE  apps/web/src/app/(dashboard)/layout.tsx, @foodos/ui/denial (auto-open)
 */
"use client";

import {
  featureRows,
  formatLimit,
  NAV_ITEMS,
  PLANS,
  PLANS_ASCENDING,
  type PlanKey,
  planRank,
  type ResourceKey,
  yearlySavings,
} from "@foodos/registry";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { cn } from "../lib/utils";

const billingHref = NAV_ITEMS.find((item) => item.resource === "billing")?.href;

/** The result of starting a checkout for a plan. A null url means nothing to visit. */
export type CheckoutResult = { readonly url: string | null };

type UpgradeModalState = {
  /** Opens the modal. The resource, when named, is highlighted in the comparison. */
  open: (resource?: ResourceKey) => void;
  close: () => void;
};

/**
 * The floor is a no-op, so a Denial rendered outside a provider - an auth page, a story -
 * degrades to doing nothing instead of crashing. Inside the dashboard there is always a
 * provider, which is where every denial lives anyway.
 */
const UpgradeModalContext = createContext<UpgradeModalState>({
  open: () => undefined,
  close: () => undefined,
});

export function useUpgradeModal(): UpgradeModalState {
  return useContext(UpgradeModalContext);
}

function priceLabel(plan: PlanKey): string {
  const price = PLANS[plan].priceMonthlyUsd;
  return price === 0 ? "Free" : `$${String(price)}/mo`;
}

function savingsLabel(plan: PlanKey): string | null {
  const savings = yearlySavings(plan);
  return savings === null || savings <= 0 ? null : `Save $${String(savings)} a year`;
}

type PlanCardProps = {
  readonly plan: PlanKey;
  readonly current: PlanKey;
  /** The refused feature, when the modal was opened by a denial: highlight what fixes it. */
  readonly highlighted: boolean;
  readonly pending: boolean;
  readonly onStart: (plan: PlanKey) => void;
};

function ModalPlanCard({ plan, current, highlighted, pending, onStart }: PlanCardProps) {
  const isCurrent = plan === current;
  const isDowngrade = planRank(plan) < planRank(current);
  const savings = savingsLabel(plan);
  const label = isCurrent
    ? "Current plan"
    : pending
      ? "Starting…"
      : isDowngrade
        ? `Switch to ${PLANS[plan].label}`
        : `Upgrade to ${PLANS[plan].label}`;
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border p-5",
        isCurrent ? "border-primary" : "border-border",
        highlighted && !isCurrent && !isDowngrade ? "ring-1 ring-primary" : undefined,
      )}
    >
      <h3 className="font-medium">{PLANS[plan].label}</h3>
      <p className="text-2xl font-semibold tabular-nums">{priceLabel(plan)}</p>
      {savings === null ? null : <p className="text-xs text-muted-foreground">{savings}</p>}
      <p className="mt-2 text-sm text-muted-foreground">{PLANS[plan].tagline}</p>
      <button
        className={cn(
          "mt-4 rounded-md px-3 py-2 text-sm font-medium",
          isCurrent
            ? "cursor-default border border-border text-muted-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
        disabled={isCurrent || pending}
        onClick={() => onStart(plan)}
        type="button"
      >
        {label}
      </button>
    </div>
  );
}

export function UpgradeModalProvider({
  current,
  onCheckout,
  children,
}: {
  readonly current: PlanKey;
  /** Starts checkout. Rejecting throws the denial the caller already knows how to render. */
  readonly onCheckout: (plan: PlanKey) => Promise<CheckoutResult>;
  readonly children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<ResourceKey | null>(null);
  const [pending, setPending] = useState<PlanKey | null>(null);
  /** A refused checkout, described in place. The modal is the surface, so the denial
   *  renders here rather than wherever the click came from. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const open = useCallback((resource?: ResourceKey) => {
    setTrigger(resource ?? null);
    setRefusal(null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const state = useMemo(() => ({ open, close }), [open, close]);

  // Escape is the keyboard way out. A focus trap would need a ref map over every control;
  // the close button is first in DOM order, which tab reaches immediately.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const rows = featureRows();

  async function start(plan: PlanKey): Promise<void> {
    setPending(plan);
    setRefusal(null);
    try {
      const result = await onCheckout(plan);
      if (result.url !== null) window.location.assign(result.url);
      else window.location.reload();
    } catch (error) {
      // The refusal (downgrade blocked, rate limited, permission denied) is described
      // where the customer is looking - never an unhandled rejection in the console.
      setRefusal(error instanceof Error ? error.message : "That did not work. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <UpgradeModalContext.Provider value={state}>
      {children}
      {isOpen ? (
        <div
          // A modal is not anchored to a trigger, so it does not fly out of one: it fades
          // and lifts four pixels, which reads as "this arrived" without implying a origin
          // it does not have.
          className="fixed inset-0 z-50 animate-enter overflow-y-auto bg-background/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Upgrade your plan"
        >
          <div className="mx-auto max-w-5xl px-6 py-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Choose your plan</h2>
                <p className="text-sm text-muted-foreground">
                  {trigger === null
                    ? "Every limit in one place."
                    : `You have reached the ${PLANS[current].label} plan's ${rows.find((row) => row.resource === trigger)?.label ?? trigger} limit.`}
                </p>
              </div>
              <button
                className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={close}
                type="button"
              >
                Close
              </button>
            </div>

            {refusal === null ? null : (
              <p
                className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {refusal}
              </p>
            )}

            {/* Capped and centred, so two plans and four plans both look deliberate. */}
            <div className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-3">
              {PLANS_ASCENDING.map((plan) => (
                <ModalPlanCard
                  key={plan}
                  plan={plan}
                  current={current}
                  highlighted={trigger !== null}
                  pending={pending !== null}
                  onStart={(target) => void start(target)}
                />
              ))}
            </div>

            <h3 className="mt-10 text-lg font-medium">What each plan includes</h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2 text-left font-medium">Feature</th>
                    {PLANS_ASCENDING.map((plan) => (
                      <th key={plan} className="px-4 py-2 text-right font-medium">
                        {PLANS[plan].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.resource}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        trigger === row.resource ? "bg-primary/5" : undefined,
                      )}
                    >
                      <td className="px-4 py-2">{row.label}</td>
                      {PLANS_ASCENDING.map((plan) => (
                        <td key={plan} className="px-4 py-2 text-right tabular-nums">
                          {formatLimit(row.limits[plan])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              Prefer to look around first?{" "}
              {billingHref === undefined ? null : (
                <a className="underline" href={billingHref}>
                  See usage per feature
                </a>
              )}
            </p>
          </div>
        </div>
      ) : null}
    </UpgradeModalContext.Provider>
  );
}
