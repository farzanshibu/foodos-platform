CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_by_id" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_idx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_org_created_idx" ON "project" USING btree ("organization_id","created_at");