/**
 * SOT: card, panel, surface
 * WHAT   A bordered surface for content that belongs together.
 * WHY    Elevation comes from a token, not an ad-hoc shadow, and the default is flat: a card
 *        on this platform is a boundary, not a floating object. `elevated` exists for the
 *        few things that genuinely sit above the page.
 * NOTE   Nested cards are always wrong. If you are about to put a Card inside a Card, what
 *        you want is a divided section or a list row.
 */
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const cardVariants = cva("rounded-lg border bg-card text-card-foreground", {
  variants: {
    variant: {
      default: "border-border shadow-xs",
      elevated: "border-border shadow-md",
      flat: "border-border shadow-none",
      dashed: "border-border border-dashed shadow-none",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Card({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-border border-b px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-semibold text-base leading-none tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-border border-t bg-surface/60 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

export { cardVariants };
