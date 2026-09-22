/**
 * SOT: input, text-field, form-control-shape
 * WHAT   The shape every text control in the platform borrows: height, radius, border,
 *        focus ring, invalid state.
 * WHY    Written once so a select, a textarea and an input sitting in the same row are the
 *        same height and the same colour. A form where the controls disagree by two pixels
 *        is the thing that makes an interface feel homemade.
 */
import * as React from "react";

import { cn } from "../../lib/utils";

/** Shared by input, textarea and select. Not exported beyond the package's own controls. */
export const controlClass = [
  "w-full rounded-md border border-input bg-card text-foreground shadow-xs",
  "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out)]",
  "placeholder:text-muted-foreground",
  "hover:border-border-strong",
  "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive",
].join(" ");

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(controlClass, "h-9 px-3 py-1 text-sm", className)}
    {...props}
  />
));
Input.displayName = "Input";
