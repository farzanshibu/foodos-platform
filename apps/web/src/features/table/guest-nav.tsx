/**
 * SOT: guest-nav, bottom-nav, thumb-reach
 * WHAT   The bottom bar a guest moves around with.
 * WHY    Bottom rather than top because the person using it is standing at a table holding a
 *        phone in one hand. Items appear only when the code they scanned actually allows them:
 *        a menu-only code shows no cart, and a code with no table shows no request button.
 * HOW    The same line icons and the same 56px target as the staff bar, because it is the
 *        same product. Emoji rendered as four different illustration styles at four
 *        different weights, and each one is a different picture on Android than on iOS.
 * HOW    The bar carries the home-indicator inset: the bottom of an iPhone belongs to the
 *        system, and a tab under it is a tab nobody can press.
 */
"use client";

import { cn } from "@foodos/ui/lib/utils";
import { BellRing, Clock3, type LucideIcon, ScrollText, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { route } from "@/components/nav-links";

type Entry = { href: string; label: string; icon: LucideIcon };

export function GuestNav({
  orderingEnabled,
  requestsEnabled,
}: {
  orderingEnabled: boolean;
  requestsEnabled: boolean;
}) {
  const pathname = usePathname();

  const entries: Entry[] = [
    { href: "/t", label: "Menu", icon: UtensilsCrossed },
    ...(orderingEnabled ? [{ href: "/t/cart", label: "Cart", icon: ScrollText }] : []),
    ...(orderingEnabled ? [{ href: "/t/orders", label: "Orders", icon: Clock3 }] : []),
    ...(requestsEnabled ? [{ href: "/t/requests", label: "Ask", icon: BellRing }] : []),
  ];

  return (
    <nav
      aria-label="Table"
      className="fixed inset-x-0 bottom-0 z-30 border-border border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto flex w-full max-w-2xl">
        {entries.map((entry) => {
          const active = pathname === entry.href;
          const Icon = entry.icon;
          return (
            <li key={entry.href} className="flex-1">
              <Link
                href={route(entry.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground active:text-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden="true" />
                <span className="text-2xs leading-none">{entry.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
