/**
 * SOT: customers-manager, crm-list, customer-segments
 * WHAT   Who has eaten here, what they spent, and when they were last in.
 * WHY    Segments are derived by the crm service from the numbers, never stored - a stored
 *        segment is wrong the moment somebody orders again, and every screen reading it is
 *        wrong with it. This one just renders what it is told.
 * WHERE  services/crm/src/crm.handlers.ts
 */
"use client";

import { Badge } from "@foodos/ui/badge";
import { Denial } from "@foodos/ui/denial";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { controlClass, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

const SEGMENTS = ["new", "returning", "vip", "inactive", "high_value"] as const;
const SORTS = [
  { key: "recent", label: "Newest" },
  { key: "spend", label: "Biggest spend" },
  { key: "orders", label: "Most orders" },
  { key: "name", label: "Name" },
] as const;

export function CustomersManager() {
  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number] | "">("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("recent");

  const customers = useQuery(
    trpc.customer.list.queryOptions({
      limit: 50,
      cursor: null,
      sort,
      ...(search.trim() === "" ? {} : { search: search.trim() }),
      ...(segment === "" ? {} : { segment }),
    }),
  );

  return (
    <PageShell
      title="Customers"
      description="Everyone who has left a name or a number, and what they are worth."
      action={
        <select
          value={sort}
          onChange={(event) => {
            const chosen = SORTS.find((entry) => entry.key === event.target.value);
            if (chosen !== undefined) setSort(chosen.key);
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {SORTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search by name, phone or email"
          className={`${controlClass} max-w-80`}
        />
        <select
          value={segment}
          onChange={(event) => {
            const chosen = SEGMENTS.find((entry) => entry === event.target.value);
            setSegment(chosen ?? "");
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Every segment</option>
          {SEGMENTS.map((entry) => (
            <option key={entry} value={entry}>
              {entry.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {customers.error === null ? null : <Denial error={customers.error} />}

      {customers.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : customers.data.items.length === 0 ? (
        <Empty
          icon="👥"
          title="Nobody yet"
          detail="A diner appears here the first time they give a name at checkout."
        />
      ) : (
        <ListCard>
          <ul>
            {customers.data.items.map((customer) => (
              <li key={customer.id}>
                <ListRow
                  title={customer.name ?? customer.phone ?? "Guest"}
                  subtitle={
                    <>
                      {customer.totalOrders} order{customer.totalOrders === 1 ? "" : "s"} ·{" "}
                      {money(customer.totalSpendPaise)} · average{" "}
                      {money(customer.averageOrderPaise)}
                      {customer.lastVisitAt === null
                        ? ""
                        : ` · last in ${new Date(customer.lastVisitAt).toLocaleDateString()}`}
                    </>
                  }
                  meta={
                    <div className="flex gap-1">
                      <Badge variant="secondary">{customer.segment.replace(/_/g, " ")}</Badge>
                      {customer.loyaltyPoints === 0 ? null : (
                        <Badge variant="outline">{customer.loyaltyPoints} pts</Badge>
                      )}
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
