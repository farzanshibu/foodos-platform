/**
 * SOT: sign-out, logout-button, end-session-ui
 * WHAT   The one control that ends a staff session.
 * WHY    The auth client could sign out, but no screen offered it: the only way to stop being
 *        an owner was to clear cookies. That also made the customer view impossible to test
 *        from the same browser, because staff identity wins over a guest ticket.
 * HOW    Signs out through the auth client, then does a full navigation to /sign-in rather
 *        than a router push, so every server-rendered page and the cached viewer context are
 *        dropped with the cookie instead of lingering on screen.
 * WHERE  apps/web/src/components/sidebar.tsx, apps/web/src/components/topbar.tsx
 */
"use client";

import { signOut } from "@foodos/auth/client";
import { Button } from "@foodos/ui/button";
import { LogOut } from "lucide-react";
import { useState } from "react";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/sign-in");
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => {
        void leave();
      }}
      className={compact ? "px-2" : "w-full justify-start gap-2 text-muted-foreground"}
      aria-label="Sign out"
    >
      <LogOut className="size-4" aria-hidden="true" />
      {compact ? null : <span>{busy ? "Signing out…" : "Sign out"}</span>}
    </Button>
  );
}
