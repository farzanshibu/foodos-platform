/**
 * SOT: textarea, multiline-field
 * WHAT   A multi-line control wearing the same shape as <Input>.
 */
import * as React from "react";

import { cn } from "../../lib/utils";
import { controlClass } from "./input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlClass, "min-h-20 px-3 py-2 text-sm leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
