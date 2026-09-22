/**
 * SOT: billing-service-entry, entitlements-service, checkout-service, metering-consumer,
 *      plan-catalog-service, trial-service, downgrade-refusal
 * WHAT   Serves entitlements, the plan catalog and checkout, and meters usage from the
 *        event stream.
 * WHY    Autumn is this service's database, so it owns no tables. Metering is driven by
 *        evt.> rather than by each service remembering to call track() - the same reason
 *        audit is a consumer.
 * HOW    The meter is built with `defineConsumer`, which verifies the envelope signature
 *        before the handler runs. An unverified meter takes `meta.orgId` from whoever
 *        published, which is a stranger billing a victim organisation without limit.
 * HOW    A downgrade is refused here, on the far side of the bus, not only in the UI:
 *        the service re-reads entitlements and refuses until the tenant fits the target,
 *        naming what must come down. A UI-only check is a suggestion.
 * WHERE  packages/core/src/service.ts, packages/billing/src/autumn.adapter.ts
 */
import "server-only";

import { billing } from "@foodos/billing";
import { ServiceError } from "@foodos/contracts";
import { defineConsumer, defineService, handlerFor } from "@foodos/core";
import { env } from "@foodos/env";
import {
  downgradeBlockers,
  featureRows,
  isOperationOf,
  PLANS,
  PLANS_ASCENDING,
  queueGroup,
  RESOURCE_KEYS,
  RESOURCES,
  ruleFor,
  trialOffer,
  usageLabel,
} from "@foodos/registry";
import { closeConnection, consume, serveRpc } from "@foodos/transport";

const secret = env.envelopeSecret();

const runtime = defineService(
  "billing",
  [
    handlerFor("billing", "read", async ({ ctx }) => {
      const entitlements = await billing.getEntitlements(ctx.orgId);
      const offer = trialOffer(entitlements.plan);
      return {
        entitlements,
        resources: RESOURCE_KEYS.map((resource) => ({
          resource,
          label: RESOURCES[resource].label,
          usage: usageLabel(resource, entitlements),
        })),
        plans: PLANS_ASCENDING.map((plan) => ({
          key: plan,
          label: PLANS[plan].label,
          tagline: PLANS[plan].tagline,
          priceMonthlyUsd: PLANS[plan].priceMonthlyUsd,
          priceYearlyUsd: PLANS[plan].priceYearlyUsd,
          rank: PLANS[plan].rank,
          trialDays: PLANS[plan].trialDays,
        })),
        features: featureRows().map((row) => ({ ...row })),
        // The offer names the plan and length; eligibility is the provider's history.
        trial:
          offer === null
            ? { eligible: false, days: null }
            : {
                eligible: await billing.trialEligible(ctx.orgId),
                days: offer.days,
              },
      };
    }),

    handlerFor("billing", "manage", async ({ ctx, input }) => {
      const entitlements = await billing.getEntitlements(ctx.orgId);
      if (PLANS[input.plan].rank < PLANS[entitlements.plan].rank) {
        const blockers = downgradeBlockers(entitlements, input.plan);
        if (blockers.length > 0) {
          const names = blockers.map((row) => row.label).join(", ");
          throw new ServiceError(
            "DOWNGRADE_BLOCKED",
            `Your organisation does not fit the ${PLANS[input.plan].label} plan yet. Bring ${names} within its limits first.`,
            { blockers: blockers.map((row) => row.label) },
          );
        }
      }
      return billing.checkout({
        organizationId: ctx.orgId,
        plan: input.plan,
        successUrl: input.successUrl,
      });
    }),
  ],
  { secret },
);

async function main() {
  for (const route of runtime.routes) {
    await serveRpc({
      subject: route.subject,
      queue: queueGroup("billing"),
      handler: (raw, subject) => runtime.handle(raw, subject),
      unreadable: runtime.unreadable,
    });
    console.info(`[billing] serving ${route.subject}`);
  }

  // Metering. Anything the registry marks `consumes` is counted when it actually happened.
  void consume({
    stream: "EVT",
    durable: "billing-meter",
    filterSubject: "evt.>",
    handler: defineConsumer({ secret }, async ({ meta, payload }) => {
      // meta.resource and meta.operation were narrowed by the envelope schema, so this
      // needs a guard rather than a cast.
      if (!isOperationOf(meta.resource, meta.operation)) return;
      if (!ruleFor(meta.resource, meta.operation).consumes) return;
      await billing.track({
        organizationId: meta.orgId,
        resource: meta.resource,
        /** How many rows the operation actually created, counted by the service that
         *  created them. One for everything that creates one, four hundred for a screen
         *  of seats - `value: 1` here was the whole of the metering shortfall. */
        value: payload.units,
        /** Autumn's idempotency key. The consumer is at-least-once, so a redelivery
         *  must count once - see the adapter's `track`. The key is the request, not the
         *  value, so a redelivered event carrying 400 still meters 400 exactly once. */
        requestId: meta.requestId,
      });
    }),
  });
  console.info("[billing] metering evt.>");
}

main().catch((error) => {
  console.error("[billing] failed to start", error);
  process.exit(1);
});

process.on("SIGINT", () => void closeConnection().then(() => process.exit(0)));
process.on("SIGTERM", () => void closeConnection().then(() => process.exit(0)));
