/**
 * SOT: promotions-manager, offer-rules, discount-config
 * WHAT   The offers a restaurant runs, and the conditions attached to them.
 * WHY    A promotion here is a RULE, not a discount applied to anything. The catalogue reads
 *        it when it prices a cart, after every line has been priced - which is why a
 *        percentage offer can never re-discount the parts inside a combo.
 * WHERE  services/crm/src/marketing.handlers.ts, services/catalog/src/quote.handlers.ts
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
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];
type Promotion = OutputOf<"promotion", "read">["items"][number];

const TYPES = [
  { key: "percentage", label: "Percentage off" },
  { key: "fixed", label: "Fixed amount off" },
  { key: "first_order", label: "First order" },
  { key: "happy_hour", label: "Happy hour" },
] as const;

export function PromotionsManager({ restaurants }: { restaurants: Restaurant[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["key"]>("percentage");
  const [value, setValue] = useState("10");
  const [minimum, setMinimum] = useState("");

  const promotions = useQuery(
    trpc.promotion.list.queryOptions({ limit: 50, cursor: null, activeOnly: false }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.promotion.list.queryKey() });
  };
  const create = useMutation(
    trpc.promotion.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const update = useMutation(trpc.promotion.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.promotion.remove.mutationOptions({ onSuccess: refresh }));

  const usesPercentage = type === "percentage" || type === "happy_hour";

  return (
    <PageShell
      title="Promotions"
      description="Offers, and the conditions that decide when they apply."
    >
      <Gate resource="promotion" operation="create">
        <CreateRow>
          <Field label="Name">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Weekday lunch"
              className={controlClass}
            />
          </Field>
          <Field label="Type" width="w-48">
            <select
              value={type}
              onChange={(event) => {
                const chosen = TYPES.find((entry) => entry.key === event.target.value);
                if (chosen !== undefined) setType(chosen.key);
              }}
              className={controlClass}
            >
              {TYPES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={usesPercentage ? "Percent off" : "Amount off ₹"} width="w-32">
            <input
              value={value}
              inputMode="decimal"
              onChange={(event) => {
                setValue(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Field label="Minimum order ₹" width="w-36">
            <input
              value={minimum}
              inputMode="decimal"
              placeholder="none"
              onChange={(event) => {
                setMinimum(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Button
            disabled={create.isPending || name.trim() === "" || restaurants.length === 0}
            onClick={() => {
              const restaurantId = restaurants[0]?.id;
              if (restaurantId === undefined) return;
              create.mutate({
                restaurantId,
                name: name.trim(),
                type,
                ...(usesPercentage
                  ? { percentage: Math.min(100, Math.max(1, Number(value) || 10)) }
                  : { amountPaise: Math.max(1, Math.round(Number(value) * 100)) }),
                ...(minimum.trim() === ""
                  ? {}
                  : {
                      conditions: {
                        minimumOrderPaise: Math.round(Number(minimum) * 100),
                      },
                    }),
              });
            }}
          >
            Add offer
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}

      {promotions.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : promotions.data.items.length === 0 ? (
        <Empty
          icon="🏷️"
          title="No offers running"
          detail="Create one, then attach a code to it on the Coupons screen."
        />
      ) : (
        <ListCard>
          <ul>
            {promotions.data.items.map((promotion) => (
              <li key={promotion.id}>
                <PromotionRow
                  promotion={promotion}
                  pending={update.isPending || remove.isPending}
                  onToggle={() => {
                    update.mutate({ id: promotion.id, isActive: !promotion.isActive });
                  }}
                  onDelete={() => {
                    remove.mutate({ id: promotion.id });
                  }}
                />
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}

function PromotionRow({
  promotion,
  onToggle,
  onDelete,
  pending,
}: {
  promotion: Promotion;
  onToggle: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const worth =
    promotion.percentage === null
      ? money(promotion.amountPaise ?? 0)
      : `${String(promotion.percentage)}%`;
  const minimum =
    promotion.conditions.minimumOrderPaise === null
      ? ""
      : ` · minimum ${money(promotion.conditions.minimumOrderPaise)}`;

  return (
    <ListRow
      title={promotion.name}
      subtitle={`${worth} off${minimum} · ${String(promotion.redemptionCount)} redeemed`}
      meta={
        <Badge variant={promotion.isActive ? "secondary" : "outline"}>
          {promotion.isActive ? "Live" : "Paused"}
        </Badge>
      }
      actions={
        <div className="flex gap-2">
          <Gate resource="promotion" operation="update">
            <Button size="sm" variant="outline" disabled={pending} onClick={onToggle}>
              {promotion.isActive ? "Pause" : "Resume"}
            </Button>
          </Gate>
          <Gate resource="promotion" operation="delete">
            <Button size="sm" variant="ghost" disabled={pending} onClick={onDelete}>
              Delete
            </Button>
          </Gate>
        </div>
      }
    />
  );
}
