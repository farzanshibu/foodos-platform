import { defineConfig } from "drizzle-kit";

// Each service owns its schema and its migrations. Nothing else may migrate these tables.
// The journal is per-owner. drizzle-kit defaults every package to the same
// `drizzle.__drizzle_migrations` table, and its migrator applies a file only when
// `lastApplied.created_at < file.folderMillis` - one shared table means whichever package
// migrates last sets a high-water mark that silently skips every older migration belonging
// to someone else. A service would boot against tables that were never created, with no
// error anywhere. One table per owner, so each keeps its own high-water mark.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  migrations: { table: "__drizzle_migrations_qr", schema: "drizzle" },
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
});
