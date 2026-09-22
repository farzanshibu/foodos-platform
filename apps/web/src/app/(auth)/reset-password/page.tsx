/**
 * SOT: reset-password, password-reset-confirm, auth-surface
 * WHAT   The screen the emailed link lands on, where the token becomes a new password.
 * WHY    The link carries the token in its query string; without this page the email is a
 *        dead end. A missing token is said so plainly instead of posting to the provider
 *        and waiting for a confusing refusal.
 * HOW    resetPassword from @foodos/auth/client with the token taken from the URL the
 *        provider redirected to. Success returns the user to sign-in.
 * HOW    The token is read in an effect, not during render: `window` does not exist while
 *        this page is prerendered, and reading it at module time is what broke the build.
 *        The button waits for the read rather than guessing, so a slow hydration cannot
 *        produce "missing token" on a link that has one.
 * WHERE  apps/web/src/app/(auth)/forgot-password/page.tsx
 */
"use client";

import { resetPassword } from "@foodos/auth/client";
import { Alert } from "@foodos/ui/alert";
import { Button } from "@foodos/ui/button";
import { Field } from "@foodos/ui/field";
import { Input } from "@foodos/ui/input";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  /** `undefined` while the URL has not been read yet; `null` once it is read and absent. */
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function handleReset() {
    if (token === null || token === undefined) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    setError(null);
    setPending(true);
    const result = await resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) setError(result.error.message ?? "That did not work. Try again.");
    else setDone(true);
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Eight characters or more. It replaces the old one immediately."
      error={error}
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      {done ? (
        <Alert tone="success">Password updated. You can sign in with it now.</Alert>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleReset();
          }}
        >
          <Field label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={password.length < 8 || token === undefined}
            loading={pending}
          >
            Set password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
