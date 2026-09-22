/**
 * SOT: forgot-password, password-reset-request, auth-surface
 * WHAT   The ask-for-a-reset-link screen.
 * WHY    Without it a locked-out customer has no path back in. The delivery itself is the
 *        provider's job; this page only asks for it and reports what happened - including
 *        the same sentence for unknown emails, so the form cannot be used to learn who has
 *        an account.
 * HOW    forgetPassword from @foodos/auth/client with redirectTo pointing at
 *        /reset-password, where the token in the link is exchanged for a new password.
 * WHERE  apps/web/src/app/(auth)/reset-password/page.tsx, packages/auth/src/auth.ts
 */
"use client";

import { requestPasswordReset } from "@foodos/auth/client";
import { Alert } from "@foodos/ui/alert";
import { Button } from "@foodos/ui/button";
import { Field } from "@foodos/ui/field";
import { Input } from "@foodos/ui/input";
import Link from "next/link";
import { useState } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSend() {
    setError(null);
    setPending(true);
    const result = await requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work. Check your details.");
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link that sets a new one."
      error={error}
      footer={
        <span>
          Remembered it? <Link href="/sign-in">Sign in</Link>
        </span>
      }
    >
      {sent ? (
        <Alert tone="success">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
