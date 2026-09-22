/**
 * SOT: analytics-reports, sales-report, menu-report, qr-report, request-report
 * WHAT   The six reports, computed from this service's own read models.
 * WHY    Reporting reads facts this service built from the event stream, never another
 *        service's tables. That is what lets a year-long query be slow without making an
 *        order slow, and it is why the service boundary survives having a reporting surface.
 * HOW    Every report answers with its own shape rather than a bag of numbers, so a chart
 *        parses a known object instead of hoping the right keys are present.
 * WHERE  services/insights/src/insights.service.ts
 */
import "server-only";

import type { InputOf, OutputOf } from "@foodos/contracts";

import { eventService, factService } from "./insights.service";
import type { OrderFactRow } from "./schema";

type ReportInput = InputOf<"analytics", "read">;
type ReportOutput = OutputOf<"analytics", "read">;

const COMPLETED = "completed";
const CANCELLED = ["cancelled_by_customer", "cancelled_by_restaurant", "payment_failed"];

/** Buckets a timestamp to the requested granularity, so a series has stable keys. */
function bucketOf(at: Date, granularity: ReportInput["granularity"]): Date {
  const bucket = new Date(at);
  bucket.setMinutes(0, 0, 0);
  if (granularity === "hour") return bucket;
  bucket.setHours(0, 0, 0, 0);
  if (granularity === "day") return bucket;
  if (granularity === "week") {
    bucket.setDate(bucket.getDate() - bucket.getDay());
    return bucket;
  }
  bucket.setDate(1);
  return bucket;
}

function seriesOf(
  rows: readonly OrderFactRow[],
  granularity: ReportInput["granularity"],
  measure: (row: OrderFactRow) => number,
) {
  const buckets = new Map<number, number>();
  for (const row of rows) {
    const key = bucketOf(row.placedAt, granularity).getTime();
    buckets.set(key, (buckets.get(key) ?? 0) + measure(row));
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([at, value]) => ({ at: new Date(at), value }));
}

type LineFact = {
  itemId: string;
  name: string;
  quantity: number;
  revenuePaise: number;
  categoryId: string | null;
};

function readLines(value: unknown): LineFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const fields: ReadonlyMap<string, unknown> =
      typeof entry === "object" && entry !== null ? new Map(Object.entries(entry)) : new Map();
    const itemId = fields.get("itemId");
    const name = fields.get("name");
    const quantity = fields.get("quantity");
    const revenuePaise = fields.get("revenuePaise");
    const categoryId = fields.get("categoryId");
    return typeof itemId === "string" &&
      typeof name === "string" &&
      typeof quantity === "number" &&
      typeof revenuePaise === "number"
      ? [
          {
            itemId,
            name,
            quantity,
            revenuePaise,
            categoryId: typeof categoryId === "string" ? categoryId : null,
          },
        ]
      : [];
  });
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

export async function buildReport(args: {
  organizationId: string;
  input: ReportInput;
}): Promise<ReportOutput> {
  const { organizationId, input } = args;
  const scope = {
    organizationId,
    from: input.from,
    to: input.to,
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
  };

  if (input.report === "requests") return requestReport(scope);
  if (input.report === "qr") return qrReport(scope, input.granularity);

  const orders = await factService.orders(scope);

  switch (input.report) {
    case "sales":
      return salesReport(orders, input.granularity);
    case "orders":
      return orderReport(orders, input.granularity);
    case "customers":
      return customerReport(orders, input.granularity);
    default:
      return menuReport(orders, input.limit);
  }
}

function salesReport(
  orders: readonly OrderFactRow[],
  granularity: ReportInput["granularity"],
): ReportOutput {
  const paid = orders.filter((row) => !CANCELLED.some((status) => status === row.status));
  const gross = paid.reduce((sum, row) => sum + row.subtotalPaise, 0);
  const discounts = paid.reduce((sum, row) => sum + row.discountPaise, 0);
  const tax = paid.reduce((sum, row) => sum + row.taxPaise, 0);
  const refunds = paid.reduce((sum, row) => sum + row.refundedPaise, 0);
  return {
    report: "sales",
    grossPaise: gross,
    netPaise: Math.max(0, gross - discounts - refunds),
    discountsPaise: discounts,
    taxPaise: tax,
    refundsPaise: refunds,
    series: seriesOf(paid, granularity, (row) => row.totalPaise),
  };
}

function orderReport(
  orders: readonly OrderFactRow[],
  granularity: ReportInput["granularity"],
): ReportOutput {
  const completed = orders.filter((row) => row.status === COMPLETED);
  const cancelled = orders.filter((row) => CANCELLED.some((status) => status === row.status));
  const byType = new Map<string, number>();
  for (const row of orders) byType.set(row.orderType, (byType.get(row.orderType) ?? 0) + 1);

  return {
    report: "orders",
    total: orders.length,
    completed: completed.length,
    cancelled: cancelled.length,
    averageOrderPaise:
      completed.length === 0
        ? 0
        : Math.round(completed.reduce((sum, row) => sum + row.totalPaise, 0) / completed.length),
    byType: [...byType.entries()].map(([orderType, count]) => ({ orderType, count })),
    series: seriesOf(orders, granularity, () => 1),
  };
}

function customerReport(
  orders: readonly OrderFactRow[],
  granularity: ReportInput["granularity"],
): ReportOutput {
  const byCustomer = new Map<string, number>();
  for (const row of orders) {
    if (row.customerId === null) continue;
    byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? 0) + 1);
  }
  const returning = [...byCustomer.values()].filter((count) => count > 1).length;
  const known = byCustomer.size;

  return {
    report: "customers",
    newCustomers: known - returning,
    returningCustomers: returning,
    repeatRate: known === 0 ? 0 : Number((returning / known).toFixed(4)),
    retentionRate: known === 0 ? 0 : Number((returning / known).toFixed(4)),
    bySegment: [
      { segment: "returning", count: returning },
      { segment: "new", count: known - returning },
    ],
    series: seriesOf(orders, granularity, () => 1),
  };
}

function menuReport(orders: readonly OrderFactRow[], limit: number): ReportOutput {
  const byItem = new Map<string, { name: string; quantity: number; revenuePaise: number }>();
  const byCategory = new Map<string, { name: string; revenuePaise: number }>();

  for (const row of orders) {
    for (const line of readLines(row.lines)) {
      const held = byItem.get(line.itemId) ?? { name: line.name, quantity: 0, revenuePaise: 0 };
      byItem.set(line.itemId, {
        name: line.name,
        quantity: held.quantity + line.quantity,
        revenuePaise: held.revenuePaise + line.revenuePaise,
      });
      if (line.categoryId === null) continue;
      const category = byCategory.get(line.categoryId) ?? {
        name: line.categoryId,
        revenuePaise: 0,
      };
      byCategory.set(line.categoryId, {
        name: category.name,
        revenuePaise: category.revenuePaise + line.revenuePaise,
      });
    }
  }

  const ranked = [...byItem.entries()]
    .map(([itemId, held]) => ({ itemId, ...held }))
    .sort((left, right) => right.revenuePaise - left.revenuePaise);

  return {
    report: "menu",
    best: ranked.slice(0, limit),
    /** The tail, worst first, so a menu review starts with what to cut. */
    worst: [...ranked].reverse().slice(0, limit),
    byCategory: [...byCategory.entries()].map(([categoryId, held]) => ({
      categoryId,
      name: held.name,
      revenuePaise: held.revenuePaise,
    })),
  };
}

async function qrReport(
  scope: { organizationId: string; from: Date; to: Date; branchId?: string },
  granularity: ReportInput["granularity"],
): Promise<ReportOutput> {
  const counts = await eventService.countsByName({
    ...scope,
    names: ["qr_scanned", "order_created", "payment_completed"],
  });
  const orders = await factService.orders(scope);
  const scans = counts.get("qr_scanned") ?? 0;
  const qrOrders = orders.filter((row) => row.source === "qr");
  const revenue = qrOrders.reduce((sum, row) => sum + row.totalPaise, 0);

  return {
    report: "qr",
    scans,
    uniqueVisitors: scans,
    repeatVisitors: 0,
    orders: qrOrders.length,
    conversionRate: scans === 0 ? 0 : Number((qrOrders.length / scans).toFixed(4)),
    revenuePaise: revenue,
    averageOrderPaise: qrOrders.length === 0 ? 0 : Math.round(revenue / qrOrders.length),
    byCode: [],
    series: seriesOf(qrOrders, granularity, () => 1),
  };
}

async function requestReport(scope: {
  organizationId: string;
  from: Date;
  to: Date;
  branchId?: string;
}): Promise<ReportOutput> {
  const facts = await factService.serviceFacts({ ...scope, kind: "request" });
  const completed = facts.filter((row) => row.secondsValue !== null);
  const acknowledged = facts.filter((row) => row.numericValue !== null);
  const withinSla = facts.filter((row) => !row.flag).length;

  const byType = new Map<string, { name: string; count: number }>();
  for (const row of facts) {
    const key = row.referenceId ?? "unknown";
    const held = byType.get(key) ?? { name: row.label ?? key, count: 0 };
    byType.set(key, { name: held.name, count: held.count + 1 });
  }

  return {
    report: "requests",
    total: facts.length,
    completed: completed.length,
    medianAcknowledgeSeconds: median(acknowledged.map((row) => Number(row.numericValue))),
    medianResolutionSeconds: median(completed.map((row) => row.secondsValue ?? 0)),
    slaCompliance: facts.length === 0 ? 1 : Number((withinSla / facts.length).toFixed(4)),
    byType: [...byType.entries()].map(([requestTypeId, held]) => ({
      requestTypeId,
      name: held.name,
      count: held.count,
    })),
    series: [],
  };
}
