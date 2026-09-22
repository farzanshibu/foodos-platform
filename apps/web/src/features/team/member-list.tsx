/**
 * SOT: member-list-ui, invite-member-ui, remove-member-ui, station-assignment-ui
 * WHAT   The team roster, plus the three controls the registry declared for it: invite
 *        (member:create), remove (member:delete) and rostering (member:manage).
 * WHY    Both permissions existed as gateway routes, subjects and audit events with
 *        nothing in the UI able to reach them. Which control a person sees is decided by
 *        the same registry rules the gateway will apply to the call itself.
 * HOW    AccessGate hides what the role may not do; PriceGate turns a spent seat
 *        allowance into the registry's own upsell instead of a request bound to fail.
 *        The station toggles are `STATIONS` itself - a post typed into JSX would be a post
 *        the gateway has never heard of, and the list has exactly one home.
 * WHERE  apps/web/src/app/(dashboard)/team/page.tsx
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import {
  assignableRoles,
  normalizeRole,
  type OrgRole,
  STATIONS,
  type Station,
} from "@foodos/registry";
import { AccessGate, usePermission } from "@foodos/ui/access-gate";
import { Alert } from "@foodos/ui/alert";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { Input } from "@foodos/ui/input";
import { useUsageLabel } from "@foodos/ui/price-gate";
import { Select } from "@foodos/ui/select";
import { useViewer } from "@foodos/ui/viewer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "@/trpc/react";

type Member = OutputOf<"member", "read">["items"][number];

export function MemberList({ initialItems }: { initialItems: Member[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { role: viewerRole } = useViewer();
  // Roles this viewer may grant - never above their own. member -> [member],
  // admin -> [member, admin], owner -> all three.
  const grantableRoles = assignableRoles(viewerRole);
  const [email, setEmail] = useState("");
  // The least privileged role the registry recognises - what an unknown role degrades to.
  const [role, setRole] = useState<OrgRole>(normalizeRole(null));

  const members = useQuery(
    trpc.member.list.queryOptions({}, { initialData: { items: initialItems } }),
  );

  const invite = useMutation(
    trpc.member.invite.mutationOptions({
      onSuccess: () => {
        setEmail("");
        void queryClient.invalidateQueries({ queryKey: trpc.member.list.queryKey() });
      },
    }),
  );

  const remove = useMutation(
    trpc.member.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.member.list.queryKey() });
      },
    }),
  );

  const seats = useUsageLabel("member");

  // The gateway answers a query with its output or a command with a receipt. Only the
  // first shape carries rows; initialData covers the paint before the query settles.
  const data = members.data;
  const rows = data !== undefined && "items" in data ? data.items : initialItems;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="space-y-1">
          <h1 className="font-semibold text-foreground text-xl tracking-[-0.015em]">Team</h1>
          <p className="text-muted-foreground text-sm">Seats {seats}</p>
        </div>
        {/* All three, in platform order. AccessGate alone hides; PriceGate alone renders
            children when the reason is not_in_plan, so a plan that drops seats entirely
            would have shown the invite form for an endpoint the gateway refuses. */}
        <Gate resource="member" operation="create">
          {/* A form, so Enter invites and the browser knows this is an email field. */}
          <form
            className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim().length > 0) invite.mutate({ email: email.trim(), role });
            }}
          >
            <Input
              type="email"
              aria-label="Email to invite"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-w-0 flex-1 sm:w-56 sm:flex-none"
            />
            <Select
              aria-label="Role"
              className="w-32 capitalize"
              value={role}
              onChange={(event) => setRole(normalizeRole(event.target.value))}
            >
              {grantableRoles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={email.trim().length === 0} loading={invite.isPending}>
              Invite
            </Button>
          </form>
        </Gate>
      </header>

      <Denial error={invite.error} resource="member" />
      <Denial error={remove.error} resource="member" />

      {/* create is a command, not an rpc: the seat appears once identity has executed it. */}
      {invite.isSuccess ? (
        <Alert tone="success">Invitation accepted. It sends shortly.</Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {rows.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors duration-150 hover:bg-surface"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{member.name}</p>
                  <p className="truncate text-muted-foreground text-sm">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {member.role}
                  </Badge>
                  <Stations member={member} />
                  <AccessGate resource="member" operation="delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      loading={remove.isPending}
                      onClick={() => remove.mutate({ memberId: member.id })}
                    >
                      Remove
                    </Button>
                  </AccessGate>
                </div>
              </li>
            ))}
            {rows.length === 0 ? (
              <li className="px-4 py-10 text-center text-muted-foreground text-sm">
                No one here yet. Invite the first teammate above.
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The set with one post flipped, rebuilt from `STATIONS` so it comes back in the registry's
 * own order and can never contain a name the registry does not declare. The whole set is
 * sent, which is what the contract asks for: two managers each toggling their own half of a
 * roster would otherwise take turns undoing each other.
 */
function toggled(current: readonly Station[], station: Station): Station[] {
  return STATIONS.filter((candidate) =>
    candidate === station
      ? !current.some((held) => held === station)
      : current.some((held) => held === candidate),
  );
}

/**
 * Which posts this seat works, editable by anybody the registry lets roster and read-only to
 * everybody else. The branch is `usePermission("member", "manage")` - the same question the
 * gateway will ask of the call - rather than a role compared by hand.
 *
 * It is a branch rather than an `AccessGate` because the two answers are different things:
 * a station is a fact `member:read` already returned, so somebody who may see the roster may
 * see it. What they may not do is change it, and that control simply is not rendered.
 */
function Stations({ member }: { member: Member }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const mayRoster = usePermission("member", "manage");

  const roster = useMutation(
    trpc.member.setStations.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.member.list.queryKey() });
      },
    }),
  );

  if (!mayRoster) {
    return (
      <div className="flex items-center gap-1">
        {member.stations.map((station) => (
          <Badge key={station} variant="outline">
            {station}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/* A fieldset rather than a div with role="group": the toggles are one control with
          one question, and a screen reader needs to hear whose roster it is reading. */}
      <fieldset className="flex items-center gap-1 border-0 p-0">
        <legend className="sr-only">Stations for {member.name}</legend>
        {STATIONS.map((station) => {
          const held = member.stations.some((candidate) => candidate === station);
          return (
            <Button
              key={station}
              type="button"
              size="sm"
              variant={held ? "default" : "outline"}
              aria-pressed={held}
              disabled={roster.isPending}
              onClick={() =>
                roster.mutate({
                  memberId: member.id,
                  stations: toggled(member.stations, station),
                })
              }
            >
              {station}
            </Button>
          );
        })}
      </fieldset>
      <Denial error={roster.error} resource="member" />
    </div>
  );
}
