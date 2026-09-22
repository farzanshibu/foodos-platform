/**
 * SOT: request-cards, guest-requests, my-requests, request-status-poll
 * WHAT   The "need something?" cards, the form behind each one, and what happened next.
 * WHY    The cards are the server's list. Their labels, icons, colours, forms and success
 *        messages all came down from the request types a restaurant configured - this file
 *        renders whatever it is given and has no idea what a charger is.
 * HOW    Status is polled at the interval the QR session hands out, so a busy branch can
 *        slow every phone in the room down from one setting.
 * WHERE  apps/web/src/features/table/request-form.tsx, services/requests
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Baby,
  BatteryCharging,
  Bell,
  CreditCard,
  Droplet,
  Hand,
  type LucideIcon,
  PlugZap,
  Sparkles,
  Thermometer,
  Utensils,
  Volume2,
  Wifi,
} from "lucide-react";
import { useState } from "react";

import { duration } from "@/features/table/money";
import { type FormValue, RequestFormFields } from "@/features/table/request-form";
import { Sheet } from "@/features/table/sheet";
import { useTRPC } from "@/trpc/react";

type RequestType = OutputOf<"requestType", "read">["items"][number];

/** Theme tokens to classes. The server names a token; it never sends a colour. */
const NEUTRAL_TONE = "border-border bg-muted/40";

const TONE: ReadonlyMap<string, string> = new Map([
  ["brand", "border-primary/40 bg-primary/5"],
  ["success", "border-emerald-500/40 bg-emerald-500/5"],
  ["warning", "border-amber-500/40 bg-amber-500/5"],
  ["danger", "border-destructive/40 bg-destructive/5"],
  ["neutral", NEUTRAL_TONE],
]);

/**
 * The registry already stores a lucide name per request type - "bell", "wifi", "baby" - and
 * this map turned each one back into an emoji, which is a full-colour illustration in a
 * product drawn entirely in line icons, and a different picture on Android than on iOS.
 * Mapping the name to the icon it was already naming is both more honest and consistent.
 */
const ICON: ReadonlyMap<string, LucideIcon> = new Map([
  ["bell", Bell],
  ["battery-charging", BatteryCharging],
  ["volume-2", Volume2],
  ["droplet", Droplet],
  ["sparkles", Sparkles],
  ["credit-card", CreditCard],
  ["utensils", Utensils],
  ["wifi", Wifi],
  ["plug-zap", PlugZap],
  ["hand", Hand],
  ["thermometer", Thermometer],
  ["baby", Baby],
]);

export function RequestCards({ types }: { types: RequestType[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<RequestType | null>(null);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const session = useQuery(trpc.qrSession.current.queryOptions({}));
  const interval = (session.data?.pollIntervalSeconds ?? 10) * 1000;

  const mine = useQuery(
    trpc.serviceRequest.list.queryOptions(
      { limit: 20, cursor: null, bucket: "all", mineOnly: true },
      { refetchInterval: interval },
    ),
  );

  const submit = useMutation(
    trpc.serviceRequest.submit.mutationOptions({
      onSuccess: (request) => {
        setConfirmed(request.successMessage ?? "We are on it.");
        setOpen(null);
        setValues({});
        void queryClient.invalidateQueries({ queryKey: trpc.serviceRequest.list.queryKey() });
      },
    }),
  );

  const cancel = useMutation(
    trpc.serviceRequest.cancel.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.serviceRequest.list.queryKey() });
      },
    }),
  );

  const active = (mine.data?.items ?? []).filter(
    (request) => !["completed", "rejected", "cancelled"].includes(request.status),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">Need something?</h1>
        <p className="text-muted-foreground text-sm">Tap and somebody will come over.</p>
      </div>

      {confirmed === null ? null : (
        <Card className="border-primary">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-foreground text-sm">{confirmed}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmed(null);
              }}
            >
              OK
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {types.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => {
              setOpen(type);
              setValues({});
            }}
            className={cn(
              "rounded-lg border p-4 text-left transition-colors hover:border-primary",
              TONE.get(type.color) ?? NEUTRAL_TONE,
            )}
          >
            {(() => {
              const Icon = ICON.get(type.icon) ?? Bell;
              return <Icon className="size-6 text-foreground" aria-hidden="true" />;
            })()}
            <span className="mt-2 block font-medium text-foreground text-sm">{type.name}</span>
            {type.description === null ? null : (
              <span className="mt-0.5 block text-muted-foreground text-xs">{type.description}</span>
            )}
          </button>
        ))}
      </div>

      {types.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">
          Nothing to request from this table just now.
        </p>
      ) : null}

      {active.length === 0 ? null : (
        <section className="space-y-2">
          <h2 className="font-semibold text-foreground">Your requests</h2>
          {active.map((request) => (
            <Card key={request.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                    {(() => {
                      const Icon = ICON.get(request.icon) ?? Bell;
                      return <Icon className="size-4 shrink-0" aria-hidden="true" />;
                    })()}
                    {request.requestTypeName}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {request.status === "submitted"
                      ? "Waiting for somebody to pick it up"
                      : request.status === "acknowledged"
                        ? "Somebody is on their way"
                        : "Being taken care of"}
                    {request.responseSeconds === null
                      ? ""
                      : ` · answered in ${duration(request.responseSeconds)}`}
                  </p>
                </div>
                {request.status === "submitted" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      cancel.mutate({ id: request.id, action: "cancel" });
                    }}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Badge variant="secondary">{request.status.replace(/_/g, " ")}</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {open === null ? null : (
        <Sheet
          title={open.name}
          onClose={() => {
            setOpen(null);
          }}
          footer={
            <div className="space-y-2">
              {submit.error === null ? null : <Denial error={submit.error} />}
              <Button
                className="w-full"
                loading={submit.isPending}
                onClick={() => {
                  submit.mutate({ requestTypeKey: open.key, formData: values });
                }}
              >
                Send request
              </Button>
            </div>
          }
        >
          {open.formSchema.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">Tap send and somebody will be with you.</p>
          ) : (
            <RequestFormFields
              fields={open.formSchema.fields}
              values={values}
              onChange={(key, value) => {
                setValues((current) => ({ ...current, [key]: value }));
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}
