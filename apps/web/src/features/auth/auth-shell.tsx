/**
 * SOT: auth-shell, auth-error-banner, one-auth-surface
 * WHAT   The shared frame every auth screen sits in, and the one error banner they share.
 * WHY    Sign in, sign up, forgot/reset password and invite accept were each rolling their
 *        own centred column and their own error paragraph, so failures looked different on
 *        every screen. One shell means one place a mistake is described - always as a
 *        sentence, never as a raw provider error code.
 * WHY    A card on a tinted page, not a bare column: the front door is the first thing a
 *        customer sees, and a form floating on white reads as unfinished. The mark and the
 *        product name sit above it so the page says whose door it is.
 * HOW    <AuthShell title="…" error={messageOrNull}>…</AuthShell>. The message is whatever
 *        the caller took from the provider's result; null renders nothing.
 * WHERE  apps/web/src/app/(auth)/*
 */
import { Alert } from "@foodos/ui/alert";

export function AuthShell({
  title,
  subtitle,
  error,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly error: string | null;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 py-12">
      <div className="w-full max-w-[22rem] space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="size-5 rounded-[6px] bg-primary" aria-hidden="true" />
          <span className="font-semibold text-[15px] tracking-[-0.01em]">FoodOS</span>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 space-y-1">
            <h1 className="font-semibold text-foreground text-xl tracking-[-0.015em]">{title}</h1>
            {subtitle === undefined ? null : (
              <p className="text-muted-foreground text-sm">{subtitle}</p>
            )}
          </div>

          {error === null ? null : (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}

          <div className="space-y-3">{children}</div>
        </div>

        {footer === undefined ? null : (
          <div className="text-center text-muted-foreground text-sm [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
