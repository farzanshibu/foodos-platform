/**
 * SOT: dashboard-layout, route-guard, nav-gate, the-gap, over-plan-banner-mount,
 *      upgrade-modal-mount, sidebar-nudge
 * WHAT   The guard for the gap the gateway cannot cover - and the one place the plan's
 *        product surfaces are computed and mounted.
 * WHY    A page that renders a third-party widget - Autumn's pricing table, an embedded
 *        provider component - makes no tRPC call, so no envelope is ever built and the URL
 *        is otherwise open. This layout applies the same registry rules to the route.
 * WHY    Over-plan state, the upgrade modal and the sidebar nudge are derived here because
 *        this is the only component every page passes through: computed once per
 *        navigation, they cannot disagree between pages or make their own billing calls.
 * HOW    proxy.ts sets x-pathname; the registry maps path to resource; the same functions
 *        the gateway uses decide whether to render. The nudge is composed from registry
 *        derivations only - next plan, trial offer, yearly savings - so no copy here can
 *        quote a price or a length the registry does not declare.
 */
import { identify } from "@foodos/auth";
import {
  type Grant,
  navAccess,
  navFor,
  PLANS,
  type PlanKey,
  permissionsFor,
  planOverages,
  resourceForPath,
  trialOffer,
  yearlySavings,
} from "@foodos/registry";
import { OverPlanBanner } from "@foodos/ui/over-plan-banner";
import { ViewerProvider } from "@foodos/ui/viewer";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MobileNav } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AppUpgradeModal } from "@/features/billing/upgrade-modal";
import { gatewayDeps } from "@/gateway/deps";

/** What the sidebar card says. Null means say nothing at all. */
type Nudge = { readonly title: string; readonly detail: string | null };

function nudgeFor(plan: PlanKey): Nudge | null {
  // Top of the ladder: nothing left to sell, so not even a muted line.
  const offer = trialOffer(plan);
  if (offer === null) return null;
  const savings = yearlySavings(offer.plan);
  const detail =
    savings === null
      ? null
      : `${PLANS[offer.plan].label} is $${String(savings)} cheaper billed yearly.`;
  return {
    title: `Try ${PLANS[offer.plan].label} free for ${String(offer.days)} days`,
    detail,
  };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const identity = await identify(requestHeaders);

  if (!identity) redirect("/sign-in");

  const entitlements = await gatewayDeps.entitlements(identity.orgId);
  /**
   * Rank and roster together. `identify` read both off the membership row, and every gate
   * below takes the pair, so a page guard, a sidebar entry and the gateway itself all answer
   * the station question from the same grant instead of three of them answering half of it.
   */
  const grant: Grant = { role: identity.role, stations: identity.stations };
  const permissions = permissionsFor(grant);

  const pathname = requestHeaders.get("x-pathname") ?? "/";
  const resource = resourceForPath(pathname);
  if (resource) {
    const access = navAccess(resource, grant, entitlements);
    if (!access.visible) redirect("/projects");
    if (access.locked) redirect(`/billing?locked=${resource}`);
  }

  const nav = navFor(grant, entitlements);

  return (
    <ViewerProvider value={{ entitlements, permissions, role: identity.role }}>
      <AppUpgradeModal current={entitlements.plan} />
      <div className="flex min-h-dvh">
        <Sidebar items={nav} plan={entitlements.plan} nudge={nudgeFor(entitlements.plan)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar role={identity.role} />
          {/* Under the bar rather than above it, so it scrolls away once it has been read
              instead of permanently costing a row of a phone's screen. */}
          <OverPlanBanner rows={planOverages(entitlements).map((row) => row.label)} />
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
        {/* The same access decisions the sidebar made, rendered where a thumb can reach. */}
        <MobileNav items={nav} />
      </div>
    </ViewerProvider>
  );
}
