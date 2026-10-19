/**
 * SOT: reviews-manager, review-reply, review-moderation
 * WHAT   What guests said, and the restaurant's reply.
 * WHY    A restaurant can reply and it can flag, but it cannot edit or quietly delete a
 *        rating. Flagging sends it to platform moderation rather than hiding it - a product
 *        where criticism can be removed by the person criticised is a product whose reviews
 *        mean nothing.
 * WHERE  services/crm/src/crm.handlers.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { controlClass } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Review = OutputOf<"review", "read">["items"][number];

export function ReviewsManager() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [unansweredOnly, setUnansweredOnly] = useState(false);

  const reviews = useQuery(
    trpc.review.list.queryOptions({ limit: 50, cursor: null, withReplyOnly: false }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.review.list.queryKey() });
  };
  const reply = useMutation(trpc.review.reply.mutationOptions({ onSuccess: refresh }));
  const moderate = useMutation(trpc.review.moderate.mutationOptions({ onSuccess: refresh }));

  const shown = (reviews.data?.items ?? []).filter(
    (review) => !unansweredOnly || review.reply === null,
  );

  return (
    <PageShell
      title="Reviews"
      description="Replying is the whole point. A reply on a bad review reads better than no bad reviews."
      action={
        <label className="flex items-center gap-2 text-foreground text-sm">
          <input
            type="checkbox"
            checked={unansweredOnly}
            onChange={(event) => {
              setUnansweredOnly(event.target.checked);
            }}
          />
          Needs a reply
        </label>
      }
    >
      {reply.error === null ? null : <Denial error={reply.error} />}
      {moderate.error === null ? null : <Denial error={moderate.error} />}

      {reviews.data === undefined ? (
        <SkeletonRows />
      ) : shown.length === 0 ? (
        <Empty
          icon="⭐"
          title="No reviews here"
          detail="Guests are asked after their order is completed, and from the feedback QR."
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                pending={reply.isPending}
                onReply={(text) => {
                  reply.mutate({ id: review.id, reply: text });
                }}
                onFlag={() => {
                  moderate.mutate({
                    action: review.status === "flagged" ? "unflag" : "flag",
                    id: review.id,
                    reason: "Reported by the restaurant",
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function ReviewCard({
  review,
  onReply,
  onFlag,
  pending,
}: {
  review: Review;
  onReply: (text: string) => void;
  onFlag: () => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState("");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">
              {"★".repeat(Math.round(review.overall))}
              <span className="text-muted-foreground">
                {"★".repeat(Math.max(0, 5 - Math.round(review.overall)))}
              </span>{" "}
              <span className="text-muted-foreground text-sm">
                {review.overall.toFixed(1)} · {review.authorName ?? "Guest"}
              </span>
            </p>
            <p className="text-muted-foreground text-xs">
              food {review.food} · service {review.service} · ambience {review.ambience} · value{" "}
              {review.value}
            </p>
          </div>
          <Badge variant={review.status === "flagged" ? "destructive" : "outline"}>
            {review.status}
          </Badge>
        </div>

        {review.body === null ? null : <p className="text-foreground text-sm">{review.body}</p>}

        {review.reply === null ? (
          <Gate resource="review" operation="update">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                placeholder="Thanks for letting us know…"
                className={controlClass}
              />
              <Button
                disabled={pending || draft.trim() === ""}
                onClick={() => {
                  onReply(draft.trim());
                }}
              >
                Reply
              </Button>
            </div>
          </Gate>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="font-medium text-foreground text-xs">Your reply</p>
            <p className="text-foreground text-sm">{review.reply}</p>
          </div>
        )}

        <Gate resource="review" operation="manage">
          <Button variant="ghost" size="sm" onClick={onFlag}>
            {review.status === "flagged" ? "Withdraw report" : "Report to moderation"}
          </Button>
        </Gate>
      </CardContent>
    </Card>
  );
}
