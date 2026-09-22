/**
 * SOT: button, button-variants, button-states
 * WHAT   The one button vocabulary the platform uses.
 * WHY    Every interactive control ships all its states - default, hover, active, focus,
 *        disabled, loading - because half a state set is what makes an interface feel
 *        unfinished. `loading` is a prop rather than a caller's job, so a pending mutation
 *        looks the same on every screen and the button cannot be pressed twice.
 * HOW    Height steps are 32/36/40px with a 44px `touch` size for anything a thumb hits on
 *        a phone (HIG minimum target). Motion is 150ms, state only.
 */
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap",
    // Named properties, never `transition: all` - a button that transitions everything also
    // transitions its width when the label changes, which is how a spinner swap wobbles.
    "rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform]",
    "duration-[var(--duration-press)] ease-[var(--ease-out)]",
    "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95",
        outline:
          "border border-input bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5 text-base",
        touch: "h-11 px-4 text-sm",
        icon: "size-9",
        "icon-sm": "size-8 [&_svg]:size-3.5",
        "icon-touch": "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Renders a spinner and blocks the press. The label stays put so the button never resizes. */
    readonly loading?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, children, disabled, type, ...props }, ref) => (
    <button
      ref={ref}
      // An unlabelled <button> inside a form submits it. Callers that want that pass it.
      type={type ?? "button"}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="absolute size-4 animate-spin" aria-hidden="true" /> : null}
      {/* A real flex item, not `contents`: as an anonymous text run the label inherits
          flex-shrink and the browser squeezes it narrower than the word, which is what was
          clipping "Create project" to "Create projec". */}
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
          loading && "invisible",
        )}
      >
        {children}
      </span>
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
