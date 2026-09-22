CREATE TABLE "req_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_request_id" text NOT NULL,
	"event" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "req_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text,
	"branch_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'bell' NOT NULL,
	"color" text DEFAULT 'brand' NOT NULL,
	"form_schema" jsonb NOT NULL,
	"destination" text DEFAULT 'waiter' NOT NULL,
	"sla_minutes" smallint DEFAULT 5 NOT NULL,
	"requires_table" boolean DEFAULT true NOT NULL,
	"allowed_only_during_active_order" boolean DEFAULT false NOT NULL,
	"success_message" text,
	"card_design_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "req_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"place_id" text,
	"place_label" text,
	"request_type_id" text NOT NULL,
	"session_id" text,
	"order_id" text,
	"customer_id" text,
	"guest_name" text,
	"guest_phone" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_staff_id" text,
	"assigned_staff_name" text,
	"rejection_reason" text,
	"sla_minutes" smallint NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"in_progress_at" timestamp,
	"completed_at" timestamp,
	"response_seconds" integer,
	"resolution_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "req_event" ADD CONSTRAINT "req_event_service_request_id_req_request_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."req_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "req_request" ADD CONSTRAINT "req_request_request_type_id_req_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."req_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "req_event_request_idx" ON "req_event" USING btree ("service_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "req_type_org_key_idx" ON "req_type" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "req_type_active_idx" ON "req_type" USING btree ("organization_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "req_request_active_idx" ON "req_request" USING btree ("organization_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "req_request_place_idx" ON "req_request" USING btree ("place_id","submitted_at");--> statement-breakpoint
CREATE INDEX "req_request_type_idx" ON "req_request" USING btree ("request_type_id","submitted_at");--> statement-breakpoint
CREATE INDEX "req_request_session_idx" ON "req_request" USING btree ("session_id","submitted_at");