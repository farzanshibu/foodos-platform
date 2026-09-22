/**
 * SOT: analytics-dashboard, revenue-view, sales-report-ui, qr-conversion
 * WHAT   What the restaurant made, what sold, and whether the codes on the tables are working.
 * WHY    Every number here was computed by the insights service from facts it built off the
 *        event stream. Nothing on this screen adds up an order list in the browser, which is
 *        why the totals here and the totals on a receipt cannot drift.
 * HOW    Six reports, each with its own shape, so a chart parses a known object rather than
 *        hunting for keys in a bag of numbers.
 * WHERE  services/insights/src/reports.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { cn } from "@foodos/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { BranchPicker } from "@/features/manage/branch-picker";
import { PageShell } from "@/features/manage/page-shell";
import { duration, money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Branch = OutputOf<"branch", "read">["items"][number];

const RANGES = [
  { key: "today", label: "Today", days: 0 },
  { key: "week", label: "7 days", days: 7 },
  { key: "month", label: "30 days", days: 30 },
] as const;

function since(days: number): Date {
  const from = new Date();
  if (days === 0) from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - days);
  return from;
}

export function AnalyticsDashboard({ branches }: { branches: Branch[] }) {
  const trpc = useTRPC();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);

  const scope = {
    from: since(range.days),
    to: new Date(),
    granularity: range.days === 0 ? ("hour" as const) : ("day" as const),
    ...(branchId === "" ? {} : { branchId }),
  };

  const sales = useQuery(trpc.analytics.report.queryOptions({ report: "sales", ...scope }));
  const orders = useQuery(trpc.analytics.report.queryOptions({ report: "orders", ...scope }));
  const qr = useQuery(trpc.analytics.report.queryOptions({ report: "qr", ...scope }));
  const requests = useQuery(trpc.analytics.report.queryOptions({ report: "requests", ...scope }));
  const menu = useQuery(trpc.analytics.report.queryOptions({ report: "menu", ...scope, limit: 5 }));

  /**
   * Narrowed by comparing the SAME reference twice rather than through optional chaining,
   * which does not narrow a discriminated union. Each report has its own shape, and this is
   * where the screen picks the one it asked for.
   */
  const salesData = sales.data !== undefined && sales.data.report === "sales" ? sales.data : null;
  const orderData =
    orders.data !== undefined && orders.data.report === "orders" ? orders.data : null;
  const qrData = qr.data !== undefined && qr.data.report === "qr" ? qr.data : null;
  const requestData =
    requests.data !== undefined && requests.data.report === "requests" ? requests.data : null;
  const menuData = menu.data !== undefined && menu.data.report === "menu" ? menu.data : null;

  return (
    <PageShell
      title="Analytics"
      description="Revenue, orders and how the codes on your tables are performing."
      action={<BranchPicker branches={branches} value={branchId} onChange={setBranchId} />}
    >
      <RangePicker range={range} onChange={setRange} />

      {sales.error === null ? null : <Denial error={sales.error} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Net revenue" value={salesData === null ? "—" : money(salesData.netPaise)} />
        <Kpi label="Orders" value={orderData === null ? "—" : String(orderData.total)} />
        <Kpi
          label="Average order"
          value={orderData === null ? "—" : money(orderData.averageOrderPaise)}
        />
        <Kpi
          label="Scan to order"
          value={qrData === null ? "—" : `${String(Math.round(qrData.conversionRate * 100))}%`}
          detail={qrData === null ? undefined : `${String(qrData.scans)} scans`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BestSellers rows={menuData === null ? [] : menuData.best} />
        <RequestHealth data={requestData} />
      </div>

      <SalesBreakdown data={salesData} />
    </PageShell>
  );
}

function RangePicker({
  range,
  onChange,
}: {
  range: (typeof RANGES)[number];
  onChange: (next: (typeof RANGES)[number]) => void;
}) {
  return (
    <div className="flex gap-2">
      {RANGES.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => {
            onChange(entry);
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            range.key === entry.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

function BestSellers({
  rows,
}: {
  rows: readonly { itemId: string; name: string; quantity: number; revenuePaise: number }[];
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-medium text-foreground">Best sellers</p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sold in this period yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((row) => (
              <li key={row.itemId} className="flex justify-between">
                <span className="text-foreground">{row.name}</span>
                <span className="text-muted-foreground">
                  {row.quantity} · {money(row.revenuePaise)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RequestHealth({
  data,
}: {
  data: {
    total: number;
    medianAcknowledgeSeconds: number | null;
    slaCompliance: number;
  } | null;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-medium text-foreground">Service requests</p>
        {data === null ? (
          <p className="text-muted-foreground text-sm">No requests in this period.</p>
        ) : (
          <dl className="space-y-1 text-sm">
            <Row label="Total" value={String(data.total)} />
            <Row
              label="Median answer time"
              value={
                data.medianAcknowledgeSeconds === null
                  ? "—"
                  : duration(data.medianAcknowledgeSeconds)
              }
            />
            <Row
              label="Answered in time"
              value={`${String(Math.round(data.slaCompliance * 100))}%`}
            />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function SalesBreakdown({
  data,
}: {
  data: {
    grossPaise: number;
    discountsPaise: number;
    refundsPaise: number;
    taxPaise: number;
    netPaise: number;
  } | null;
}) {
  if (data === null) return null;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-medium text-foreground">Where the money went</p>
        <dl className="space-y-1 text-sm">
          <Row label="Gross" value={money(data.grossPaise)} />
          <Row label="Discounts" value={`− ${money(data.discountsPaise)}`} />
          <Row label="Refunds" value={`− ${money(data.refundsPaise)}`} />
          <Row label="Tax collected" value={money(data.taxPaise)} />
          <div className="flex justify-between border-border border-t pt-2 font-semibold text-foreground">
            <dt>Net</dt>
            <dd>{money(data.netPaise)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p className="font-semibold text-2xl text-foreground">{value}</p>
        {detail === undefined ? null : <p className="text-muted-foreground text-xs">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
