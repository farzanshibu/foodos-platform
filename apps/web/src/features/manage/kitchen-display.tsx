/**
 * SOT: kitchen-display, kds, ticket-board
 * WHAT   The pass. Tickets, how long each has been waiting, and one button per ticket.
 * WHY    Read from two metres away by somebody with their hands full, so the type is large,
 *        the colour says the age, and there is nothing on the screen that is not a ticket.
 *        A combo appears as its constituent dishes, never as its own name - a kitchen cannot
 *        plate a price.
 * HOW    Lateness is decided by the server, because a tablet with a wrong clock would
 *        otherwise turn the whole board red or none of it.
 * WHERE  services/orders/src/kitchen.handlers.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BranchPicker } from "@/features/manage/branch-picker";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { duration } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Branch = OutputOf<"branch", "read">["items"][number];
type Ticket = OutputOf<"kitchenTicket", "read">["items"][number];

const BUCKETS = [
  { key: "new", label: "New" },
  { key: "preparing", label: "Cooking" },
  { key: "ready", label: "Ready" },
  { key: "delayed", label: "Late" },
  { key: "all", label: "All" },
] as const;

function nextStep(status: string): { action: "accept" | "start" | "ready"; label: string } | null {
  switch (status) {
    case "pending":
      return { action: "accept", label: "Accept" };
    case "accepted":
      return { action: "start", label: "Start" };
    case "preparing":
      return { action: "ready", label: "Ready" };
    default:
      return null;
  }
}

export function KitchenDisplay({ branches }: { branches: Branch[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]["key"]>("all");

  const tickets = useQuery(
    trpc.kitchenTicket.list.queryOptions(
      { limit: 60, cursor: null, branchId, bucket },
      { enabled: branchId !== "", refetchInterval: 8_000 },
    ),
  );

  const move = useMutation(
    trpc.kitchenTicket.ticketAction.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.kitchenTicket.list.queryKey() });
      },
    }),
  );

  return (
    <PageShell
      title="Kitchen"
      description="Oldest ticket first. Tap once when it moves on."
      action={<BranchPicker branches={branches} value={branchId} onChange={setBranchId} />}
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {BUCKETS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setBucket(entry.key);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
              bucket === entry.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {move.error === null ? null : <Denial error={move.error} />}

      {tickets.data === undefined ? (
        <SkeletonRows />
      ) : tickets.data.items.length === 0 ? (
        <Empty icon="🍳" title="Nothing on the pass" detail="Accepted orders land here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tickets.data.items.map((ticket) => (
            <li key={ticket.id}>
              <TicketCard
                ticket={ticket}
                pending={move.isPending}
                onAction={(action) => {
                  move.mutate({ action, id: ticket.id });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function TicketCard({
  ticket,
  onAction,
  pending,
}: {
  ticket: Ticket;
  onAction: (action: "accept" | "start" | "ready") => void;
  pending: boolean;
}) {
  const step = nextStep(ticket.status);

  return (
    <Card className={cn("h-full", ticket.isDelayed ? "border-destructive" : "")}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-2xl text-foreground leading-none">#{ticket.orderNumber}</p>
            <p className="mt-1 text-muted-foreground text-sm">
              {ticket.placeLabel === null ? "Takeaway" : `Table ${ticket.placeLabel}`}
            </p>
          </div>
          <Badge variant={ticket.isDelayed ? "destructive" : "secondary"}>
            {duration(ticket.ageSeconds)}
          </Badge>
        </div>

        <ul className="flex-1 space-y-1.5">
          {ticket.lines.map((line, index) => (
            <li key={`${line.nameSnapshot}-${String(index)}`} className="text-base">
              <span className="font-semibold text-foreground">{line.quantity}× </span>
              <span className="text-foreground">{line.nameSnapshot}</span>
              {line.variantNameSnapshot === null ? null : (
                <span className="text-muted-foreground"> ({line.variantNameSnapshot})</span>
              )}
              {line.comboNameSnapshot === null ? null : (
                <span className="block pl-6 text-muted-foreground text-xs">
                  part of {line.comboNameSnapshot}
                </span>
              )}
              {line.modifiers.length === 0 ? null : (
                <span className="block pl-6 text-muted-foreground text-sm">
                  {line.modifiers.join(", ")}
                </span>
              )}
              {line.notes === null ? null : (
                <span className="block pl-6 font-medium text-destructive text-sm">
                  {line.notes}
                </span>
              )}
            </li>
          ))}
        </ul>

        {step === null ? (
          <p className="text-center text-muted-foreground text-sm">Done</p>
        ) : (
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => {
              onAction(step.action);
            }}
          >
            {step.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
