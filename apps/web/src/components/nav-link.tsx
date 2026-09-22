/**
 * SOT: nav-link, sidebar-link, active-nav-item
 * WHAT   One row of the sidebar: label, current-page marking, and the lock a plan puts on it.
 * WHY    Split out of the sidebar because knowing the current page needs `usePathname`, and
 *        that would drag the whole nav - and the registry derivations behind it - into the
 *        client bundle. This is the smallest thing that has to be a client component.
 * WHERE  apps/web/src/components/sidebar.tsx
 */
"use client";

import type { NavEntryAccess } from "@foodos/registry";
import { cn } from "@foodos/ui/lib/utils";
import { Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { billingHref, isCurrent, route } from "@/components/nav-links";

export function NavLink({ item }: { item: NavEntryAccess }) {
  const pathname = usePathname();
  const current = isCurrent(pathname, item.href);

  return (
    <Link
      href={route(
        item.locked && billingHref !== undefined
          ? `${billingHref}?locked=${item.resource}`
          : item.href,
      )}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
        "transition-colors duration-[var(--duration-hover)] ease-[var(--ease-out)]",
        current
          ? "bg-card font-medium text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        item.locked && !current && "text-muted-foreground/70",
      )}
    >
      {/* Not colour alone: the current item also carries a rail and aria-current. */}
      {current ? (
        <span className="-left-3 absolute h-4 w-0.5 rounded-full bg-primary" aria-hidden="true" />
      ) : null}
      <span className="truncate">{item.label}</span>
      {item.locked ? (
        <>
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Not included in your plan</span>
        </>
      ) : null}
    </Link>
  );
}
