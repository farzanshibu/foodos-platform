/**
 * SOT: theme-toggle, dim-mode, dark-mode, theme-persistence
 * WHAT   The light / dim / dark switch, and the script that stops it flashing on load.
 * WHY    Three because two is not enough for this product. Staff read a pass in a bright
 *        kitchen; guests read a menu at a candlelit table or in a darkened cinema. Full dark
 *        is too much contrast to glance at, full light is a torch in somebody's face, and dim
 *        is the one people actually leave on in the evening.
 * HOW    The choice is written to <html data-theme> and to localStorage. The inline script
 *        below runs BEFORE paint, so a returning visitor never sees a white flash - which is
 *        the entire reason a theme toggle is a layout concern and not a component one.
 * WHERE  apps/web/src/app/globals.css, apps/web/src/app/layout.tsx
 */
"use client";

import { cn } from "@foodos/ui/lib/utils";
import { Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";

export const THEMES = ["light", "dim", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "foodos.theme";

function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.some((candidate) => candidate === value);
}

function apply(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * Runs before React, before paint, before anything renders. Inlined as a string because a
 * module would arrive too late and the flash is the whole thing being prevented.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="light"||t==="dim"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

/** Sun, half-lit, moon. Read left to right, the row is a dimmer, which is what it is. */
const ICONS = { light: Sun, dim: SunMoon, dark: Moon } as const;

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const held = localStorage.getItem(KEY);
    setTheme(isTheme(held) ? held : null);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /** Private browsing with storage denied. The choice still holds for this visit. */
    }
  };

  return (
    <fieldset
      className={cn(
        "inline-flex gap-0.5 rounded-full border border-border bg-card p-0.5",
        className,
      )}
      aria-label="Theme"
    >
      {THEMES.map((entry) => {
        const Icon = ICONS[entry];
        return (
          <button
            key={entry}
            type="button"
            aria-pressed={theme === entry}
            onClick={() => {
              choose(entry);
            }}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-colors duration-150",
              theme === entry
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {/* The glyph is the affordance; the word is what a screen reader hears. */}
            <span className="sr-only capitalize">{entry}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
