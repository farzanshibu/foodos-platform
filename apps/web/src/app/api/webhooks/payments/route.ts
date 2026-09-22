/**
 * SOT: payment-webhook-route, order-confirmation
 * WHAT   The only path by which an order becomes paid.
 * WHY    A browser reaching a success screen proves nothing - it can be closed, replayed, or
 *        simply lied to. The provider signing this with a secret only we and they hold is the
 *        proof, so the signature is checked before the body is read as anything meaningful.
 * HOW    Always 200 once the signature holds, even when the body is an event we do not act
 *        on: a provider that gets a 4xx retries forever, and a retry storm is not a way to
 *        find out we ignore subscription notifications.
 * WHERE  apps/web/src/gateway/payment-webhook.ts, services/orders/src/payment.handlers.ts
 */
import { readSettlement, verifySignature } from "@/gateway/payment-webhook";
import { reconcilePayment } from "@/gateway/public-call";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();

  if (!verifySignature(raw, request.headers.get("x-razorpay-signature"))) {
    /** Terse on purpose: neither a probe nor a wrong secret learns anything from this. */
    return new Response("invalid signature", { status: 401 });
  }

  const settlement = readSettlement(raw);
  if (settlement === null) return new Response("ignored", { status: 200 });

  try {
    await reconcilePayment(settlement);
  } catch (error) {
    /** A 500 asks the provider to try again, which is right: the money did move. */
    console.error("[payments] could not reconcile a verified settlement", error);
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
