/**
 * SOT: branches-manager, opening-hours, branch-location
 * WHAT   The physical locations, their addresses and when they are open.
 * WHY    Hours are saved as a whole week at once, never a day at a time. A partial write is
 *        how a branch ends up open on a day nobody meant to open it, and "open now" on the
 *        customer side is computed from these seven rows in the branch's own timezone.
 * WHERE  services/catalog/src/restaurant.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreateRow, controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];
type Branch = OutputOf<"branch", "read">["items"][number];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function BranchesManager({
  restaurants,
  initialBranches,
}: {
  restaurants: Restaurant[];
  initialBranches: Branch[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);

  const branches = useQuery(
    trpc.branch.list.queryOptions(
      { limit: 50, cursor: null },
      { initialData: { items: initialBranches, nextCursor: null } },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.branch.list.queryKey() });
  };
  const create = useMutation(
    trpc.branch.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setCity("");
        refresh();
      },
    }),
  );
  const setHours = useMutation(
    trpc.branch.setHours.mutationOptions({
      onSuccess: () => {
        setEditing(null);
        refresh();
      },
    }),
  );

  return (
    <PageShell
      title="Branches"
      description="Where you actually are. Each one has its own tables, codes and orders."
    >
      <Gate resource="branch" operation="create">
        <CreateRow>
          <Field label="Branch name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Trivandrum"
              className={controlClass}
            />
          </Field>
          <Field label="City" width="w-44">
            <input
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          {restaurants.length <= 1 ? null : (
            <Field label="Restaurant" width="w-48">
              <select
                value={restaurantId}
                onChange={(event) => {
                  setRestaurantId(event.target.value);
                }}
                className={controlClass}
              >
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button
            disabled={create.isPending || name.trim() === "" || restaurantId === ""}
            onClick={() => {
              create.mutate({
                restaurantId,
                name: name.trim(),
                ...(city.trim() === "" ? {} : { city: city.trim() }),
              });
            }}
          >
            Add branch
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {setHours.error === null ? null : <Denial error={setHours.error} />}

      {branches.data.items.length === 0 ? (
        <Empty
          icon="📍"
          title="No branches yet"
          detail="A restaurant needs at least one before it can go live or take an order."
        />
      ) : (
        <ListCard>
          <ul>
            {branches.data.items.map((branch) => (
              <li key={branch.id} className="space-y-2">
                <BranchRow
                  branch={branch}
                  open={editing === branch.id}
                  onToggle={() => {
                    setEditing(editing === branch.id ? null : branch.id);
                  }}
                />
                {editing === branch.id ? (
                  <HoursEditor
                    branch={branch}
                    pending={setHours.isPending}
                    onSave={(hours, isLive) => {
                      setHours.mutate({ id: branch.id, hours, isLive });
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}

function BranchRow({
  branch,
  open,
  onToggle,
}: {
  branch: Branch;
  open: boolean;
  onToggle: () => void;
}) {
  const where = branch.city ?? "No city set";
  const hoursNote = branch.hours.length === 0 ? " · hours not set" : "";

  return (
    <ListRow
      title={branch.name}
      subtitle={`${where} · ${branch.timezone}${hoursNote}`}
      meta={
        <div className="flex gap-1">
          <Badge variant={branch.isOpenNow ? "secondary" : "outline"}>
            {branch.isOpenNow ? "Open now" : "Closed"}
          </Badge>
          <Badge variant={branch.isLive ? "secondary" : "outline"}>
            {branch.isLive ? "Serving" : "Not serving"}
          </Badge>
        </div>
      }
      actions={
        <Gate resource="branch" operation="manage">
          <Button size="sm" variant="outline" onClick={onToggle}>
            {open ? "Close" : "Hours"}
          </Button>
        </Gate>
      }
    />
  );
}

type Row = { dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean };

function HoursEditor({
  branch,
  onSave,
  pending,
}: {
  branch: Branch;
  onSave: (hours: Row[], isLive: boolean) => void;
  pending: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    DAYS.map((_, day) => {
      const held = branch.hours.find((entry) => entry.dayOfWeek === day);
      return {
        dayOfWeek: day,
        opensAt: held?.opensAt ?? "09:00",
        closesAt: held?.closesAt ?? "23:00",
        isClosed: held?.isClosed ?? false,
      };
    }),
  );

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm">
          Closing earlier than opening means you trade past midnight — 22:00 to 02:00 is a late bar,
          not a mistake.
        </p>
        {rows.map((row, index) => (
          <div key={row.dayOfWeek} className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-foreground text-sm">{DAYS[row.dayOfWeek]}</span>
            <input
              type="time"
              value={row.opensAt}
              disabled={row.isClosed}
              onChange={(event) => {
                const opensAt = event.target.value;
                setRows((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, opensAt } : entry,
                  ),
                );
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="time"
              value={row.closesAt}
              disabled={row.isClosed}
              onChange={(event) => {
                const closesAt = event.target.value;
                setRows((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, closesAt } : entry,
                  ),
                );
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <label className="flex items-center gap-1 text-muted-foreground text-sm">
              <input
                type="checkbox"
                checked={row.isClosed}
                onChange={(event) => {
                  const isClosed = event.target.checked;
                  setRows((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, isClosed } : entry,
                    ),
                  );
                }}
              />
              closed
            </label>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() => {
              onSave(rows, branch.isLive);
            }}
          >
            Save hours
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              onSave(rows, !branch.isLive);
            }}
          >
            {branch.isLive ? "Save and stop serving" : "Save and start serving"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
