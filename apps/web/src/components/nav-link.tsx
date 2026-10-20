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
      // Each prefetch of a dynamic page is a server render, and each server instance holds its
      // own bus connection; a free-tier bus caps those, so nav links load on click instead.
      prefetch={false}
      href={route(
        item.locked && billingHref !== undefined
          ? `${billingHref}?locked=${item.resource}`
          : item.href,
      )}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group/nav relative flex items-center justify-between gap-2 rounded-md px-2.5 py-1 text-[13px] leading-5",
        "transition-colors duration-[var(--duration-hover)] ease-[var(--ease-out)]",
        current
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        item.locked && !current && "text-muted-foreground/70",
      )}
    >
      {/* The point marking a sub-item. Not colour alone: the current one is also larger,
          filled and carries aria-current, so it survives greyscale. */}
      <span
        className={cn(
          "absolute top-1/2 left-[-12.5px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
          current
            ? "size-2 bg-primary ring-4 ring-background"
            : "size-1.5 bg-border-strong group-hover/nav:bg-primary/60",
        )}
        aria-hidden="true"
      />
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
