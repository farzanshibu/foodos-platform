/**
 * SOT: coupons-manager, coupon-codes, redemption-caps
 * WHAT   The codes guests type at checkout, each attached to an offer.
 * WHY    A coupon carries no discount of its own - it points at a promotion, which is where
 *        the rule lives. That separation is what lets one offer have a printed code, a
 *        WhatsApp code and a QR campaign code with different caps and one set of conditions.
 * WHERE  services/crm/src/marketing.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreateRow, controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Promotion = OutputOf<"promotion", "read">["items"][number];

export function CouponsManager({ promotions }: { promotions: Promotion[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [promotionId, setPromotionId] = useState(promotions[0]?.id ?? "");
  const [cap, setCap] = useState("");

  const coupons = useQuery(
    trpc.coupon.list.queryOptions({ limit: 50, cursor: null, activeOnly: false }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.coupon.list.queryKey() });
  };
  const create = useMutation(
    trpc.coupon.create.mutationOptions({
      onSuccess: () => {
        setCode("");
        refresh();
      },
    }),
  );
  const update = useMutation(trpc.coupon.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.coupon.remove.mutationOptions({ onSuccess: refresh }));

  return (
    <PageShell
      title="Coupons"
      description="Codes guests type at checkout. Each one points at an offer."
    >
      <Gate resource="coupon" operation="create">
        <CreateRow>
          <Field label="Code" width="w-44">
            <input
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
              }}
              placeholder="LUNCH20"
              className={controlClass}
            />
          </Field>
          <Field label="Offer">
            <select
              value={promotionId}
              onChange={(event) => {
                setPromotionId(event.target.value);
              }}
              className={controlClass}
            >
              {promotions.map((promotion) => (
                <option key={promotion.id} value={promotion.id}>
                  {promotion.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Use limit" width="w-32">
            <input
              value={cap}
              inputMode="numeric"
              placeholder="none"
              onChange={(event) => {
                setCap(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Button
            disabled={create.isPending || code.trim().length < 3 || promotionId === ""}
            onClick={() => {
              create.mutate({
                promotionId,
                code: code.trim(),
                ...(cap.trim() === "" ? {} : { maxRedemptions: Math.max(1, Number(cap) || 1) }),
              });
            }}
          >
            Add code
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}

      {promotions.length === 0 ? (
        <Empty
          icon="🎟️"
          title="No offers to attach a code to"
          detail="Create a promotion first — a code on its own has nothing to give away."
        />
      ) : coupons.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : coupons.data.items.length === 0 ? (
        <Empty
          icon="🎟️"
          title="No codes yet"
          detail="Add one above and guests can type it at checkout straight away."
        />
      ) : (
        <ListCard>
          <ul>
            {coupons.data.items.map((coupon) => (
              <li key={coupon.id}>
                <ListRow
                  title={<span className="font-mono">{coupon.code}</span>}
                  subtitle={`${coupon.promotionName} · used ${String(coupon.redemptionCount)}${
                    coupon.maxRedemptions === null ? "" : ` of ${String(coupon.maxRedemptions)}`
                  } times`}
                  meta={
                    <Badge variant={coupon.isActive ? "secondary" : "outline"}>
                      {coupon.isActive ? "Live" : "Off"}
                    </Badge>
                  }
                  actions={
                    <div className="flex gap-2">
                      <Gate resource="coupon" operation="update">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => {
                            update.mutate({ id: coupon.id, isActive: !coupon.isActive });
                          }}
                        >
                          {coupon.isActive ? "Turn off" : "Turn on"}
                        </Button>
                      </Gate>
                      <Gate resource="coupon" operation="delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            remove.mutate({ id: coupon.id });
                          }}
                        >
                          Delete
                        </Button>
                      </Gate>
                    </div>
                  }
                />
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}
