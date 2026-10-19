/**
 * SOT: mobile-nav, manage-bottom-nav, one-handed
 * WHAT   The bottom bar the management app uses on a phone.
 * WHY    A waiter is walking, holding a phone in one hand, and the sidebar is 200px of screen
 *        they do not have. This is not the sidebar shrunk - it is the four things somebody
 *        actually does mid-shift, with everything else behind More.
 * HOW    Which four is decided by what the role and plan already allow, so a kitchen user
 *        does not get a link to a page that will redirect them.
 * HOW    Each target is 56px tall and the bar carries the home-indicator inset, because the
 *        bottom 34px of an iPhone belongs to the system, not to us. Icon plus label, since a
 *        five-item bar of words alone is unreadable at a glance mid-service.
 * WHERE  apps/web/src/components/sidebar.tsx, packages/registry/src/derive.ts
 */
"use client";

import type { NavEntryAccess } from "@foodos/registry";
import { cn } from "@foodos/ui/lib/utils";
import { ChefHat, Ellipsis, HandPlatter, LayoutGrid, ReceiptText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isCurrent, route } from "@/components/nav-links";

/** The shift-time four, in the order a phone should offer them, each with its glyph. */
const PRIMARY = [
  { resource: "order", icon: ReceiptText },
  { resource: "kitchenTicket", icon: ChefHat },
  { resource: "place", icon: LayoutGrid },
  { resource: "serviceRequest", icon: HandPlatter },
] as const;

export function MobileNav({ items }: { items: readonly NavEntryAccess[] }) {
  const pathname = usePathname();

  const primary = PRIMARY.flatMap(({ resource, icon }) => {
    const found = items.find((item) => item.resource === resource && !item.locked);
    return found === undefined ? [] : [{ item: found, icon }];
  });

  if (primary.length === 0) return null;

  return (
    <nav
      aria-label="Shift"
      className="fixed inset-x-0 bottom-0 z-30 border-border border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="flex">
        {primary.map(({ item, icon }) => (
          <li key={item.href} className="flex-1">
            <BarLink
              href={item.href}
              label={item.label}
              active={isCurrent(pathname, item.href)}
              icon={icon}
            />
          </li>
        ))}
        <li className="flex-1">
          <BarLink
            href="/manage/more"
            label="More"
            active={isCurrent(pathname, "/manage/more")}
            icon={Ellipsis}
          />
        </li>
      </ul>
    </nav>
  );
}

function BarLink({
  href,
  label,
  active,
  icon: Icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: typeof Ellipsis;
}) {
  return (
    <Link
      prefetch={false}
      href={route(href)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 transition-colors duration-150",
        active ? "text-primary" : "text-muted-foreground active:text-foreground",
      )}
    >
      <Icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden="true" />
      <span className="max-w-full truncate px-1 text-2xs leading-none">{label}</span>
    </Link>
  );
}
