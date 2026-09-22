/**
 * SOT: payment-adapter, razorpay-adapter, payment-vendor, webhook-signature
 * WHAT   The one file that knows a payment provider exists.
 * WHY    Vendors live behind a single adapter so swapping one is a change to this file and
 *        nothing else. Everything above it speaks in orders, amounts in paise, and a verdict.
 * HOW    Two providers. `cash` is real and complete - a counter that takes notes needs no
 *        gateway, and pretending otherwise would make the product unusable for half the
 *        market it is aimed at. `razorpay` is wired through the same interface and refuses
 *        clearly when it has no keys, rather than half-working.
 * WHERE  services/orders/src/payment.handlers.ts, packages/env
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceError } from "@foodos/contracts";
import { env } from "@foodos/env";

export type PaymentProvider = "razorpay" | "cash";

export type CheckoutHandoff = {
  readonly provider: string;
  readonly providerOrderId: string;
  readonly amountPaise: number;
  readonly currency: string;
  /** Safe to send to a browser. The secret half never leaves this file. */
  readonly publicKey: string | null;
  readonly redirectUrl: string | null;
};

/** Cash is settled at the counter, so its "provider order" is just the order it belongs to. */
function cashHandoff(args: { orderId: string; amountPaise: number }): CheckoutHandoff {
  return {
    provider: "cash",
    providerOrderId: `cash_${args.orderId}`,
    amountPaise: args.amountPaise,
    currency: "INR",
    publicKey: null,
    redirectUrl: null,
  };
}

async function razorpayHandoff(args: {
  orderId: string;
  orderNumber: string;
  organizationId: string;
  amountPaise: number;
}): Promise<CheckoutHandoff> {
  const keys = env.razorpay();
  if (keys === null) {
    throw new ServiceError(
      "INVALID_INPUT",
      "Online payment is not configured for this restaurant. Take payment at the counter.",
    );
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: "INR",
      receipt: args.orderNumber,
      /**
       * Sent so the webhook can find its way back. It is only as trustworthy as the webhook
       * signature that carries it home - which is verified before any of this is read - and
       * the service still checks the amount against the order it scopes to.
       */
      notes: { orderId: args.orderId, orgId: args.organizationId },
    }),
  });

  if (!response.ok) {
    throw new ServiceError("SERVICE_UNAVAILABLE", "The payment provider did not respond.");
  }

  const body: unknown = await response.json();
  const providerOrderId =
    typeof body === "object" && body !== null && "id" in body && typeof body.id === "string"
      ? body.id
      : null;
  if (providerOrderId === null) {
    throw new ServiceError("SERVICE_UNAVAILABLE", "The payment provider returned no order.");
  }

  return {
    provider: "razorpay",
    providerOrderId,
    amountPaise: args.amountPaise,
    currency: "INR",
    publicKey: keys.keyId,
    redirectUrl: null,
  };
}

export function openCheckout(args: {
  provider: PaymentProvider;
  orderId: string;
  orderNumber: string;
  organizationId: string;
  amountPaise: number;
}): Promise<CheckoutHandoff> {
  return args.provider === "cash" ? Promise.resolve(cashHandoff(args)) : razorpayHandoff(args);
}

/**
 * Verifies a webhook before anything in it is read as meaningful. This is the whole reason
 * an order is not confirmed by the browser's success screen: the screen is a claim, and this
 * is the proof. Constant-time, and it refuses outright when no secret is configured rather
 * than treating "no secret" as "everything is valid".
 */
export function verifyWebhook(rawBody: string, signature: string): boolean {
  const secret = env.paymentWebhookSecret();
  if (secret === null) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** A refund, issued through the same seam. Cash refunds are recorded, not transmitted. */
export async function issueRefund(args: {
  provider: string;
  providerPaymentId: string | null;
  amountPaise: number;
}): Promise<string | null> {
  if (args.provider === "cash" || args.providerPaymentId === null) return null;

  const keys = env.razorpay();
  if (keys === null) {
    throw new ServiceError("INVALID_INPUT", "Refunds need the payment provider to be configured.");
  }

  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${args.providerPaymentId}/refund`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ amount: args.amountPaise }),
    },
  );

  if (!response.ok) {
    throw new ServiceError("SERVICE_UNAVAILABLE", "The payment provider refused the refund.");
  }

  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "id" in body && typeof body.id === "string"
    ? body.id
    : null;
}
