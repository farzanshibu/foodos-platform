/**
 * SOT: sign-in, auth-surface, callback-return
 * WHAT   The front door - and the way back to wherever you were headed.
 * WHY    Invitations, checkout returns and locked-resource redirects all used to die here:
 *        the destination was dropped and everybody landed on /projects. The `callback`
 *        query parameter survives the round trip, so an invitee who signed in from their
 *        email lands on the invite, not a blank dashboard.
 * HOW    callback is read from the URL at submit time and passed to the provider. It is
 *        validated to be a local path before it is ever navigated to.
 * WHERE  apps/web/src/app/(auth)/invite/[id]/page.tsx, apps/web/src/features/auth/auth-shell.tsx
 */
"use client";

import { signIn } from "@foodos/auth/client";
import { Button } from "@foodos/ui/button";
import { Field } from "@foodos/ui/field";
import { Input } from "@foodos/ui/input";
import Link from "next/link";
import { useState } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

/** Only a path may be a callback: an absolute URL would send the session off-site. */
function callbackFromUrl(): string {
  const raw = new URLSearchParams(window.location.search).get("callback");
  return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/projects";
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setError(null);
    setPending(true);
    const result = await signIn.email({ email, password, callbackURL: callbackFromUrl() });
    setPending(false);
    if (result.error) setError(result.error.message ?? "That did not work. Check your details.");
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back."
      error={error}
      footer={
        <span className="flex justify-between gap-4">
          <Link href="/sign-up">Create an account</Link>
          <Link href="/forgot-password">Forgot your password?</Link>
        </span>
      }
    >
      {/* A real form, so the browser offers saved credentials and Enter submits. */}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSignIn();
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
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
