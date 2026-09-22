/**
 * SOT: payment-handlers, payment-reconcile, refund-handler, webhook-confirmation
 * WHAT   Business rules for taking money and giving it back.
 * WHY    One rule outranks the rest: an order becomes paid because a signature-verified
 *        webhook said so, never because a browser reached a success screen. `create` opens a
 *        payment and marks nothing; `reconcile` is the only path that moves an order.
 * HOW    Reconciliation is idempotent. A provider retries a webhook whenever it is unsure,
 *        so arriving twice must be harmless - the second one finds the payment already
 *        captured and returns the same answer instead of paying the order again.
 * WHERE  services/orders/src/payment.adapter.ts, apps/web/src/app/api/webhooks
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";
import { ORDER_TRANSITIONS } from "./constants";
import { orderService, paymentService } from "./order.service";
import { issueRefund, openCheckout } from "./payment.adapter";
import { asOrderStatusOrThrow, assertTransition } from "./payment.support";
import type { PaymentRow } from "./schema";

const PAYMENT_METHODS = ["upi", "card", "netbanking", "wallet", "cash"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const PAYMENT_STATES = [
  "created",
  "pending",
  "authorized",
  "captured",
  "failed",
  "refunded",
] as const;
type PaymentState = (typeof PAYMENT_STATES)[number];

const asMethod = (value: string | null): PaymentMethod | null =>
  PAYMENT_METHODS.find((candidate) => candidate === value) ?? null;

const asState = (value: string): PaymentState =>
  PAYMENT_STATES.find((candidate) => candidate === value) ?? "created";

const toPaymentDto = (row: PaymentRow) => ({
  id: row.id,
  orderId: row.orderId,
  provider: row.provider,
  providerOrderId: row.providerOrderId,
  providerPaymentId: row.providerPaymentId,
  method: asMethod(row.method),
  amountPaise: row.amountPaise,
  refundedPaise: row.refundedPaise,
  currency: row.currency,
  status: asState(row.status),
  signatureVerified: row.signatureVerified,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const paymentHandlers = [
  handlerFor("payment", "read", async ({ ctx, input }) => {
    const page = await paymentService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
      ...(input.id === undefined ? {} : { id: input.id }),
    });
    return { items: page.items.map(toPaymentDto), nextCursor: page.nextCursor };
  }),

  /**
   * Opens a payment with the provider and hands back what the client needs to complete it.
   * Note what it does not do: it does not touch the order's status, and it does not trust the
   * amount from anywhere except the order the server already priced.
   */
  handlerFor("payment", "create", async ({ ctx, input }) => {
    const order = await orderService.byId({ organizationId: ctx.orgId, id: input.orderId });
    if (order === null) throw new ServiceError("NOT_FOUND", "Order not found.");
    if (order.paymentStatus === "paid") {
      throw new ServiceError("CONFLICT", "This order has already been paid.");
    }

    const handoff = await openCheckout({
      provider: input.method === "cash" ? "cash" : "razorpay",
      orderId: order.id,
      orderNumber: order.orderNumber,
      organizationId: ctx.orgId,
      amountPaise: order.totalPaise,
    });

    const created = await paymentService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      orderId: order.id,
      provider: handoff.provider,
      providerOrderId: handoff.providerOrderId,
      providerPaymentId: null,
      method: input.method,
      amountPaise: order.totalPaise,
      currency: handoff.currency,
      status: "pending",
      signatureVerified: false,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The payment was not opened.");

    return { payment: toPaymentDto(created), checkout: handoff };
  }),

  handlerFor("payment", "manage", ({ ctx, input }) => {
    if (input.action === "reconcile") {
      return reconcile({ organizationId: ctx.orgId, input });
    }
    if (input.action === "record_cash") {
      return recordCash({
        organizationId: ctx.orgId,
        orderId: input.orderId,
        amountPaise: input.amountPaise,
      });
    }
    return refund({
      organizationId: ctx.orgId,
      id: input.id,
      amountPaise: input.amountPaise,
      reason: input.reason,
    });
  }),
];

type ReconcileInput = {
  providerPaymentId: string;
  providerOrderId: string;
  outcome: "captured" | "failed";
  method?: PaymentMethod | undefined;
  amountPaise: number;
};

/**
 * The only path that marks an order paid. Idempotent by inspection rather than by a lock: a
 * payment already captured is returned unchanged, so a provider retrying its webhook three
 * times pays the order once.
 */
async function reconcile(args: { organizationId: string; input: ReconcileInput }) {
  const { organizationId, input } = args;
  const existing =
    (await paymentService.byProviderPaymentId({
      organizationId,
      provider: "razorpay",
      providerPaymentId: input.providerPaymentId,
    })) ??
    (await paymentService.byProviderOrderId({
      organizationId,
      provider: "razorpay",
      providerOrderId: input.providerOrderId,
    }));

  if (existing === null) throw new ServiceError("NOT_FOUND", "No payment matches that reference.");
  if (existing.status === "captured") return toPaymentDto(existing);

  if (input.amountPaise !== existing.amountPaise) {
    throw new ServiceError(
      "CONFLICT",
      "The amount the provider settled does not match the order total.",
    );
  }

  const updated = await paymentService.update({
    organizationId,
    id: existing.id,
    patch: {
      status: input.outcome,
      providerPaymentId: input.providerPaymentId,
      signatureVerified: true,
      ...(input.method === undefined ? {} : { method: input.method }),
    },
  });
  if (updated === null) throw new ServiceError("INTERNAL", "The payment was not updated.");

  const order = await orderService.byId({ organizationId, id: existing.orderId });
  if (order !== null) {
    const from = asOrderStatusOrThrow(order.status);
    const to = input.outcome === "captured" ? "paid" : "payment_failed";
    if (from !== to) {
      assertTransition(ORDER_TRANSITIONS, from, to, "order");
      await orderService.update({
        organizationId,
        id: order.id,
        patch: { status: to, paymentStatus: input.outcome === "captured" ? "paid" : "failed" },
      });
    }
  }

  return toPaymentDto(updated);
}

/** Cash at the counter. Settled the moment a cashier says it was, because it was. */
async function recordCash(args: { organizationId: string; orderId: string; amountPaise: number }) {
  const order = await orderService.byId({
    organizationId: args.organizationId,
    id: args.orderId,
  });
  if (order === null) throw new ServiceError("NOT_FOUND", "Order not found.");

  const created = await paymentService.create({
    id: crypto.randomUUID(),
    organizationId: args.organizationId,
    orderId: order.id,
    provider: "cash",
    providerOrderId: `cash_${order.id}`,
    providerPaymentId: `cash_${crypto.randomUUID()}`,
    method: "cash",
    amountPaise: args.amountPaise,
    currency: order.currency,
    status: "captured",
    /** Cash needs no signature: the counter is the proof, and a human is accountable for it. */
    signatureVerified: true,
  });
  if (created === null) throw new ServiceError("INTERNAL", "The payment was not recorded.");

  const from = asOrderStatusOrThrow(order.status);
  if (from !== "paid") {
    assertTransition(ORDER_TRANSITIONS, from, "paid", "order");
    await orderService.update({
      organizationId: args.organizationId,
      id: order.id,
      patch: { status: "paid", paymentStatus: "paid" },
    });
  }

  return toPaymentDto(created);
}

async function refund(args: {
  organizationId: string;
  id: string;
  amountPaise: number;
  reason: string;
}) {
  const existing = await paymentService.byId({
    organizationId: args.organizationId,
    id: args.id,
  });
  if (existing === null) throw new ServiceError("NOT_FOUND", "Payment not found.");
  if (existing.status !== "captured") {
    throw new ServiceError("CONFLICT", "Only a captured payment can be refunded.");
  }

  const remaining = existing.amountPaise - existing.refundedPaise;
  if (args.amountPaise > remaining) {
    throw new ServiceError(
      "CONFLICT",
      `Only ₹${(remaining / 100).toFixed(2)} of this payment is left to refund.`,
    );
  }

  const providerRefundId = await issueRefund({
    provider: existing.provider,
    providerPaymentId: existing.providerPaymentId,
    amountPaise: args.amountPaise,
  });

  await paymentService.addRefund({
    id: crypto.randomUUID(),
    organizationId: args.organizationId,
    paymentId: existing.id,
    orderId: existing.orderId,
    amountPaise: args.amountPaise,
    reason: args.reason,
    status: "processed",
    providerRefundId,
  });

  const updated = await paymentService.bumpRefunded({
    organizationId: args.organizationId,
    id: existing.id,
    amountPaise: args.amountPaise,
  });
  if (updated === null) throw new ServiceError("INTERNAL", "The refund was not recorded.");

  const fullyRefunded = updated.refundedPaise >= updated.amountPaise;
  await paymentService.update({
    organizationId: args.organizationId,
    id: existing.id,
    patch: { status: fullyRefunded ? "refunded" : "captured" },
  });

  const order = await orderService.byId({
    organizationId: args.organizationId,
    id: existing.orderId,
  });
  if (order !== null) {
    await orderService.update({
      organizationId: args.organizationId,
      id: order.id,
      patch: { paymentStatus: fullyRefunded ? "refunded" : "partially_refunded" },
    });
  }

  return toPaymentDto(updated);
}
