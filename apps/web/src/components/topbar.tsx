/**
 * SOT: topbar, app-header, page-title, mobile-header
 * WHAT   The bar above every dashboard page: where you are, and who you are here as.
 * WHY    A phone has no sidebar, so without this there is nothing on screen naming the
 *        current page or offering the theme switch. On a laptop it gives the content column
 *        a top edge, which is what stops a dense table from starting flush against the
 *        window.
 * HOW    The title comes from the registry entry for the current path, so it cannot disagree
 *        with the nav item that got you here, and a route the registry does not own falls
 *        back to the product name rather than inventing a heading.
 * WHERE  packages/registry/src/derive.ts (NAV_ITEMS), apps/web/src/components/sidebar.tsx
 */
"use client";

import { NAV_ITEMS, ORG_ROLES, type OrgRole } from "@foodos/registry";
import { Badge } from "@foodos/ui/badge";
import { usePathname } from "next/navigation";

import { isCurrent } from "@/components/nav-links";
import { ThemeToggle } from "@/features/table/theme";

/** Longest prefix wins, so /manage/orders/42 is still "Orders". */
function titleFor(pathname: string): string {
  let best: { label: string; length: number } | null = null;
  for (const item of NAV_ITEMS) {
    if (isCurrent(pathname, item.href) && (best === null || item.href.length > best.length)) {
      best = { label: item.label, length: item.href.length };
    }
  }
  return best === null ? "FoodOS" : best.label;
}

export function Topbar({ role }: { readonly role: OrgRole }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-border border-b bg-surface/80 px-4 backdrop-blur-xl backdrop-saturate-[1.8] md:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-5 shrink-0 rounded-[6px] bg-primary md:hidden" aria-hidden="true" />
        <p className="truncate font-medium text-sm">{titleFor(pathname)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Rank, in the registry's own words. Useful precisely when a control is missing. */}
        <Badge variant="outline" className="capitalize">
          {ORG_ROLES.includes(role) ? role : "member"}
        </Badge>
        {/* The sidebar carries this on a laptop; a phone has no sidebar. */}
        <ThemeToggle className="md:hidden" />
      </div>
    </header>
  );
}
