/**
 * SOT: skeleton, loading-state, loading-rows
 * WHAT   The shape of content that has not arrived yet.
 * WHY    A spinner in the middle of a page throws the layout away and puts it back a second
 *        later; a skeleton keeps the page where it was. Product rule: skeletons for content,
 *        spinners only inside a control the user just pressed.
 * HOW    <SkeletonRows count={5} /> for a list or table body, <Skeleton className="h-8 w-40" />
 *        for a single known shape.
 */
import type * as React from "react";

import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      // Announced once as "loading" rather than as a wall of empty boxes.
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          // Index is the identity here: these are positions, not data.
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no id
          key={index}
          className="h-12 w-full"
        />
      ))}
    </div>
  );
}
