/**
 * SOT: sidebar, nav-ui, locked-nav, plan-badge-usage, sidebar-nudge, nav-active-state
 * WHAT   The navigation, with the plan half of each item's access actually rendered - and
 *        the one nudge card the whole app is allowed.
 * WHY    `navAccess` returns {visible, locked} and the sidebar used only `visible`, so an
 *        item the plan does not include looked exactly like one it does. Clicking it hit
 *        the layout's redirect and dropped the user on /billing with no explanation. A
 *        locked item is an upgrade prompt; hiding the difference wastes both the prompt and
 *        the click.
 * WHY    The current page is marked, because a nav that never says where you are is a nav
 *        you have to re-read on every page. The marker is a filled surface plus a left rail
 *        plus `aria-current`, so it survives greyscale and a screen reader.
 * WHY    The nudge lives here because it sits above the profile where eyes already go. Its
 *        copy arrives fully composed from the layout's registry derivations - trial length,
 *        next tier, real yearly savings - so this file cannot invent a number. It is null
 *        on the top plan and simply does not render.
 * HOW    A locked item is still a link - it goes somewhere useful - so it is not
 *        `aria-disabled`. It points at billing with `?locked=<resource>`, which the billing
 *        page reads to render that resource's own upgrade copy.
 * WHY    Sections come from NAV_GROUPS, which the registry derives from the group each
 *        resource declares. A hand-written section list beside a derived nav is the second
 *        source of truth the registry exists to prevent, and it is the one that goes stale
 *        the first time somebody adds a page and forgets the list.
 * HOW    The active check needs the URL, so the links are a small client component; the
 *        sidebar itself stays a server component and the nav never enters the client bundle
 *        twice.
 * WHERE  packages/registry/src/derive.ts (navFor, NAV_GROUPS), apps/web/src/app/(dashboard)/layout.tsx
 */

import { NAV_GROUPS, type NavEntryAccess, type PlanKey } from "@foodos/registry";
import { PlanBadge } from "@foodos/ui/plan-badge";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { NavLink } from "@/components/nav-link";
import { billingHref, route } from "@/components/nav-links";
import { NavSection } from "@/components/nav-section";
import { ThemeToggle } from "@/features/table/theme";

export type SidebarNudge = { readonly title: string; readonly detail: string | null };

export function Sidebar({
  items,
  plan,
  nudge,
}: {
  items: readonly NavEntryAccess[];
  plan: PlanKey;
  nudge: SidebarNudge | null;
}) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start border-border border-r bg-surface md:flex"
    >
      <div className="flex h-12 items-center gap-2 border-border border-b px-4">
        <span className="size-5 rounded-[6px] bg-primary" aria-hidden="true" />
        <span className="font-semibold text-[15px] tracking-[-0.01em]">FoodOS</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sectionsOf(items).map((section, index) =>
          section.group === null ? (
            <ul key="_" className="space-y-0.5 pt-2">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <NavSection
              key={section.group}
              group={section.group}
              items={section.items}
              first={index === 0}
            />
          ),
        )}
      </div>

      <div className="space-y-2 border-border border-t p-2.5">
        {nudge === null ? null : (
          <Link
            className="group block rounded-md border border-border bg-card p-3 text-sm shadow-xs transition-colors duration-150 hover:border-border-strong hover:bg-accent"
            href={route(billingHref ?? "/")}
          >
            <span className="flex items-start justify-between gap-2 font-medium leading-snug">
              {nudge.title}
              <ArrowUpRight
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
                aria-hidden="true"
              />
            </span>
            {nudge.detail === null ? null : (
              <span className="mt-1 block text-muted-foreground text-xs leading-snug">
                {nudge.detail}
              </span>
            )}
          </Link>
        )}
        <div className="flex items-center justify-between gap-2">
          <PlanBadge plan={plan} />
          {/* Dim is what a pass tablet wants after dark; the choice is per device. */}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

type Section = { group: string | null; items: readonly NavEntryAccess[] };

/** Grouped in the registry's own group order; anything ungrouped sits loose at the end. */
function sectionsOf(items: readonly NavEntryAccess[]): readonly Section[] {
  const grouped: Section[] = NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);

  const loose = items.filter((item) => item.group === undefined);
  return loose.length === 0 ? grouped : [...grouped, { group: null, items: loose }];
}
