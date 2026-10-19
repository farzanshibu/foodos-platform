/**
 * SOT: table-layout, guest-shell, qr-session-header
 * WHAT   The shell every screen a guest sees sits inside: where they are, and how to get
 *        between the menu, their orders and asking for something.
 * WHY    A person at a table is holding a phone one-handed and has not installed anything.
 *        The navigation is at the bottom where a thumb reaches, the header says which table
 *        they are at so they can tell they scanned the right one, and nothing here needs an
 *        account.
 * HOW    The session comes from the signed ticket the scan page set. No session means the
 *        cookie expired or the code was revoked, so the only honest thing to show is "scan
 *        again" rather than an empty menu.
 * WHERE  apps/web/src/app/q/[token], apps/web/src/gateway/guest-session.ts
 */

import { SESSION_COOKIE_NAMES } from "@foodos/auth/session";
import { cookies } from "next/headers";

import { ScanFailed, StaffOnGuestSurface } from "@/features/qr/scan-failed";
import { GuestNav } from "@/features/table/guest-nav";
import { TableCartProvider } from "@/features/table/table-cart-provider";
import { ThemeToggle } from "@/features/table/theme";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function TableLayout({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof api.qrSession.current>>;
  try {
    session = await api.qrSession.current({});
  } catch {
    // Presence of a staff cookie only: this is for the person holding it, not a probe.
    const jar = await cookies();
    return SESSION_COOKIE_NAMES.some((name) => jar.has(name)) ? (
      <StaffOnGuestSurface />
    ) : (
      <ScanFailed />
    );
  }

  const { context } = session;
  const where = [
    context.placeLabel === null
      ? null
      : `${context.placeKind === "seat" ? "Seat" : "Table"} ${context.placeLabel}`,
    context.placeCapacity === null || context.placeKind === "seat"
      ? null
      : `${String(context.placeCapacity)} seats`,
    ...context.placeParameters.map((parameter) => parameter.value),
  ].filter((part): part is string => part !== null);

  /**
   * A scan that named a place is a person sitting somewhere, and everybody sitting at that
   * place shares one basket. A scan that named none is a walk-in whose basket stays their own
   * until staff seat them.
   */
  const seated = context.placeId !== null;

  return (
    <TableCartProvider seated={seated} pollSeconds={session.pollIntervalSeconds}>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="sticky top-0 z-10 border-border border-b bg-card/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
            {context.logoUrl === null ? null : (
              // biome-ignore lint/performance/noImgElement: one small remote logo, no loader needed
              <img
                src={context.logoUrl}
                alt=""
                className="size-10 shrink-0 rounded-full border border-border object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{context.restaurantName}</p>
              <p className="truncate text-muted-foreground text-xs">
                {where.length === 0 ? (context.branchName ?? "") : where.join(" · ")}
              </p>
            </div>
            {/* Dim is what people leave on at a dinner table or in a darkened screen. */}
            <ThemeToggle className="shrink-0" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-28">{children}</main>

        <GuestNav
          orderingEnabled={context.orderingEnabled}
          requestsEnabled={context.requestsEnabled}
        />
      </div>
    </TableCartProvider>
  );
}
