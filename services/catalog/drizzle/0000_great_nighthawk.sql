CREATE TABLE "cat_branch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"country" text DEFAULT 'IN' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"service_modes" text[] DEFAULT '{"dine_in"}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_branch_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"day_of_week" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_combo" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"pricing_mode" text NOT NULL,
	"flat_rate_paise" bigint,
	"flat_percentage" numeric(5, 2),
	"tax_rate_id" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_combo_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"combo_id" text NOT NULL,
	"name" text NOT NULL,
	"min_selections" smallint DEFAULT 1 NOT NULL,
	"max_selections" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_combo_group_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"item_id" text NOT NULL,
	"variant_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"menu_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"menu_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"price_paise" bigint NOT NULL,
	"discount_price_paise" bigint,
	"sku" text,
	"prep_time_minutes" smallint,
	"calories" integer,
	"ingredients" text,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"spice_level" smallint,
	"dietary_labels" text[] DEFAULT '{}' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"available_from" time,
	"available_to" time,
	"tax_rate_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu_item_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"price_paise" bigint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu_modifier" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"min_selections" smallint DEFAULT 0 NOT NULL,
	"max_selections" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_menu_modifier_option" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"modifier_id" text NOT NULL,
	"name" text NOT NULL,
	"price_delta_paise" bigint DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_restaurant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"service_modes" text[] DEFAULT '{"dine_in"}' NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"went_live_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_tax_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cat_branch" ADD CONSTRAINT "cat_branch_restaurant_id_cat_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."cat_restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_branch_hours" ADD CONSTRAINT "cat_branch_hours_branch_id_cat_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."cat_branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo" ADD CONSTRAINT "cat_combo_restaurant_id_cat_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."cat_restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo" ADD CONSTRAINT "cat_combo_branch_id_cat_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."cat_branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo" ADD CONSTRAINT "cat_combo_tax_rate_id_cat_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."cat_tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo_group" ADD CONSTRAINT "cat_combo_group_combo_id_cat_combo_id_fk" FOREIGN KEY ("combo_id") REFERENCES "public"."cat_combo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo_group_item" ADD CONSTRAINT "cat_combo_group_item_group_id_cat_combo_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."cat_combo_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo_group_item" ADD CONSTRAINT "cat_combo_group_item_item_id_cat_menu_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cat_menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_combo_group_item" ADD CONSTRAINT "cat_combo_group_item_variant_id_cat_menu_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."cat_menu_item_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu" ADD CONSTRAINT "cat_menu_restaurant_id_cat_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."cat_restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu" ADD CONSTRAINT "cat_menu_branch_id_cat_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."cat_branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_category" ADD CONSTRAINT "cat_menu_category_menu_id_cat_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."cat_menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_item" ADD CONSTRAINT "cat_menu_item_menu_id_cat_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."cat_menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_item" ADD CONSTRAINT "cat_menu_item_category_id_cat_menu_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cat_menu_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_item" ADD CONSTRAINT "cat_menu_item_tax_rate_id_cat_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."cat_tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_item_variant" ADD CONSTRAINT "cat_menu_item_variant_item_id_cat_menu_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cat_menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_modifier" ADD CONSTRAINT "cat_menu_modifier_item_id_cat_menu_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cat_menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cat_menu_modifier_option" ADD CONSTRAINT "cat_menu_modifier_option_modifier_id_cat_menu_modifier_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."cat_menu_modifier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cat_branch_org_idx" ON "cat_branch" USING btree ("organization_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "cat_branch_geo_idx" ON "cat_branch" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "cat_branch_city_idx" ON "cat_branch" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "cat_hours_branch_day_idx" ON "cat_branch_hours" USING btree ("branch_id","day_of_week");--> statement-breakpoint
CREATE INDEX "cat_combo_org_idx" ON "cat_combo" USING btree ("organization_id","restaurant_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_combo_group_idx" ON "cat_combo_group" USING btree ("combo_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_combo_group_item_idx" ON "cat_combo_group_item" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_menu_org_idx" ON "cat_menu" USING btree ("organization_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "cat_category_menu_idx" ON "cat_menu_category" USING btree ("organization_id","menu_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_item_menu_idx" ON "cat_menu_item" USING btree ("organization_id","menu_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_item_category_idx" ON "cat_menu_item" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_variant_item_idx" ON "cat_menu_item_variant" USING btree ("item_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_modifier_item_idx" ON "cat_menu_modifier" USING btree ("item_id","sort_order");--> statement-breakpoint
CREATE INDEX "cat_option_modifier_idx" ON "cat_menu_modifier_option" USING btree ("modifier_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "cat_restaurant_org_slug_idx" ON "cat_restaurant" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "cat_restaurant_org_created_idx" ON "cat_restaurant" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "cat_tax_org_idx" ON "cat_tax_rate" USING btree ("organization_id");