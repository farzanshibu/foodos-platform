/**
 * SOT: alert, banner, inline-message
 * WHAT   An inline message: a note, a warning, a refusal.
 * WHY    Every screen was inventing its own tinted paragraph, so a denial on one page looked
 *        like a hint on another. One component, four tones, each carrying an icon as well as
 *        a colour so the meaning survives greyscale and colour blindness.
 * HOW    `role` follows the tone: a danger or warning is a live alert, a note is a status.
 */
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils";

const alertVariants = cva("flex gap-2.5 rounded-md border px-3.5 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-info/25 bg-info/8 text-foreground [&_svg]:text-info",
      success: "border-success/25 bg-success/8 text-foreground [&_svg]:text-success",
      warning: "border-warning/30 bg-warning/12 text-foreground [&_svg]:text-warning",
      danger: "border-destructive/25 bg-destructive/8 text-foreground [&_svg]:text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { readonly title?: string };

export function Alert({ className, tone, title, children, ...props }: AlertProps) {
  const key = tone ?? "info";
  const Icon = ICONS[key];
  return (
    <div
      role={key === "danger" || key === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {title === undefined ? null : <p className="font-medium">{title}</p>}
        {children === undefined ? null : (
          <div className="text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export { alertVariants };
