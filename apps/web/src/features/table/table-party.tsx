/**
 * SOT: table-party-bar, shared-basket-members, line-attribution, stream-indicator
 * WHAT   Who else is in this basket, and whether what you are looking at is current.
 * WHY    A shared list where dishes appear from nowhere is unsettling. Naming the people at
 *        the table turns "why is there a naan in my order" into "Priya added a naan", which
 *        is the entire difference between the feature working and feeling broken.
 * HOW    Names are assigned by the server, never asked for. Nobody types their name to order
 *        a dosa, and a free-text field shared with whoever else scanned that code is a field
 *        somebody writes something unpleasant into.
 * WHERE  apps/web/src/features/table/table-cart-provider.tsx, cart-page.tsx
 */
"use client";

import { cn } from "@foodos/ui/lib/utils";

import type { StreamState, TableMember } from "@/features/table/table-cart-provider";

/**
 * The people at this table.
 *
 * "You" is first and marked, because the only member anybody needs to find quickly is
 * themselves - it is how they read the rest of the list.
 */
export function TableParty(props: {
  members: readonly TableMember[];
  stream: StreamState;
  className?: string;
}) {
  if (props.members.length <= 1) return null;

  const ordered = [...props.members].sort((left, right) =>
    left.isYou === right.isYou ? 0 : left.isYou ? -1 : 1,
  );

  return (
    <section
      className={cn("rounded-lg border border-border bg-muted/40 px-3 py-2.5", props.className)}
      aria-label="People ordering at this table"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-medium text-muted-foreground text-xs">
          Ordering together ({props.members.length})
        </span>
        {ordered.map((member) => (
          <span
            key={member.sessionId}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              member.isYou
                ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            {member.isYou ? `${member.name} (you)` : member.name}
          </span>
        ))}
      </div>
      <LiveState stream={props.stream} />
    </section>
  );
}

/**
 * Said plainly, because the honest states differ.
 *
 * A table told "updating live" believes what it sees. A table quietly on a fallback poll must
 * not be told the same thing - the list is still correct, just a few seconds behind, and
 * somebody about to press Confirm deserves to know which of those they are looking at.
 */
function LiveState({ stream }: { stream: StreamState }) {
  const label =
    stream === "live"
      ? "Updating live as people add things"
      : stream === "polling"
        ? "Checking every few seconds - your connection will not hold a live link"
        : "Connecting…";

  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          stream === "live" ? "bg-primary" : "bg-muted-foreground/50",
        )}
      />
      {label}
    </p>
  );
}

/**
 * Whose dish this is.
 *
 * Nothing is rendered for your own lines: labelling every row "you" on a list that is mostly
 * yours is noise, and the absence of a name is a clearer signal than the word.
 */
export function AddedBy({ name, isMine }: { name: string | null; isMine: boolean }) {
  if (isMine || name === null) return null;
  return <span className="text-muted-foreground text-xs">· {name}</span>;
}
