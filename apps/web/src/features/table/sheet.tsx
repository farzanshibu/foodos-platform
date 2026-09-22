/**
 * SOT: bottom-sheet, guest-sheet
 * WHAT   The sheet that slides up from the bottom for picking a dish or a combo.
 * WHY    A modal in the middle of a phone screen puts its actions under the person's hand.
 *        This one is anchored to the bottom, so the confirm button lands where the thumb
 *        already is, and it caps at most of the viewport rather than all of it so the
 *        backdrop is still visibly there to tap.
 * HOW    It slides up rather than appearing, because a sheet that teleports gives no clue
 *        which way to send it back - the entrance is the instruction for the exit. 280ms on
 *        the iOS drawer curve, transform only, and the backdrop fades separately so the two
 *        do not look welded together. Both collapse to a plain fade under reduced motion.
 */
"use client";

import { useEffect } from "react";

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-backdrop bg-foreground/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85dvh] w-full max-w-2xl animate-sheet flex-col rounded-t-2xl border-border border-t bg-card shadow-lg"
      >
        <header className="flex items-start justify-between gap-3 border-border border-b px-4 py-3">
          <h2 className="font-semibold text-foreground text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground"
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        <footer className="border-border border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      </div>
    </div>
  );
}
