CREATE TABLE "qr_card_design" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"template" text NOT NULL,
	"theme" jsonb NOT NULL,
	"slots" jsonb NOT NULL,
	"request_type_id" text,
	"qr_code_id" text,
	"rendered_svg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_code" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text,
	"place_id" text,
	"request_type_id" text,
	"type" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"unique_scan_count" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"revenue_paise" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_scanned_at" timestamp,
	"restaurant_name" text DEFAULT '' NOT NULL,
	"restaurant_slug" text DEFAULT '' NOT NULL,
	"logo_url" text,
	"branch_name" text,
	"place_kind" text,
	"place_label" text,
	"place_capacity" integer,
	"table_parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"menu_id" text,
	"ordering_enabled" boolean DEFAULT true NOT NULL,
	"requests_enabled" boolean DEFAULT true NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_scan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"qr_code_id" text NOT NULL,
	"anonymous_id" text,
	"session_id" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"qr_code_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text,
	"place_id" text,
	"customer_id" text,
	"guest_name" text,
	"guest_phone" text,
	"guest_email" text,
	"anonymous_id" text,
	"poll_interval_seconds" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qr_card_design" ADD CONSTRAINT "qr_card_design_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scan" ADD CONSTRAINT "qr_scan_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_session" ADD CONSTRAINT "qr_session_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qr_card_org_slug_idx" ON "qr_card_design" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_code_token_idx" ON "qr_code" USING btree ("token");--> statement-breakpoint
CREATE INDEX "qr_code_org_idx" ON "qr_code" USING btree ("organization_id","type","status");--> statement-breakpoint
CREATE INDEX "qr_code_branch_idx" ON "qr_code" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "qr_code_place_idx" ON "qr_code" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "qr_scan_code_idx" ON "qr_scan" USING btree ("qr_code_id","scanned_at");--> statement-breakpoint
CREATE INDEX "qr_scan_anon_idx" ON "qr_scan" USING btree ("qr_code_id","anonymous_id");--> statement-breakpoint
CREATE INDEX "qr_session_org_idx" ON "qr_session" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "qr_session_code_idx" ON "qr_session" USING btree ("qr_code_id");