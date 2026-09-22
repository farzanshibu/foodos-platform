/**
 * SOT: separator, divider
 * WHAT   A one-pixel rule between sections.
 * WHY    Decorative by default: a divider that a screen reader announces is noise, so it is
 *        aria-hidden unless a caller says it separates something meaningful.
 */
import type * as React from "react";

import { cn } from "../../lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  readonly orientation?: "horizontal" | "vertical";
  readonly decorative?: boolean;
}) {
  return (
    <div
      // A decorative rule is removed from the tree entirely; a meaningful one is a separator
      // and only then may it declare an orientation.
      {...(decorative
        ? { role: "none" as const }
        : { role: "separator" as const, "aria-orientation": orientation })}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
