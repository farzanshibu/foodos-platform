/**
 * SOT: orders-console, order-list-ui, order-status-actions
 * WHAT   The screen a manager works the floor from: what came in, what stage it is at, and
 *        the one button that moves it on.
 * WHY    Exactly one action is offered per order, because the state machine only permits one
 *        next step - offering five and letting four of them fail is a console that teaches
 *        people to ignore errors. The transition rules live in the orders service; this
 *        screen renders the step that service would accept.
 * HOW    Polled, not pushed. New orders appear on their own; nobody has to remember to refresh.
 * WHERE  services/orders/src/constants.ts, services/orders/src/order.handlers.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BranchPicker } from "@/features/manage/branch-picker";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { WaitingQueue } from "@/features/manage/waiting-queue";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Branch = OutputOf<"branch", "read">["items"][number];
type Order = OutputOf<"order", "read">["items"][number];
type Action = "accept" | "start_preparing" | "mark_ready" | "mark_served" | "complete";

const BUCKETS = [
  { key: "waiting", label: "Waiting" },
  { key: "new", label: "New" },
  { key: "active", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

/**
 * The one step the orders service will accept from here. Null means this order is waiting on
 * something else - a payment, or nothing at all because it is finished.
 */
function nextStep(status: string): { action: Action; label: string } | null {
  switch (status) {
    // Unpaid is fine: payment is taken at the end, so an order can be accepted on arrival.
    case "payment_pending":
    case "paid":
      return { action: "accept", label: "Accept" };
    case "accepted":
      return { action: "start_preparing", label: "Start cooking" };
    case "preparing":
      return { action: "mark_ready", label: "Mark ready" };
    case "ready":
      return { action: "mark_served", label: "Mark served" };
    case "served":
      return { action: "complete", label: "Complete" };
    default:
      return null;
  }
}

export function OrdersConsole({ branches }: { branches: Branch[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]["key"]>("active");

  const orders = useQuery(
    trpc.order.list.queryOptions(
      {
        limit: 50,
        cursor: null,
        bucket: bucket === "waiting" ? "active" : bucket,
        ...(branchId === "" ? {} : { branchId }),
      },
      { enabled: bucket !== "waiting", refetchInterval: 10_000 },
    ),
  );

  const move = useMutation(
    trpc.order.setStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() });
      },
    }),
  );

  /** The bill, settled at the end of the meal: records the cash and leaves the status alone. */
  const collect = useMutation(
    trpc.payment.paymentAction.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.order.list.queryKey() });
      },
    }),
  );

  return (
    <PageShell
      title="Orders"
      description="Everything on the floor right now, oldest first."
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
      {collect.error === null ? null : <Denial error={collect.error} />}

      {/* Baskets sent from the door are not orders yet, so they get their own view. */}
      {bucket === "waiting" ? (
        <WaitingQueue branchId={branchId} />
      ) : orders.data === undefined ? (
        <SkeletonRows />
      ) : orders.data.items.length === 0 ? (
        <Empty
          icon="🧾"
          title="Nothing here"
          detail="Orders placed from a table appear on this screen within a few seconds."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.data.items.map((order) => (
            <li key={order.id}>
              <OrderCard
                order={order}
                onAction={(action) => {
                  move.mutate(
                    action === "cancel"
                      ? { action: "cancel", id: order.id, reason: "Cancelled by the restaurant" }
                      : { action, id: order.id },
                  );
                }}
                onCollect={() => {
                  collect.mutate({
                    action: "record_cash",
                    orderId: order.id,
                    amountPaise: order.totalPaise,
                  });
                }}
                pending={move.isPending || collect.isPending}
              />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function OrderCard({
  order,
  onAction,
  onCollect,
  pending,
}: {
  order: Order;
  onAction: (action: Action | "cancel") => void;
  onCollect: () => void;
  pending: boolean;
}) {
  const step = nextStep(order.status);
  /** Pay-at-the-end: the bill is due once the food is out, and stays visible until settled. */
  const owesBill =
    order.paymentStatus !== "paid" &&
    (order.status === "ready" || order.status === "served" || order.status === "completed");

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground">#{order.orderNumber}</p>
            <p className="text-muted-foreground text-xs">
              {order.placeLabel === null
                ? order.orderType.replace(/_/g, " ")
                : `Table ${order.placeLabel}`}
              {order.guestName === null ? "" : ` · ${order.guestName}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="secondary">
              {order.status === "payment_pending" ? "new" : order.status.replace(/_/g, " ")}
            </Badge>
            <Badge variant={order.paymentStatus === "paid" ? "secondary" : "outline"}>
              {order.paymentStatus === "paid" ? "paid" : owesBill ? "bill due" : "pay at end"}
            </Badge>
          </div>
        </div>

        <ul className="flex-1 space-y-1 text-sm">
          {order.lines.map((line, index) => (
            <li key={`${line.kind}-${String(index)}`}>
              <span className="text-foreground">
                {line.quantity}× {line.nameSnapshot}
              </span>
              {line.kind === "combo" ? (
                <span className="block pl-4 text-muted-foreground text-xs">
                  {line.children
                    .map((child) => `${String(child.quantity)}× ${child.nameSnapshot}`)
                    .join(", ")}
                </span>
              ) : null}
              {line.notes === null ? null : (
                <span className="block pl-4 text-muted-foreground text-xs italic">
                  {line.notes}
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="flex justify-between border-border border-t pt-2 font-medium text-foreground text-sm">
          <span>Total</span>
          <span>{money(order.totalPaise)}</span>
        </p>

        {owesBill ? (
          <Gate resource="payment" operation="manage">
            <Button disabled={pending} onClick={onCollect}>
              Collect payment {money(order.totalPaise)}
            </Button>
          </Gate>
        ) : null}

        <Gate resource="order" operation="manage">
          <div className="flex gap-2">
            {step === null ? null : (
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => {
                  onAction(step.action);
                }}
              >
                {step.label}
              </Button>
            )}
            {order.status === "completed" || order.status.startsWith("cancelled") ? null : (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  onAction("cancel");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </Gate>
      </CardContent>
    </Card>
  );
}
