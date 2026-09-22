CREATE TABLE "ins_org_dim" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ins_restaurant_dim" (
	"restaurant_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"branch_count" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp,
	"seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ins_restaurant_dim_org_idx" ON "ins_restaurant_dim" USING btree ("organization_id");