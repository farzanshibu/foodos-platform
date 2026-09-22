/**
 * SOT: select, native-select
 * WHAT   The native <select>, wearing the same shape as <Input>.
 * WHY    Five screens were hand-writing a border and a height onto a bare <select>, and
 *        three of them disagreed. A native select is the right control here - it is the one
 *        a phone renders as a wheel and a screen reader already knows - so it is styled,
 *        not replaced with a custom listbox.
 * HOW    The chevron is drawn by us because `appearance-none` removes the platform's own,
 *        and it is `pointer-events-none` so the click still lands on the select.
 */
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";
import { controlClass } from "./input";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  // The wrapper takes the caller's width so a select in a filter row sits beside its
  // neighbours instead of claiming the whole line; `w-full` on the select fills whatever
  // that turns out to be.
  <div className={cn("relative inline-flex items-center", className)}>
    <select
      ref={ref}
      className={cn(controlClass, "h-9 appearance-none py-1 pr-8 pl-3 text-sm")}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
));
Select.displayName = "Select";
