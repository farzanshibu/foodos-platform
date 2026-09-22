/**
 * SOT: empty-state, zero-state, empty-list
 * WHAT   What a surface says when it holds nothing yet.
 * WHY    "No data" teaches nobody anything. An empty state names the thing, says why it is
 *        worth having, and offers the action that creates the first one - it is the cheapest
 *        onboarding in the product.
 * HOW    <EmptyState icon={<Plus/>} title="No menus yet" detail="…" action={<Button…/>} />
 */
import type * as React from "react";

import { cn } from "../../lib/utils";

export function EmptyState({
  icon,
  title,
  detail,
  action,
  className,
}: {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly detail?: string;
  readonly action?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {icon === undefined ? null : (
        <div
          className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium text-foreground text-sm">{title}</p>
        {detail === undefined ? null : (
          <p className="mx-auto max-w-sm text-muted-foreground text-sm">{detail}</p>
        )}
      </div>
      {action}
    </div>
  );
}
