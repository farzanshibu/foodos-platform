/**
 * SOT: badge, status-badge, badge-variants
 * WHAT   A small, quiet label for status and counts.
 * WHY    Status is never colour alone - every semantic variant pairs a tinted background
 *        with readable text, and callers are expected to put a word in it. Colour-blind
 *        users and greyscale printouts both get the same information.
 */
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-xs [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        destructive: "border-destructive/25 bg-destructive/10 text-destructive",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/15 text-warning-foreground",
        info: "border-info/25 bg-info/10 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
