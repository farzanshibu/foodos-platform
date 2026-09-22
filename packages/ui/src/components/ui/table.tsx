/**
 * SOT: table, data-table, sticky-header
 * WHAT   The data table: a sticky header, quiet zebra-free rows, and numbers that line up.
 * WHY    Density is a feature here - a manager scanning fifty orders wants rows, not cards -
 *        so the row height is compact and the separator does the work instead of a fill.
 * HOW    The header sticks because these tables scroll inside a page, and a header that
 *        scrolls away turns column six into a guess.
 */
import type * as React from "react";

import { cn } from "../../lib/utils";

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("sticky top-0 z-10 bg-surface [&_tr]:border-border [&_tr]:border-b", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-border border-b transition-colors duration-150 hover:bg-surface data-[state=selected]:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wide",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-3 text-muted-foreground text-sm", className)} {...props} />;
}
