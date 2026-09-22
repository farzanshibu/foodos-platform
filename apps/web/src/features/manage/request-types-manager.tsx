/**
 * SOT: request-types-manager, form-builder, request-config
 * WHAT   Where "request a charger" gets invented, form and all.
 * WHY    This screen is the other half of the server-driven form. What somebody builds here
 *        is data - a row with a JSON form on it - so the moment it is saved it is on every
 *        phone in the building. There is no deploy, no client release, and no code anywhere
 *        that knows what a charger is.
 * HOW    The field types offered are the closed union the contract publishes, so a field
 *        that can be built here is one the customer app is guaranteed to be able to draw.
 * WHERE  packages/contracts/src/resources/requests.contract.ts, apps/web/src/features/table/request-form.tsx
 */
"use client";

import {
  type OutputOf,
  REQUEST_COLORS,
  REQUEST_DESTINATIONS,
  REQUEST_ICONS,
  type RequestFormField,
} from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];
type RequestType = OutputOf<"requestType", "read">["items"][number];

const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "select",
  "multi_select",
  "toggle",
  "rating",
  "phone",
] as const;

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

export function RequestTypesManager({
  restaurants,
  initialTypes,
}: {
  restaurants: Restaurant[];
  initialTypes: RequestType[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<(typeof REQUEST_ICONS)[number]>("bell");
  const [color, setColor] = useState<(typeof REQUEST_COLORS)[number]>("brand");
  const [destination, setDestination] = useState<(typeof REQUEST_DESTINATIONS)[number]>("waiter");
  const [sla, setSla] = useState("5");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<RequestFormField[]>([]);

  const types = useQuery(
    trpc.requestType.list.queryOptions(
      { limit: 50, cursor: null, activeOnly: false },
      { initialData: { items: initialTypes, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.requestType.list.queryKey() });
  };

  const create = useMutation(
    trpc.requestType.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setMessage("");
        setFields([]);
        refresh();
      },
    }),
  );
  const update = useMutation(trpc.requestType.update.mutationOptions({ onSuccess: refresh }));

  const addField = (type: (typeof FIELD_TYPES)[number]) => {
    const key = `field_${String(fields.length + 1)}`;
    const base = { key, label: "New question", required: false };
    setFields((current) => [
      ...current,
      type === "select" || type === "multi_select"
        ? { ...base, type, options: ["Option one", "Option two"] }
        : type === "rating"
          ? { ...base, type, scale: 5 }
          : { ...base, type },
    ]);
  };

  return (
    <PageShell
      title="Request types"
      description="What a guest can ask for. Save one and it is on every table immediately."
    >
      <Gate resource="requestType" operation="create">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-44 flex-1 space-y-1">
                <span className="font-medium text-foreground text-sm">What is it called?</span>
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="Request a charger"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <label className="w-32 space-y-1">
                <span className="font-medium text-foreground text-sm">Icon</span>
                <select
                  value={icon}
                  onChange={(event) => {
                    const chosen = REQUEST_ICONS.find(
                      (candidate) => candidate === event.target.value,
                    );
                    if (chosen !== undefined) setIcon(chosen);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {REQUEST_ICONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label className="w-32 space-y-1">
                <span className="font-medium text-foreground text-sm">Colour</span>
                <select
                  value={color}
                  onChange={(event) => {
                    const chosen = REQUEST_COLORS.find(
                      (candidate) => candidate === event.target.value,
                    );
                    if (chosen !== undefined) setColor(chosen);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {REQUEST_COLORS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label className="w-36 space-y-1">
                <span className="font-medium text-foreground text-sm">Goes to</span>
                <select
                  value={destination}
                  onChange={(event) => {
                    const chosen = REQUEST_DESTINATIONS.find(
                      (candidate) => candidate === event.target.value,
                    );
                    if (chosen !== undefined) setDestination(chosen);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {REQUEST_DESTINATIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label className="w-28 space-y-1">
                <span className="font-medium text-foreground text-sm">Answer in</span>
                <input
                  value={sla}
                  inputMode="numeric"
                  onChange={(event) => {
                    setSla(event.target.value);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="font-medium text-foreground text-sm">What we say back</span>
              <input
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
                placeholder="Charger is on the way!"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <div className="space-y-2">
              <p className="font-medium text-foreground text-sm">
                Questions to ask{" "}
                <span className="font-normal text-muted-foreground">
                  · optional, and rendered on the guest&apos;s phone exactly as built here
                </span>
              </p>

              {fields.map((field, index) => (
                <div key={field.key} className="flex flex-wrap items-center gap-2">
                  <input
                    value={field.label}
                    onChange={(event) => {
                      const label = event.target.value;
                      setFields((current) =>
                        current.map((entry, position) =>
                          position === index ? { ...entry, label } : entry,
                        ),
                      );
                    }}
                    className="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                  <Badge variant="outline">{field.type}</Badge>
                  <label className="flex items-center gap-1 text-muted-foreground text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => {
                        const required = event.target.checked;
                        setFields((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, required } : entry,
                          ),
                        );
                      }}
                    />
                    required
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFields((current) => current.filter((_, position) => position !== index));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <div className="flex flex-wrap gap-1">
                {FIELD_TYPES.map((type) => (
                  <Button
                    key={type}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      addField(type);
                    }}
                  >
                    + {type.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              disabled={name.trim() === "" || restaurants.length === 0}
              loading={create.isPending}
              onClick={() => {
                const restaurantId = restaurants[0]?.id;
                if (restaurantId === undefined) return;
                create.mutate({
                  restaurantId,
                  key: slugify(name),
                  name: name.trim(),
                  icon,
                  color,
                  destination,
                  slaMinutes: Math.min(120, Math.max(1, Number(sla) || 5)),
                  requiresPlace: true,
                  allowedOnlyDuringActiveOrder: false,
                  formSchema: { version: 1, fields },
                  sortOrder: types.data.items.length,
                  ...(message.trim() === "" ? {} : { successMessage: message.trim() }),
                });
              }}
            >
              Add request type
            </Button>
          </CardContent>
        </Card>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {update.error === null ? null : <Denial error={update.error} />}

      {types.data.items.length === 0 ? (
        <Empty
          icon="🔔"
          title="Nothing to request yet"
          detail="Call a waiter, request water, ask for the bill — build the ones your guests need."
        />
      ) : (
        <ul className="space-y-2">
          {types.data.items.map((type) => (
            <li key={type.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{type.name}</p>
                    <p className="text-muted-foreground text-sm">
                      goes to {type.destination} · answer within {type.slaMinutes} min ·{" "}
                      {type.formSchema.fields.length} question
                      {type.formSchema.fields.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge variant={type.isActive ? "secondary" : "outline"}>
                    {type.isActive ? "Live" : "Off"}
                  </Badge>
                  <Gate resource="requestType" operation="update">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate({
                          id: type.id,
                          icon: type.icon,
                          color: type.color,
                          destination: type.destination,
                          formSchema: type.formSchema,
                          slaMinutes: type.slaMinutes,
                          requiresPlace: type.requiresPlace,
                          allowedOnlyDuringActiveOrder: type.allowedOnlyDuringActiveOrder,
                          sortOrder: type.sortOrder,
                          isActive: !type.isActive,
                        });
                      }}
                    >
                      {type.isActive ? "Turn off" : "Turn on"}
                    </Button>
                  </Gate>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
