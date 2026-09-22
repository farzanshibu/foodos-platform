/**
 * SOT: guest-review-form, rating-form
 * WHAT   Four ratings and a few words, from the table.
 * WHY    Asked while somebody is still sitting there, which is the only moment they will
 *        actually answer. Four separate scores rather than one, because "the food was great,
 *        the service was slow" is the feedback a restaurant can act on and a single star
 *        rating throws away.
 */
"use client";

import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";

import { useTRPC } from "@/trpc/react";

const ASPECTS = [
  { key: "food", label: "Food" },
  { key: "service", label: "Service" },
  { key: "ambience", label: "Ambience" },
  { key: "value", label: "Value" },
] as const;

type Aspect = (typeof ASPECTS)[number]["key"];

export function ReviewForm({
  restaurantId,
  branchId,
  restaurantName,
}: {
  restaurantId: string;
  branchId: string | null;
  restaurantName: string;
}) {
  const trpc = useTRPC();
  const [scores, setScores] = useState<Record<Aspect, number>>({
    food: 0,
    service: 0,
    ambience: 0,
    value: 0,
  });
  const [body, setBody] = useState("");
  const [name, setName] = useState("");

  const create = useMutation(trpc.review.create.mutationOptions());

  const complete = ASPECTS.every((aspect) => scores[aspect.key] > 0);

  if (create.isSuccess) {
    return (
      <div className="space-y-3 py-16 text-center">
        {/* The one success mark on the guest surface. A tick, in the platform's own
            success colour, rather than an emoji that renders as a different illustration
            on every phone. */}
        <div
          className="mx-auto flex size-11 items-center justify-center rounded-full bg-success/12 text-success"
          aria-hidden="true"
        >
          <Check className="size-6" />
        </div>
        <h1 className="font-semibold text-foreground text-lg">Thank you</h1>
        <p className="text-muted-foreground text-sm">
          {restaurantName} will see this. It genuinely helps.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">How was it?</h1>
        <p className="text-muted-foreground text-sm">Takes about twenty seconds.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          {ASPECTS.map((aspect) => (
            <fieldset key={aspect.key} className="space-y-2">
              <legend className="font-medium text-foreground text-sm">{aspect.label}</legend>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    aria-label={`${aspect.label}: ${String(score)} out of 5`}
                    onClick={() => {
                      setScores((current) => ({ ...current, [aspect.key]: score }));
                    }}
                    className={cn(
                      // A star rating is one of the few places a glyph is the right
                      // control: the shape IS the meaning. Filled state is colour AND
                      // weight, so it survives greyscale.
                      "size-11 rounded-md border text-lg transition-colors",
                      scores[aspect.key] >= score
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    ★
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <label className="block space-y-1">
        <span className="font-medium text-foreground text-sm">Anything else?</span>
        <textarea
          rows={4}
          value={body}
          maxLength={2000}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="font-medium text-foreground text-sm">Your name (optional)</span>
        <input
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      {create.error === null ? null : <Denial error={create.error} />}

      <Button
        className="w-full"
        size="lg"
        disabled={!complete}
        loading={create.isPending}
        onClick={() => {
          create.mutate({
            restaurantId,
            ...(branchId === null ? {} : { branchId }),
            food: scores.food,
            service: scores.service,
            ambience: scores.ambience,
            value: scores.value,
            ...(body.trim() === "" ? {} : { body: body.trim() }),
            ...(name.trim() === "" ? {} : { authorName: name.trim() }),
          });
        }}
      >
        Send
      </Button>
    </div>
  );
}
