/**
 * SOT: contracts-barrel, contracts-index
 * WHAT   One import path for the wire: schemas, the envelope, signing and the error codes.
 * WHY    One place for a person or an agent to look, and one place that says what may
 *        cross a process boundary in this platform.
 * HOW    Add a resource contract file and export it here. Nothing else imports the files
 *        underneath directly.
 * WHERE  @foodos/core, @foodos/transport, apps/web/src/gateway, services
 */
export * from "./contracts";
export * from "./envelope";
export * from "./errors";
export * from "./resources/audit.contract";
export * from "./resources/billing.contract";
export * from "./resources/catalog.contract";
export * from "./resources/crm.contract";
export * from "./resources/floor.contract";
export * from "./resources/identity.contract";
export * from "./resources/insights.contract";
export * from "./resources/orders.contract";
export * from "./resources/organization.contract";
export * from "./resources/pricing.contract";
export * from "./resources/project.contract";
export * from "./resources/qr.contract";
export * from "./resources/requests.contract";
export * from "./signing";
export * from "./ticket";
export * from "./wire";
