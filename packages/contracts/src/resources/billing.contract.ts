/**
 * SOT: billing-contract, entitlements-wire, checkout-contract, plan-catalog-wire,
 *      trial-wire, downgrade-blocked
 * WHAT   Input and output schemas for entitlements, the plan catalog and checkout.
 * WHY    Gateway and service parse the same schema, so neither can drift from the other.
 * HOW    Plans come from PLAN_KEYS, so a plan added to the registry is accepted here
 *        without anybody editing this file.
 * WHERE  services/billing
 */

import { isResourceKey, PLAN_KEYS, type ResourceKey } from "@foodos/registry";
import { z } from "zod";

export const entitlementsDto = z.object({
  plan: z.enum(PLAN_KEYS),
  /** Keyed by ResourceKey, like the registry's own Entitlements - the wire must not widen
   *  what the registry narrowed. `partialRecord`, not `record`: a resource with no usage
   *  yet has no key, exactly as `Entitlements.usage` is `Partial<Record<...>>`. */
  usage: z.partialRecord(z.custom<ResourceKey>(isResourceKey), z.number()),
});

/** A limit crosses the wire as JSON, so `false` rides as a boolean in the union. */
const wireLimit = z.union([z.number(), z.literal("unlimited"), z.boolean()]);

export const planDto = z.object({
  key: z.enum(PLAN_KEYS),
  label: z.string(),
  tagline: z.string(),
  priceMonthlyUsd: z.number(),
  priceYearlyUsd: z.number().nullable(),
  rank: z.number(),
  /** Days the plan can be trialled for, or null when it cannot be trialled at all. */
  trialDays: z.number().nullable(),
});

export const featureRowDto = z.object({
  resource: z.custom<ResourceKey>(isResourceKey),
  label: z.string(),
  limits: z.partialRecord(z.enum(PLAN_KEYS), wireLimit),
});

export const billingContract = {
  read: {
    input: z.object({}),
    output: z.object({
      entitlements: entitlementsDto,
      /**
       * `resource` is validated against the registry rather than typed as `string`, so the
       * billing page can hand each row straight to <UsageMeter resource=…/> without a cast.
       * Same pattern as `requestMeta.resource` in envelope.ts.
       */
      resources: z.array(
        z.object({
          resource: z.custom<ResourceKey>(isResourceKey),
          label: z.string(),
          usage: z.string(),
        }),
      ),
      /** The full catalog, so no component quotes a plan or price the registry lacks. */
      plans: z.array(planDto),
      features: z.array(featureRowDto),
      /**
       * Whether this organisation may still start a trial. Computed by the billing
       * service from the provider's own history - a used trial is never offered again -
       * and null when there is nothing to trial (top plan, or no trial declared).
       */
      trial: z.object({ eligible: z.boolean(), days: z.number().nullable() }),
    }),
  },
  manage: {
    input: z.object({ plan: z.enum(PLAN_KEYS), successUrl: z.string().url() }),
    output: z.object({ url: z.string().nullable() }),
  },
} as const;
