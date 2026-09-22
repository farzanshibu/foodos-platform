CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"resource" text NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at");