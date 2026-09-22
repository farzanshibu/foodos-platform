/**
 * SOT: requests-console, request-inbox, sla-countdown
 * WHAT   The live inbox of everything guests have asked for, grouped by who should answer it.
 * WHY    A request is only useful if somebody sees it within a minute, so this screen is
 *        sorted by what is closest to breaching its SLA rather than by what arrived first -
 *        and a breach is shown as a fact from the server, not a countdown a tablet computed.
 * HOW    Whatever a guest filled in is rendered from the summary the requests service built
 *        against that type's own form. This screen knows no request types either.
 * WHERE  services/requests/src/request.handlers.ts
 */
"use client";

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
import { duration } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Branch = OutputOf<"branch", "read">["items"][number];
type ServiceRequest = OutputOf<"serviceRequest", "read">["items"][number];

const DESTINATIONS = [
  { key: undefined, label: "Everything" },
  { key: "waiter", label: "Waiters" },
  { key: "kitchen", label: "Kitchen" },
  { key: "manager", label: "Manager" },
  { key: "counter", label: "Counter" },
] as const;

function nextStep(
  status: string,
): { action: "acknowledge" | "start" | "complete"; label: string } | null {
  switch (status) {
    case "submitted":
      return { action: "acknowledge", label: "On it" };
    case "acknowledged":
      return { action: "start", label: "Start" };
    case "in_progress":
      return { action: "complete", label: "Done" };
    default:
      return null;
  }
}

export function RequestsConsole({ branches }: { branches: Branch[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [destination, setDestination] = useState<string | undefined>(undefined);

  const requests = useQuery(
    trpc.serviceRequest.list.queryOptions(
      {
        limit: 60,
        cursor: null,
        bucket: "active",
        mineOnly: false,
        ...(branchId === "" ? {} : { branchId }),
        ...(destination === undefined ? {} : { destination }),
      },
      { refetchInterval: 8_000 },
    ),
  );

  const act = useMutation(
    trpc.serviceRequest.staffAction.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.serviceRequest.list.queryKey() });
      },
    }),
  );

  /** Closest to breaching first. A queue sorted by arrival is a queue that lets one go cold. */
  const ordered = [...(requests.data?.items ?? [])].sort((left, right) => {
    if (left.slaBreached !== right.slaBreached) return left.slaBreached ? -1 : 1;
    return new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime();
  });

  return (
    <PageShell
      title="Requests"
      description="What guests have asked for, most urgent first."
      action={<BranchPicker branches={branches} value={branchId} onChange={setBranchId} />}
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {DESTINATIONS.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => {
              setDestination(entry.key);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
              destination === entry.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {act.error === null ? null : <Denial error={act.error} />}

      {requests.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : ordered.length === 0 ? (
        <Empty
          icon="🔔"
          title="Nothing outstanding"
          detail="Requests from tables show up here the moment somebody taps a card."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((request) => (
            <li key={request.id}>
              <RequestCard
                request={request}
                pending={act.isPending}
                onAction={(action) => {
                  act.mutate(
                    action === "reject"
                      ? { action: "reject", id: request.id, reason: "Cannot do this right now" }
                      : { action, id: request.id },
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function RequestCard({
  request,
  onAction,
  pending,
}: {
  request: ServiceRequest;
  onAction: (action: "acknowledge" | "start" | "complete" | "reject") => void;
  pending: boolean;
}) {
  const step = nextStep(request.status);
  const waiting = Math.round((Date.now() - new Date(request.submittedAt).getTime()) / 1000);

  return (
    <Card className={cn("h-full", request.slaBreached ? "border-destructive" : "")}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground">{request.requestTypeName}</p>
            <p className="text-muted-foreground text-xs">
              {request.placeLabel === null ? "No table" : `Table ${request.placeLabel}`}
              {request.guestName === null ? "" : ` · ${request.guestName}`}
            </p>
          </div>
          <Badge variant={request.slaBreached ? "destructive" : "secondary"}>
            {duration(waiting)}
          </Badge>
        </div>

        {request.formSummary.length === 0 ? null : (
          <dl className="flex-1 space-y-0.5 text-sm">
            {request.formSummary.map((entry) => (
              <div key={entry.label} className="flex gap-2">
                <dt className="text-muted-foreground">{entry.label}:</dt>
                <dd className="text-foreground">{entry.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <Gate resource="serviceRequest" operation="manage">
          <div className="mt-auto flex gap-2">
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
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                onAction("reject");
              }}
            >
              Can&apos;t
            </Button>
          </div>
        </Gate>
      </CardContent>
    </Card>
  );
}
