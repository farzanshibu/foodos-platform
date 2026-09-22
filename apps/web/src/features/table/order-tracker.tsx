/**
 * SOT: order-tracker, guest-order-status, order-timeline
 * WHAT   Where a guest watches their order move from placed to on the table.
 * WHY    The whole reason somebody tolerates ordering from a phone is not having to wonder.
 *        The states shown are the order's real ones, and the labels are the only thing this
 *        screen adds - it never infers a step the server did not report.
 * HOW    Polled rather than pushed, at the interval the server hands out in the QR session,
 *        so staff can slow it down for a busy branch without anybody shipping a client.
 * WHERE  services/orders/src/constants.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Card, CardContent } from "@foodos/ui/card";
import { cn } from "@foodos/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Order = OutputOf<"order", "read">["items"][number];

/** The happy path, in order. Anything not on it is shown on its own as an exception. */
const STEPS = [
  { status: "payment_pending", label: "Placed" },
  { status: "paid", label: "Paid" },
  { status: "accepted", label: "Accepted" },
  { status: "preparing", label: "Being cooked" },
  { status: "ready", label: "Ready" },
  { status: "served", label: "At your table" },
  { status: "completed", label: "Done" },
] as const;

function stepIndex(status: string): number {
  return STEPS.findIndex((step) => step.status === status);
}

export function OrderTracker() {
  const trpc = useTRPC();
  const placed = useSearchParams().get("placed");

  const session = useQuery(trpc.qrSession.current.queryOptions({}));
  const interval = (session.data?.pollIntervalSeconds ?? 10) * 1000;

  const orders = useQuery(
    trpc.order.list.queryOptions(
      { limit: 20, cursor: null, bucket: "all" },
      { refetchInterval: interval },
    ),
  );

  if (orders.data === undefined) {
    return <p className="py-16 text-center text-muted-foreground text-sm">Loading your orders…</p>;
  }

  if (orders.data.items.length === 0) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="text-4xl" aria-hidden="true">
          ⏱️
        </p>
        <p className="text-muted-foreground text-sm">No orders from this table yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {placed === null ? null : (
        <Card className="border-primary">
          <CardContent className="p-4 text-center">
            <p className="font-medium text-foreground">Order #{placed} is in</p>
            <p className="text-muted-foreground text-sm">
              We will keep this page up to date. No need to refresh.
            </p>
          </CardContent>
        </Card>
      )}

      <h1 className="font-semibold text-foreground text-xl">Your orders</h1>
      {orders.data.items.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const reached = stepIndex(order.status);
  const cancelled = order.status.startsWith("cancelled") || order.status === "payment_failed";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-foreground">Order #{order.orderNumber}</p>
          <Badge variant={cancelled ? "destructive" : "secondary"}>
            {order.status.replace(/_/g, " ")}
          </Badge>
        </div>

        {cancelled ? (
          <p className="text-muted-foreground text-sm">
            {order.cancellationReason ?? "This order did not go through. Please ask our staff."}
          </p>
        ) : (
          <ol className="flex gap-1">
            {STEPS.map((step, index) => (
              <li key={step.status} className="flex-1 space-y-1">
                <div
                  className={cn("h-1 rounded-full", index <= reached ? "bg-primary" : "bg-muted")}
                />
                <p
                  className={cn(
                    "text-[10px] leading-tight",
                    index <= reached ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </p>
              </li>
            ))}
          </ol>
        )}

        <ul className="space-y-1 text-sm">
          {order.lines.map((line, index) => (
            <li
              key={`${line.kind}-${String(index)}`}
              className="flex justify-between text-muted-foreground"
            >
              <span>
                {line.quantity}× {line.nameSnapshot}
              </span>
              <span>{money(line.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>

        <p className="flex justify-between border-border border-t pt-2 font-semibold text-foreground">
          <span>Total</span>
          <span>{money(order.totalPaise)}</span>
        </p>
      </CardContent>
    </Card>
  );
}
