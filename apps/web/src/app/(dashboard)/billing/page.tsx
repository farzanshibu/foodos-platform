/**
 * SOT: billing-page, plan-overview, locked-resource-explainer
 * WHAT   Plan, usage per resource, and the upgrade path.
 * WHY    Two things arrive here that nothing used to read. The dashboard layout redirects a
 *        locked resource to `/billing?locked=<resource>`, and this page ignored the
 *        parameter - so somebody who clicked "Audit log" on the free plan was teleported to
 *        a billing screen that said nothing about why. And the plan was printed as its raw
 *        key ("free"), not the label the registry gives it.
 * HOW    `locked` is validated with `isResourceKey` before it indexes anything: it arrives
 *        in a URL, so it is attacker-controlled input until the registry recognises it.
 * WHERE  apps/web/src/app/(dashboard)/layout.tsx, apps/web/src/features/billing/plan-table.tsx
 * NOTE   biome.json turns complexity/useLiteralKeys off for every page under app. Next
 *        types searchParams as an index signature, and `noPropertyAccessFromIndexSignature`
 *        makes `params.locked` a TS4111 error - so Biome's suggested rewrite would break
 *        the build, exactly as it would in @foodos/env. biome.json takes no comments, so
 *        the reason lives here.
 */
import { checkResourceAccess, isResourceKey, PLANS, usageRows } from "@foodos/registry";
import { Alert } from "@foodos/ui/alert";
import { Card, CardContent } from "@foodos/ui/card";
import { UpgradePrompt } from "@foodos/ui/upgrade-prompt";
import { UsageMeter } from "@foodos/ui/usage-meter";

import { PlanTable } from "@/features/billing/plan-table";
import { api } from "@/trpc/server";

export default async function BillingPage({
  searchParams,
}: {
  // Next.js 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const overview = await api.billing.overview({});
  const params = await searchParams;

  // Bracket access, because noPropertyAccessFromIndexSignature is on.
  const raw = params["locked"];
  const locked = typeof raw === "string" && isResourceKey(raw) ? raw : null;
  const rows = usageRows(overview.entitlements);
  const denial =
    locked === null
      ? null
      : checkResourceAccess({ resource: locked, entitlements: overview.entitlements });

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl tracking-[-0.015em]">Billing</h1>
        <p className="text-muted-foreground text-sm">
          You are on the {PLANS[overview.entitlements.plan].label} plan.
        </p>
      </header>

      {denial !== null && !denial.allowed ? <UpgradePrompt decision={denial} /> : null}

      {/* Honest trials: offered only while the provider's history says this org never had
          one, and only when there is a plan to trial. The copy names the plan and length
          the registry declared - never a number invented here. */}
      {overview.trial.eligible && overview.trial.days !== null ? (
        <Alert tone="info" title="Try a plan before you pay for it">
          Every paid plan below can be trialled free for {String(overview.trial.days)} days. It
          converts to that plan, not a tier above.
        </Alert>
      ) : null}

      {/* Only what this plan caps, or what the org has actually used. The full catalogue
          of forty resources is what the comparison table below is for; repeating it here as
          forty "0 used" rows hides the two that matter. */}
      <section className="space-y-3">
        <h2 className="font-medium text-base">Usage</h2>
        {rows.length === 0 ? (
          /* Unlimited on every capped resource and nothing used yet. An empty card would
             read as a failure to load, so the plan says its own good news instead. */
          <Card>
            <CardContent className="text-muted-foreground text-sm">
              Nothing on the {PLANS[overview.entitlements.plan].label} plan is capped, so there is
              no allowance to watch here.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <UsageMeter key={row.resource} resource={row.resource} />
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <PlanTable current={overview.entitlements.plan} />
    </div>
  );
}
