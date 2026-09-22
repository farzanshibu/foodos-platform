/**
 * SOT: hosted-card-actions, card-print-action, card-render-action
 * WHAT   The two things a person does on a card's own page: print it, or ask for the
 *        artwork to be produced when it has not been yet.
 * WHY    Rendering is a command, so it answers with an acceptance and not a file. The
 *        button says so rather than pretending the artwork is ready, because a page that
 *        claims to be finished and then shows nothing is worse than one that waits.
 * HOW    `Gate` mirrors the same registry rule the gateway will apply, so a member who
 *        cannot render never sees a button that would be refused. The viewer it reads comes
 *        from the page, which computes it the way the dashboard layout does.
 * WHERE  apps/web/src/app/c/[slug]/page.tsx, packages/ui/src/components/gate.tsx
 */
"use client";

import { Button } from "@foodos/ui/button";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useTRPC } from "@/trpc/react";

export function CardActions({ designId, hasArtwork }: { designId: string; hasArtwork: boolean }) {
  const trpc = useTRPC();
  const router = useRouter();

  const render = useMutation(
    trpc.cardDesign.render.mutationOptions({
      /** The command was accepted, not completed. Ask the server again for the artwork. */
      onSuccess: () => {
        router.refresh();
      },
    }),
  );

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!hasArtwork}
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
        <Gate resource="cardDesign" operation="manage">
          <Button
            variant="outline"
            disabled={render.isPending}
            onClick={() => {
              render.mutate({ id: designId, format: "svg" });
            }}
          >
            {hasArtwork ? "Render again" : "Render artwork"}
          </Button>
        </Gate>
      </div>

      {render.isSuccess ? (
        <p className="text-muted-foreground text-sm">
          Rendering started. It runs off the request path, so reload this page in a moment to
          collect it.
        </p>
      ) : null}
      {render.error === null ? null : <Denial error={render.error} />}
    </div>
  );
}
