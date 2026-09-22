CREATE TABLE "crm_coupon" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"promotion_id" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"max_redemptions" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_customer" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spend_paise" bigint DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp,
	"favourite_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text,
	"session_id" text,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_loyalty_programme" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"points_per_hundred" integer DEFAULT 10 NOT NULL,
	"redeem_paise_per_point" integer DEFAULT 10 NOT NULL,
	"minimum_redeem_points" integer DEFAULT 100 NOT NULL,
	"expiry_days" integer,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_loyalty_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"order_id" text,
	"description" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_promotion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"percentage" numeric(5, 2),
	"amount_paise" bigint,
	"free_item_id" text,
	"minimum_order_paise" bigint,
	"item_ids" text[] DEFAULT '{}' NOT NULL,
	"category_ids" text[] DEFAULT '{}' NOT NULL,
	"combo_ids" text[] DEFAULT '{}' NOT NULL,
	"branch_ids" text[] DEFAULT '{}' NOT NULL,
	"days_of_week" smallint[] DEFAULT '{}' NOT NULL,
	"start_time" time,
	"end_time" time,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"max_redemptions" integer,
	"max_redemptions_per_customer" integer,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text,
	"order_id" text,
	"customer_id" text,
	"author_name" text,
	"food" smallint NOT NULL,
	"service" smallint NOT NULL,
	"ambience" smallint NOT NULL,
	"value" smallint NOT NULL,
	"overall" numeric(3, 2) NOT NULL,
	"body" text,
	"status" text DEFAULT 'published' NOT NULL,
	"reply" text,
	"replied_at" timestamp,
	"flag_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_coupon" ADD CONSTRAINT "crm_coupon_promotion_id_crm_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."crm_promotion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_loyalty_transaction" ADD CONSTRAINT "crm_loyalty_transaction_customer_id_crm_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_review" ADD CONSTRAINT "crm_review_customer_id_crm_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_coupon_org_code_idx" ON "crm_coupon" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_customer_org_phone_idx" ON "crm_customer" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "crm_customer_org_spend_idx" ON "crm_customer" USING btree ("organization_id","total_spend_paise");--> statement-breakpoint
CREATE INDEX "crm_customer_org_visit_idx" ON "crm_customer" USING btree ("organization_id","last_visit_at");--> statement-breakpoint
CREATE INDEX "crm_favorite_owner_idx" ON "crm_favorite" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_loyalty_org_restaurant_idx" ON "crm_loyalty_programme" USING btree ("organization_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "crm_loyalty_tx_customer_idx" ON "crm_loyalty_transaction" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_promotion_org_idx" ON "crm_promotion" USING btree ("organization_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "crm_review_org_idx" ON "crm_review" USING btree ("organization_id","restaurant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_review_order_idx" ON "crm_review" USING btree ("order_id");