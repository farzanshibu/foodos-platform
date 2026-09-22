/**
 * SOT: inline-create, manage-create-row, list-row, list-card
 * WHAT   The shapes every simple management screen is made of: a row that creates one thing,
 *        a card that holds a list, and a row inside it.
 * WHY    Fourteen screens that each invent their own create form is fourteen chances for one
 *        to forget the plan gate or put the delete button somewhere new. These are composed
 *        with slots rather than configured with props, so a screen that needs something
 *        unusual passes a node instead of growing a boolean here.
 * WHY    `controlClass` is re-exported from the UI package rather than written again here.
 *        It was a second, slightly different definition of the same border, height and
 *        background - which is how a select on one screen ended up a different height from
 *        the input beside it.
 * WHY    A list is one card with divided rows, not a card per row. Fourteen screens rendering
 *        a bordered box per item produced a wall of identical cards with a gap between each,
 *        which is slower to scan and taller to scroll than the rule that replaced it.
 * WHERE  apps/web/src/features/manage/*, packages/ui/src/components/ui/input.tsx
 */
"use client";

import { Card, CardContent } from "@foodos/ui/card";
import { controlClass as sharedControlClass } from "@foodos/ui/input";

export function CreateRow({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">{children}</CardContent>
    </Card>
  );
}

export function Field({
  label,
  width = "flex-1 min-w-40",
  children,
}: {
  label: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control arrives through the children slot and the rule cannot see it statically; every caller passes exactly one input, select or textarea, and wrapping it is what associates the two
    <label className={`${width} space-y-1.5`}>
      <span className="block font-medium text-foreground text-sm leading-none">{label}</span>
      {children}
    </label>
  );
}

/** The platform's control shape, at the height the shared Input and Select use. */
export const controlClass = `${sharedControlClass} h-9 px-3 py-1 text-sm`;

/**
 * The card a run of <ListRow> lives in. Rows are separated by a rule and the card owns the
 * border, so a fifty-item list is one boundary rather than fifty. An empty list should
 * render <Empty> or <EmptyState> instead of an empty card.
 */
export function ListCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      {/* The divider lives on the list element the caller passes, not here: `divide-y`
          only reaches direct children, and the caller's <ul> is what actually holds the
          rows. */}
      <CardContent className="p-0 [&>ul]:divide-y [&>ul]:divide-border">{children}</CardContent>
    </Card>
  );
}

export function ListRow({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors duration-150 hover:bg-surface">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground text-sm">{title}</p>
        {subtitle === undefined ? null : (
          <div className="truncate text-muted-foreground text-sm">{subtitle}</div>
        )}
      </div>
      {meta}
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
