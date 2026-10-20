/**
 * SOT: nav-section, sidebar-group, collapsible-nav, nav-group-state
 * WHAT   One sidebar group that folds away, so a twenty-item nav is a screenful of headings
 *        rather than a scroll.
 * WHY    The registry derives every group, and a full owner sees all of them. Showing every
 *        item at once made the sidebar longer than the window, and the part people reach for
 *        - their plan, the theme - sat below the fold. Folding is the cheapest fix that keeps
 *        every page one click away.
 * HOW    A group opens by default when it holds the current page, or when it is the first
 *        group, so the page you are on is never hidden and a new visit is not a wall of
 *        closed headings. A person's own open/close choice is kept per device and wins after
 *        the first paint; reading it in an effect keeps server and client markup identical.
 * WHERE  apps/web/src/components/sidebar.tsx
 */
"use client";

import type { NavEntryAccess } from "@foodos/registry";
import { cn } from "@foodos/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { NavLink } from "@/components/nav-link";
import { isCurrent } from "@/components/nav-links";

const STORAGE_PREFIX = "foodos:nav:";

export function NavSection({
  group,
  items,
  first,
}: {
  group: string;
  items: readonly NavEntryAccess[];
  first: boolean;
}) {
  const pathname = usePathname();
  const holdsCurrent = items.some((item) => isCurrent(pathname, item.href));
  const [chosen, setChosen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${group}`);
      if (stored === "open") setChosen(true);
      if (stored === "closed") setChosen(false);
    } catch {
      // Storage can be blocked; the default open state is still correct.
    }
  }, [group]);

  // The current page's group is never folded shut under you, whatever was chosen before.
  const open = holdsCurrent || (chosen ?? first);

  function toggle() {
    const next = !open;
    setChosen(next);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${group}`, next ? "open" : "closed");
    } catch {
      // Not persisted; the in-memory choice still applies for this visit.
    }
  }

  const listId = `nav-group-${group.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="mb-1 last:mb-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 font-semibold text-[11px] text-primary uppercase tracking-[0.1em] transition-colors duration-150 hover:bg-primary/5"
      >
        <span>{group}</span>
        <ChevronRight
          className={cn("size-3.5 text-primary/70 transition-transform duration-150", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      <ul
        id={listId}
        hidden={!open}
        // A guide line the points sit on, indented under its heading: main > sub.
        className="mt-0.5 mb-1.5 ml-3.5 space-y-px border-border border-l pl-3"
      >
        {items.map((item) => (
          <li key={item.href}>
            <NavLink item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
