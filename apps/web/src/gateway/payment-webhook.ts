/**
 * SOT: payment-webhook-adapter, webhook-signature, webhook-parse
 * WHAT   Verifying a payment provider's webhook and reading what it says.
 * WHY    This is the only proof a payment happened, so it lives at the edge with the other
 *        things that decide - not in a service, which is not allowed to trust an unsigned
 *        message from outside anyway. The route above it does nothing but call these two.
 * HOW    The RAW body is what gets verified. Re-serialising the parsed object changes bytes
 *        and would check a different message than the one that was signed.
 * WHERE  apps/web/src/app/api/webhooks/payments/route.ts, services/orders/src/payment.handlers.ts
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@foodos/env";

export type Settlement = {
  readonly organizationId: string;
  readonly providerPaymentId: string;
  readonly providerOrderId: string;
  readonly outcome: "captured" | "failed";
  readonly amountPaise: number;
  readonly method: "upi" | "card" | "netbanking" | "wallet" | "cash" | undefined;
};

/**
 * Constant time, and it refuses outright when no secret is configured rather than treating
 * "no secret" as "everything is valid" - the failure mode that turns a webhook into an
 * unauthenticated endpoint that can mark any order paid.
 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = env.paymentWebhookSecret();
  if (secret === null || signature === null) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null) return new Map();
  const entries: ReadonlyMap<string, unknown> = new Map(Object.entries(value));
  return entries;
}

const METHODS = ["upi", "card", "netbanking", "wallet", "cash"] as const;

/**
 * Reads the settlement out of a body that has already been proved genuine. Returns null for
 * anything it does not recognise, including events that are not about a payment at all -
 * a provider sends many kinds and only some of them mean money moved.
 */
export function readSettlement(rawBody: string): Settlement | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const root = fieldsOf(parsed);
  const event = root.get("event");
  if (event !== "payment.captured" && event !== "payment.failed") return null;

  const entity = fieldsOf(fieldsOf(fieldsOf(root.get("payload")).get("payment")).get("entity"));
  const id = entity.get("id");
  const orderId = entity.get("order_id");
  const amount = entity.get("amount");
  const method = entity.get("method");
  const notes = fieldsOf(entity.get("notes"));
  const organizationId = notes.get("orgId");

  if (
    typeof id !== "string" ||
    typeof orderId !== "string" ||
    typeof amount !== "number" ||
    typeof organizationId !== "string"
  ) {
    return null;
  }

  return {
    organizationId,
    providerPaymentId: id,
    providerOrderId: orderId,
    outcome: event === "payment.captured" ? "captured" : "failed",
    amountPaise: amount,
    method: METHODS.find((candidate) => candidate === method),
  };
}
