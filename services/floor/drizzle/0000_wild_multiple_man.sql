CREATE TABLE "flr_parameter_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"data_type" text NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"is_customer_visible" boolean DEFAULT false NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flr_place" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"section_id" text,
	"kind" text DEFAULT 'table' NOT NULL,
	"label" text NOT NULL,
	"capacity" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"shape" text DEFAULT 'rect' NOT NULL,
	"row_label" text,
	"column_number" smallint,
	"position_x" numeric(8, 2),
	"position_y" numeric(8, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flr_place_parameter_value" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"place_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flr_section" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"floor" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flr_place" ADD CONSTRAINT "flr_place_section_id_flr_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."flr_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flr_place_parameter_value" ADD CONSTRAINT "flr_place_parameter_value_place_id_flr_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."flr_place"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flr_place_parameter_value" ADD CONSTRAINT "flr_place_parameter_value_definition_id_flr_parameter_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."flr_parameter_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flr_param_org_key_idx" ON "flr_parameter_definition" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "flr_place_branch_label_idx" ON "flr_place" USING btree ("branch_id","label");--> statement-breakpoint
CREATE INDEX "flr_place_org_status_idx" ON "flr_place" USING btree ("organization_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "flr_place_grid_idx" ON "flr_place" USING btree ("branch_id","row_label","column_number");--> statement-breakpoint
CREATE UNIQUE INDEX "flr_value_place_definition_idx" ON "flr_place_parameter_value" USING btree ("place_id","definition_id");--> statement-breakpoint
CREATE INDEX "flr_value_org_idx" ON "flr_place_parameter_value" USING btree ("organization_id","place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flr_section_branch_name_idx" ON "flr_section" USING btree ("branch_id","name","floor");--> statement-breakpoint
CREATE INDEX "flr_section_org_idx" ON "flr_section" USING btree ("organization_id","branch_id");