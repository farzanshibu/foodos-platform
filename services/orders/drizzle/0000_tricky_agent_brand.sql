CREATE TABLE "ord_cart" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"place_id" text,
	"session_id" text,
	"customer_id" text,
	"order_type" text DEFAULT 'dine_in' NOT NULL,
	"coupon_code" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_kitchen_station" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"station_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_kitchen_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"order_id" text NOT NULL,
	"station_id" text,
	"ticket_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"estimated_minutes" smallint,
	"assigned_staff_id" text,
	"accepted_at" timestamp,
	"ready_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"place_id" text,
	"place_label" text,
	"customer_id" text,
	"session_id" text,
	"guest_name" text,
	"guest_phone" text,
	"guest_email" text,
	"order_number" text NOT NULL,
	"order_type" text NOT NULL,
	"source" text DEFAULT 'qr' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"service_charge_paise" bigint DEFAULT 0 NOT NULL,
	"packaging_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"coupon_code" text,
	"notes" text,
	"cancellation_reason" text,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"ready_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" text NOT NULL,
	"line_kind" text DEFAULT 'item' NOT NULL,
	"parent_order_item_id" text,
	"menu_item_id" text,
	"variant_id" text,
	"combo_id" text,
	"name_snapshot" text NOT NULL,
	"variant_name_snapshot" text,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint DEFAULT 0 NOT NULL,
	"reference_price_paise" bigint,
	"savings_paise" bigint,
	"tax_percent" text DEFAULT '0' NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_order_item_modifier" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"modifier_id" text,
	"modifier_option_id" text,
	"name_snapshot" text NOT NULL,
	"price_delta_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"method" text,
	"amount_paise" bigint NOT NULL,
	"refunded_paise" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ord_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ord_kitchen_ticket" ADD CONSTRAINT "ord_kitchen_ticket_order_id_ord_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ord_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ord_kitchen_ticket" ADD CONSTRAINT "ord_kitchen_ticket_station_id_ord_kitchen_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."ord_kitchen_station"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ord_order_item" ADD CONSTRAINT "ord_order_item_order_id_ord_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ord_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ord_order_item_modifier" ADD CONSTRAINT "ord_order_item_modifier_order_item_id_ord_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."ord_order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ord_payment" ADD CONSTRAINT "ord_payment_order_id_ord_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ord_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ord_refund" ADD CONSTRAINT "ord_refund_payment_id_ord_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."ord_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ord_cart_org_idx" ON "ord_cart" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "ord_cart_session_idx" ON "ord_cart" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ord_station_branch_name_idx" ON "ord_kitchen_station" USING btree ("branch_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ord_ticket_order_station_idx" ON "ord_kitchen_ticket" USING btree ("order_id","station_id");--> statement-breakpoint
CREATE INDEX "ord_ticket_branch_status_idx" ON "ord_kitchen_ticket" USING btree ("organization_id","branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ord_order_number_idx" ON "ord_order" USING btree ("organization_id","branch_id","order_number");--> statement-breakpoint
CREATE INDEX "ord_order_status_idx" ON "ord_order" USING btree ("organization_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "ord_order_created_idx" ON "ord_order" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ord_order_customer_idx" ON "ord_order" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "ord_order_place_idx" ON "ord_order" USING btree ("place_id","created_at");--> statement-breakpoint
CREATE INDEX "ord_order_item_order_idx" ON "ord_order_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ord_order_item_parent_idx" ON "ord_order_item" USING btree ("parent_order_item_id");--> statement-breakpoint
CREATE INDEX "ord_order_item_modifier_idx" ON "ord_order_item_modifier" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "ord_payment_order_idx" ON "ord_payment" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ord_payment_provider_idx" ON "ord_payment" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "ord_refund_payment_idx" ON "ord_refund" USING btree ("payment_id");