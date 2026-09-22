/**
 * SOT: sign-up, create-account, auth-surface
 * WHAT   Account creation, on the same surface as every other auth screen.
 * WHY    A starter with only a sign-in screen sends every new customer through the
 *        provider's defaults or away from the product. The first workspace is created
 *        server-side at signup by @foodos/auth's user hook, so this page needs no
 *        organisation logic at all - it creates an account and lands in it.
 * HOW    signUp.email from @foodos/auth/client; errors render in the shared banner.
 * WHERE  apps/web/src/features/auth/auth-shell.tsx, packages/auth/src/auth.ts (the hook)
 */
"use client";

import { signUp } from "@foodos/auth/client";
import { Button } from "@foodos/ui/button";
import { Field } from "@foodos/ui/field";
import { Input } from "@foodos/ui/input";
import Link from "next/link";
import { useState } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSignUp() {
    setError(null);
    setPending(true);
    const result = await signUp.email({
      name,
      email,
      password,
      callbackURL: "/projects",
    });
    setPending(false);
    if (result.error) setError(result.error.message ?? "That did not work. Check your details.");
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your first workspace is made for you as you sign up."
      error={error}
      footer={
        <span>
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </span>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSignUp();
        }}
      >
        <Field label="Name">
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" hint="Eight characters or more.">
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
