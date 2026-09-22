/**
 * SOT: invite-accept, invitation-landing, auth-surface
 * WHAT   Where an invitation link lands, signed in or not.
 * WHY    An emailed invite used to drop the invitee on a blank sign-in with the
 *        destination lost. This page keeps the invitation id in the URL: a signed-out
 *        visitor is offered sign-in with a callback straight back here, and a signed-in
 *        one accepts in place. Nobody is redirected away from a page built for them.
 * HOW    organization.acceptInvitation from @foodos/auth/client. The session hook in
 *        @foodos/auth picks the membership up on the next sign-in if they arrive cold.
 * WHERE  packages/auth/src/auth.ts (invitationExpiresIn), apps/web/src/app/(auth)/sign-in
 */
"use client";

import { organization, useSession } from "@foodos/auth/client";
import { Button } from "@foodos/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

export default function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  // useSession, not a server check: this page must render for signed-out visitors too.
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const callback = `/invite/${id}`;

  async function handleAccept() {
    setError(null);
    setPending(true);
    const result = await organization.acceptInvitation({ invitationId: id });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That invitation could not be accepted.");
      return;
    }
    router.push("/projects");
  }

  if (session.isPending) {
    return (
      <AuthShell title="Invitation" error={null}>
        <p className="text-sm text-muted-foreground">Checking your invitation…</p>
      </AuthShell>
    );
  }

  if (session.data === null) {
    return (
      <AuthShell title="You have been invited" error={null}>
        <p className="text-sm text-muted-foreground">
          Sign in - or create an account - to accept this invitation.
        </p>
        <Button onClick={() => router.push(`/sign-in?callback=${encodeURIComponent(callback)}`)}>
          Sign in to continue
        </Button>
        <Link
          className="text-sm underline"
          href={`/sign-up?callback=${encodeURIComponent(callback)}`}
        >
          Create an account
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join your team" error={error}>
      <Button disabled={pending} onClick={() => void handleAccept()}>
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
    </AuthShell>
  );
}
