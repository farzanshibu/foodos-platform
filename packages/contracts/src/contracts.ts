/**
 * SOT: contracts, contract-map, wire-schemas, rpc-contracts, typed-contract
 * WHAT   Every operation's input and output schema, keyed exactly like the registry.
 * WHY    The echo signal across the network. `ContractMap` is a mapped type over the
 *        registry, so declaring an operation without a contract fails to compile. You
 *        cannot ship a subject nobody can parse.
 * HOW    `contractFor` returns schemas typed to that exact operation, so a handler's input
 *        and output are inferred rather than asserted at the call site.
 * WHERE  @foodos/core, apps/web/gateway, services/*
 */

import type { OperationOf, ResourceKey } from "@foodos/registry";
import type { z } from "zod";

import { auditContract } from "./resources/audit.contract";
import { billingContract } from "./resources/billing.contract";
import {
  branchContract,
  comboContract,
  menuCategoryContract,
  menuContract,
  menuItemContract,
  menuModifierContract,
  restaurantContract,
} from "./resources/catalog.contract";
import {
  couponContract,
  customerContract,
  favoriteContract,
  loyaltyContract,
  promotionContract,
  reviewContract,
} from "./resources/crm.contract";
import {
  parameterDefinitionContract,
  placeContract,
  sectionContract,
} from "./resources/floor.contract";
import { invitationContract, memberContract } from "./resources/identity.contract";
import {
  analyticsContract,
  analyticsEventContract,
  platformAdminContract,
} from "./resources/insights.contract";
import {
  cartContract,
  kitchenTicketContract,
  orderContract,
  paymentContract,
} from "./resources/orders.contract";
import { membershipContract, organizationContract } from "./resources/organization.contract";
import { quoteContract } from "./resources/pricing.contract";
import { projectContract } from "./resources/project.contract";
import { cardDesignContract, qrCodeContract, qrSessionContract } from "./resources/qr.contract";
import { requestTypeContract, serviceRequestContract } from "./resources/requests.contract";

export type Contract = { input: z.ZodType; output: z.ZodType };

/** Every declared operation needs a contract. A missing one is a compile error. */
export type ContractMap = { [K in ResourceKey]: { [O in OperationOf<K>]: Contract } };

export const contracts = {
  organization: organizationContract,
  membership: membershipContract,
  project: projectContract,
  member: memberContract,
  invitation: invitationContract,
  billing: billingContract,
  auditLog: auditContract,

  /* ── FoodOS ───────────────────────────────────────────────────────────── */
  restaurant: restaurantContract,
  branch: branchContract,
  menu: menuContract,
  menuCategory: menuCategoryContract,
  menuItem: menuItemContract,
  menuModifier: menuModifierContract,
  combo: comboContract,
  quote: quoteContract,

  place: placeContract,
  section: sectionContract,
  parameterDefinition: parameterDefinitionContract,

  qrCode: qrCodeContract,
  qrSession: qrSessionContract,
  cardDesign: cardDesignContract,

  cart: cartContract,
  order: orderContract,
  kitchenTicket: kitchenTicketContract,
  payment: paymentContract,

  requestType: requestTypeContract,
  serviceRequest: serviceRequestContract,

  customer: customerContract,
  review: reviewContract,
  favorite: favoriteContract,
  promotion: promotionContract,
  coupon: couponContract,
  loyalty: loyaltyContract,

  analyticsEvent: analyticsEventContract,
  analytics: analyticsContract,
  platformAdmin: platformAdminContract,
} satisfies ContractMap;

type Contracts = typeof contracts;

export type InputOf<K extends ResourceKey, O extends OperationOf<K>> =
  Contracts[K] extends Record<O, { input: z.ZodType<infer I> }> ? I : never;

export type OutputOf<K extends ResourceKey, O extends OperationOf<K>> =
  Contracts[K] extends Record<O, { output: z.ZodType<infer T> }> ? T : never;

export type TypedContract<K extends ResourceKey, O extends OperationOf<K>> = {
  readonly input: z.ZodType<InputOf<K, O>>;
  readonly output: z.ZodType<OutputOf<K, O>>;
};

/**
 * The single boundary assertion in this package. It is sound because `InputOf` and
 * `OutputOf` are derived from the very object being indexed - the assertion re-states a
 * relationship the compiler cannot follow through a mapped type, it does not invent one.
 */
export function contractFor<K extends ResourceKey, O extends OperationOf<K>>(
  resource: K,
  operation: O,
): TypedContract<K, O> {
  const map: ContractMap = contracts;
  const entry = map[resource][operation];
  return entry as TypedContract<K, O>;
}
