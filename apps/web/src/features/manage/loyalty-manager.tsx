/**
 * SOT: loyalty-manager, points-programme, loyalty-ledger-ui
 * WHAT   The points programme: how fast they are earned, what they are worth, and the tiers.
 * WHY    A balance is never edited here, and there is no box to type one into. Adjustments
 *        post a ledger entry, so every point a diner holds can be explained to them - which
 *        is the only version of a loyalty balance anybody can argue about and win.
 * WHERE  services/crm/src/marketing.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { controlClass, Field } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];

export function LoyaltyManager({ restaurants }: { restaurants: Restaurant[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("Rewards");
  const [earn, setEarn] = useState("10");
  const [redeem, setRedeem] = useState("10");
  const [minimum, setMinimum] = useState("100");

  const loyalty = useQuery(trpc.loyalty.read.queryOptions({ limit: 20, cursor: null }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.loyalty.read.queryKey() });
  };
  const create = useMutation(trpc.loyalty.createProgramme.mutationOptions({ onSuccess: refresh }));
  const update = useMutation(trpc.loyalty.updateProgramme.mutationOptions({ onSuccess: refresh }));

  const programme = loyalty.data?.programme ?? null;

  return (
    <PageShell
      title="Loyalty"
      description="Points earned on spend, redeemed against a bill. One programme per organisation."
    >
      {create.error === null ? null : <Denial error={create.error} />}
      {update.error === null ? null : <Denial error={update.error} />}

      {programme === null ? (
        <Gate resource="loyalty" operation="create">
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="font-medium text-foreground">Start a programme</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Called">
                  <input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    className={controlClass}
                  />
                </Field>
                <Field label="Points per ₹100" width="w-36">
                  <input
                    value={earn}
                    inputMode="numeric"
                    onChange={(event) => {
                      setEarn(event.target.value);
                    }}
                    className={controlClass}
                  />
                </Field>
                <Field label="Paise per point" width="w-36">
                  <input
                    value={redeem}
                    inputMode="numeric"
                    onChange={(event) => {
                      setRedeem(event.target.value);
                    }}
                    className={controlClass}
                  />
                </Field>
                <Field label="Redeem from" width="w-32">
                  <input
                    value={minimum}
                    inputMode="numeric"
                    onChange={(event) => {
                      setMinimum(event.target.value);
                    }}
                    className={controlClass}
                  />
                </Field>
              </div>
              <p className="text-muted-foreground text-sm">
                A guest spending {money(10_000)} earns {earn} points, worth{" "}
                {money(Math.max(0, Number(earn) * Number(redeem)))} back.
              </p>
              <Button
                disabled={create.isPending || restaurants.length === 0}
                onClick={() => {
                  const restaurantId = restaurants[0]?.id;
                  if (restaurantId === undefined) return;
                  create.mutate({
                    restaurantId,
                    name: name.trim(),
                    pointsPerHundred: Math.max(1, Number(earn) || 10),
                    redeemPaisePerPoint: Math.max(1, Number(redeem) || 10),
                    minimumRedeemPoints: Math.max(1, Number(minimum) || 100),
                    tiers: [],
                  });
                }}
              >
                Start it
              </Button>
            </CardContent>
          </Card>
        </Gate>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-foreground">{programme.name}</p>
              <Gate resource="loyalty" operation="update">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => {
                    update.mutate({ id: programme.id, isActive: !programme.isActive });
                  }}
                >
                  {programme.isActive ? "Pause" : "Resume"}
                </Button>
              </Gate>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <dt>Earn</dt>
                <dd className="text-foreground">
                  {programme.pointsPerHundred} points per {money(10_000)}
                </dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Each point is worth</dt>
                <dd className="text-foreground">{money(programme.redeemPaisePerPoint)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Redeem from</dt>
                <dd className="text-foreground">{programme.minimumRedeemPoints} points</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Points expire</dt>
                <dd className="text-foreground">
                  {programme.expiryDays === null ? "never" : `after ${programme.expiryDays} days`}
                </dd>
              </div>
            </dl>
            {programme.tiers.length === 0 ? null : (
              <p className="text-muted-foreground text-sm">
                Tiers: {programme.tiers.map((tier) => tier.name).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {programme === null ? (
        <Empty
          icon="🎁"
          title="No programme running"
          detail="Points are earned automatically on every completed order once one exists."
        />
      ) : null}
    </PageShell>
  );
}
