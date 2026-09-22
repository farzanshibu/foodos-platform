CREATE TABLE "ins_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"anonymous_id" text,
	"session_id" text,
	"restaurant_id" text,
	"branch_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ins_order_fact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"place_id" text,
	"customer_id" text,
	"order_type" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"refunded_paise" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ins_service_fact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"branch_id" text,
	"reference_id" text,
	"label" text,
	"numeric_value" numeric(12, 2),
	"seconds_value" integer,
	"flag" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ins_event_id_idx" ON "ins_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ins_event_org_idx" ON "ins_event" USING btree ("organization_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX "ins_event_branch_idx" ON "ins_event" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ins_fact_order_idx" ON "ins_order_fact" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ins_fact_org_idx" ON "ins_order_fact" USING btree ("organization_id","placed_at");--> statement-breakpoint
CREATE INDEX "ins_fact_branch_idx" ON "ins_order_fact" USING btree ("branch_id","placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ins_service_fact_entity_idx" ON "ins_service_fact" USING btree ("kind","entity_id");--> statement-breakpoint
CREATE INDEX "ins_service_fact_org_idx" ON "ins_service_fact" USING btree ("organization_id","kind","occurred_at");