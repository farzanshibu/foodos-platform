/**
 * SOT: manage-more, mobile-overflow
 * WHAT   Everything the phone's bottom bar does not have room for.
 * WHY    The bottom bar carries the four things somebody does mid-shift. This is the rest of
 *        the sidebar, rendered as a list a thumb can hit, gated by exactly the same registry
 *        decisions - so nothing appears here that would redirect on arrival.
 * WHERE  apps/web/src/components/mobile-nav.tsx, apps/web/src/app/(dashboard)/layout.tsx
 */
import { identify } from "@foodos/auth";
import { NAV_GROUPS, navFor } from "@foodos/registry";
import { Card, CardContent } from "@foodos/ui/card";
import { ChevronRight, Lock } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { route } from "@/components/nav-links";
import { PageShell } from "@/features/manage/page-shell";
import { gatewayDeps } from "@/gateway/deps";

export const dynamic = "force-dynamic";

export default async function ManageMorePage() {
  const identity = await identify(await headers());
  if (identity === null) redirect("/sign-in");

  const entitlements = await gatewayDeps.entitlements(identity.orgId);
  // The same grant the layout builds: rank and roster, so a post somebody is not on does
  // not appear here either.
  const items = navFor({ role: identity.role, stations: identity.stations }, entitlements);

  const sections = NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);

  return (
    <PageShell title="Everything else" description="Everything the bottom bar has no room for.">
      {/* Grouped rows in one card per section, not a card per link. Forty identical cards
          is a wall to scroll past; a divided list is the shape a phone settings screen has
          for the same reason - the eye reads the group heading and skips the rest. */}
      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.group} className="space-y-1.5">
            <h2 className="px-1 font-medium text-2xs text-muted-foreground uppercase tracking-[0.08em]">
              {section.group}
            </h2>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={route(item.href)}
                        className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-sm transition-colors duration-150 active:bg-secondary"
                      >
                        <span className="truncate text-foreground">{item.label}</span>
                        {item.locked ? (
                          <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                            <Lock className="size-3.5" aria-hidden="true" />
                            Upgrade
                          </span>
                        ) : (
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
