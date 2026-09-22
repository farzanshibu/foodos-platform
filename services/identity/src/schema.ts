/**
 * SOT: identity-schema, member-table, invitation-table, organization-table, member-stations
 * WHAT   The organisation, member and invitation tables.
 * WHY    Better Auth writes these from the gateway; this service reads them and owns the
 *        queries. That split is a deliberate trade-off, documented in the README: it keeps
 *        Better Auth's write logic (hooks, expiry, acceptance) intact while still giving
 *        the identity service ownership of the data it reads.
 * NOTE   This is a mirror, not the source of the DDL. `@foodos/auth` owns the migration
 *        for these tables, because its copy is the one `pnpm auth:generate` regenerates and
 *        the one the Better Auth adapter is checked against - DDL generated from a
 *        hand-copied mirror drifts, and the way you find out is Better Auth failing on a
 *        missing column at sign-in. Its version also carries the cascade foreign keys this
 *        one omits, and both cannot emit `CREATE TABLE "user"` into the same database.
 *        So this service has no drizzle.config.ts and no db:generate.
 *        Regenerate with `pnpm auth:generate` in @foodos/auth and copy changes here.
 *        `member.stations` is the one column on these tables Better Auth does NOT own -
 *        it is ours, written only by member.manage - so a regenerate will not produce it
 *        and must not remove it.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  image: text("image"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  /**
   * The posts this seat works, comma-separated, in the same unconstrained-text style the
   * `role` column beside it already uses - and read back the same way, through the
   * registry's `normalizeStations`, so an unrecognised name can only ever take a surface
   * away. Null and empty both mean "not rostered", which refuses rather than waves through.
   */
  stations: text("stations"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
